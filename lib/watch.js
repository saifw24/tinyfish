import crypto from "node:crypto";
import { createMonitor, runMonitorNow, deleteMonitor, loadEnv } from "./tinyfish.js";
import { gatherRows, flatten, plannerUrl, refreshWarm } from "./pipeline.js";
import { normaliseJourneys, evaluateCondition, gbp } from "./analyze.js";
import { fmtMin } from "./time.js";
import { allWatches, getWatch, putWatch, removeWatch } from "./store.js";
import { sendAlert, emailConfigured } from "./mail.js";

export function describeCondition(c) {
  return c.type === "price_below"
    ? `Notify me if the fare falls below ${gbp(c.value)}.`
    : `Notify me if a journey saves at least ${gbp(c.saving)} while departing within ${fmtMin(c.withinMinutes)} of the preferred time.`;
}

export async function createWatch({ input, condition, email, sources, baselinePrice, bestPrice }) {
  loadEnv();
  const id = crypto.randomUUID();
  const secret = process.env.WEBHOOK_SECRET || "";
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const webhook = base.startsWith("https://") ? `${base}/api/webhook/monitor?watch=${id}&secret=${encodeURIComponent(secret)}` : undefined;
  const url = plannerUrl(input);
  const m = await createMonitor({
    type: "fetch",
    name: `Rail: ${input.from.name} → ${input.to.name} ${input.date}`.slice(0, 100),
    config: { url, format: "markdown" },
    schedule_cron: "0 * * * *",
    purpose: `${describeCondition(condition)} A fare, departure or availability for ${input.from.name} to ${input.to.name} on ${input.date} changes.`,
    ...(webhook ? { webhook_url: webhook } : {}),
  });
  const w = {
    id, input, condition, email: email || null, monitorId: m.monitor?.id,
    sources: sources.map((s) => ({ host: s.host, url: s.url })),
    baselinePrice: baselinePrice ?? null, lastBest: bestPrice ?? null,
    status: "active", mode: webhook ? "tinyfish-schedule+webhook" : "in-app-scheduler",
    createdAt: new Date().toISOString(), lastCheck: null, lastNote: "Watching. First re-check pending.", lastHash: hash(m.run?.results?.[0]?.text),
    alerts: [], notified: [],
  };
  putWatch(w);
  return w;
}

const hash = (t) => (t ? crypto.createHash("sha1").update(t).digest("hex") : null);

export async function checkWatch(id) {
  const w = getWatch(id);
  if (!w || w.status !== "active") return w;
  if (new Date(w.input.date + "T23:59:59") < new Date()) {
    w.status = "expired"; w.lastNote = "Travel date has passed."; return putWatch(w);
  }
  // 1) Run the TinyFish Monitor now (the fare page is JS-rendered, so its text can't prove a price change on its own).
  let changed = null;
  try {
    const r = await runMonitorNow(w.monitorId);
    const h = hash(r.run?.results?.[0]?.text);
    changed = h && w.lastHash ? h !== w.lastHash : null;
    if (h) w.lastHash = h;
  } catch (e) { w.lastNote = `Monitor check failed: ${e.message}`; }
  // 2) Agent re-verifies actual fares and we evaluate the user's condition.
  try {
    const g = await gatherRows(w.input, w.sources, { fresh: true });
    const { rows, status } = flatten(g.entries, g.failures);
    if (!status.some((s) => s.ok)) throw new Error("live sources unavailable");
    const journeys = normaliseJourneys(rows, w.input.railcard);
    const ev = evaluateCondition(w.condition, w.input, journeys);
    w.lastCheck = new Date().toISOString();
    const a = ev.analysis;
    const best = a.ok && a.alternatives?.length ? Math.min(a.baseline.price, ...a.alternatives.map((x) => x.price)) : a.ok ? a.baseline.price : null;
    if (ev.met) {
      const h = ev.hit;
      const key = `${h.departure}@${h.price}`;
      if (!w.notified.includes(key)) {
        const move = h.displacement ? `leaving only ${fmtMin(h.displacement)} ${h.dir}` : "at your preferred time";
        const msg = h.saving != null
          ? `PRICE DROP: ${w.input.from.name} → ${w.input.to.name}. ${w.lastBest != null ? `Previously best acceptable fare: ${gbp(w.lastBest)}. ` : ""}New fare: ${gbp(h.price)}. You can now save ${gbp(h.saving)} ${move} (${h.departure}).`
          : `PRICE DROP: ${w.input.from.name} → ${w.input.to.name}. New fare: ${gbp(h.price)} (${h.departure}).`;
        const mail = await sendAlert(w.email, `Rail price drop: ${gbp(h.price)}`, msg + `\n\nVerified live on ${status.filter((s) => s.ok).map((s) => s.host).join(", ")} at ${w.lastCheck}.`);
        w.alerts.unshift({ at: w.lastCheck, message: msg, emailed: mail.sent, emailNote: mail.sent ? null : mail.reason, previous: w.lastBest, now: h.price, saving: h.saving ?? null });
        w.notified.push(key);
      }
      w.lastNote = "Condition met!";
    } else {
      w.lastNote = a.ok ? `Checked: condition not met yet. Best fare now ${gbp(best)}.` : a.reason;
    }
    if (best != null) w.lastBest = best;
  } catch (e) { w.lastNote = `Re-check could not verify live fares: ${e.message}`; w.lastCheck = new Date().toISOString(); }
  return putWatch(w);
}

export async function deleteWatch(id) {
  const w = getWatch(id);
  if (!w) return;
  try { if (w.monitorId) await deleteMonitor(w.monitorId); } catch {}
  removeWatch(id);
}

export const publicWatch = (w) => ({ ...w, emailConfigured: emailConfigured() });

export function startScheduler() {
  const g = globalThis;
  if (g.__sched) return;
  loadEnv();
  g.__sched = [];
  // Keep pre-loaded routes fresh so searches stay instant.
  g.__sched.push(setInterval(() => { refreshWarm().catch(() => {}); }, 10 * 60 * 1000));
  if ((process.env.PUBLIC_BASE_URL || "").startsWith("https://")) return; // TinyFish calls us via webhook instead
  const mins = Number(process.env.WATCH_INTERVAL_MINUTES || 60);
  g.__sched.push(setInterval(async () => {
    for (const w of allWatches()) {
      if (w.status === "active" && w.mode === "in-app-scheduler") { try { await checkWatch(w.id); } catch {} }
    }
  }, mins * 60 * 1000));
}
