import { search, runAgent, limited } from "./tinyfish.js";
import { normaliseJourneys, analyse, verifySplit } from "./analyze.js";
import { toMin } from "./time.js";
import { slotsFor, slotKey, getFresh, putSlot, warmEntries, dropExpiredWarm, ttlMinutes } from "./cache.js";

const g = globalThis;
g.__jobs ||= new Map();
export const jobs = g.__jobs;

const GOOD = ["nationalrail.co.uk", "avantiwestcoast.co.uk", "lner.co.uk", "gwr.com", "thetrainline.com",
  "crosscountrytrains.co.uk", "northernrailway.co.uk", "tpexpress.co.uk", "scotrail.co.uk", "southernrailway.com",
  "greateranglia.co.uk", "westmidlandsrailway.co.uk", "eastmidlandsrailway.co.uk", "c2c-online.co.uk", "trainpal.com"];
const AVOID = ["traintickets.com", "rome2rio.com", "tripadvisor", "wikipedia", "reddit", "youtube", "facebook"];
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const hhmm = (x) => `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;

export const SCHEMA = {
  type: "object",
  properties: {
    blocked: { type: "boolean" },
    note: { type: "string" },
    railcard_applied_on_site: { type: "boolean" },
    resolved_origin: { type: "string" },
    resolved_destination: { type: "string" },
    journeys: {
      type: "array",
      items: {
        type: "object",
        properties: {
          departure: { type: "string" }, arrival: { type: "string" }, duration: { type: "string" },
          changes: { type: "number" }, operator: { type: "string" }, ticket_type: { type: "string" },
          price_gbp: { type: "number" }, railcard_price_gbp: { type: "number" },
        },
      },
    },
  },
  required: ["blocked", "journeys"],
};

export const SPLIT_SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean" }, notes: { type: "string" }, departure: { type: "string" },
    normal_fare_gbp: { type: "number" },
    legs: { type: "array", items: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, price_gbp: { type: "number" } } } },
  },
  required: ["found"],
};

function ddmmyy(date) { const [y, m, d] = date.split("-"); return `${d}${m}${y.slice(2)}`; }

export function plannerUrl(input, atMin = toMin(input.time)) {
  if (!input.from.code || !input.to.code) return "https://www.nationalrail.co.uk/journey-planner/";
  return `https://www.nationalrail.co.uk/journey-planner/?type=single&origin=${input.from.code}&destination=${input.to.code}` +
    `&leavingType=departing&leavingDate=${ddmmyy(input.date)}&leavingHour=${String(Math.floor(atMin / 60)).padStart(2, "0")}&leavingMin=${String(atMin % 60).padStart(2, "0")}&adults=1&extraTime=0`;
}

export function agentGoal(input, lo, hi) {
  const card = { "16-25": "a 16-25 Railcard", "26-30": "a 26-30 Railcard" }[input.railcard];
  const resolve = !input.from.code || !input.to.code;
  return `Find single train journeys from ${input.from.name} to ${input.to.name} leaving on ${input.date} (1 adult, standard class). ` +
    (resolve ? `Enter the origin and destination in the planner and choose the main National Rail station for each name (if a name is not a place served by a station, e.g. an event, stop and set blocked=true with a note). Set the journey to leave on ${input.date} from ${hhmm(lo)}. Report the exact station names you selected as resolved_origin and resolved_destination. ` : "") +
    `Use the site's journey planner. Cover EVERY departure between ${hhmm(lo)} and ${hhmm(hi)} and nothing outside it: keep loading later trains until you pass ${hhmm(hi)}. ` +
    `Do not log in, buy anything, or solve any CAPTCHA; if the site blocks you, stop and set blocked=true. ` +
    `For each train return departure and arrival (HH:MM, 24h), duration, number of changes, operator, the cheapest ticket type and its price in GBP as price_gbp. ` +
    (card ? `Also try to apply ${card} using the site's own railcard option and return the discounted price shown by the site as railcard_price_gbp. Set railcard_applied_on_site=true ONLY if the site itself displayed the discounted prices; if you could not apply it, set it false and omit railcard_price_gbp. Never calculate a discount yourself. ` : "") +
    `Only report values visible on the page; omit any value you cannot see. Never estimate.`;
}

export function splitGoal(input) {
  return `Search single journeys from ${input.from.name} to ${input.to.name} on ${input.date} leaving closest to ${input.time}. ` +
    `Do not log in, buy anything, or solve any CAPTCHA. Record the normal through fare for that train as normal_fare_gbp. ` +
    `Then check whether the site offers a cheaper split-ticket option (separate tickets for sub-sections of the same trip, e.g. at an intermediate station on the route). ` +
    `If a split option is shown, set found=true and list each leg (from, to, price_gbp) exactly as displayed. If none is shown set found=false. Never invent legs or prices.`;
}

// ---- Endpoint 1: Search (runs on every search, even when fares come from the cache) ----
export async function discoverSources(input) {
  const q1 = `${input.from.name} to ${input.to.name} train times and fares`;
  const q2 = `buy train tickets ${input.from.name} to ${input.to.name}`;
  const settled = await Promise.allSettled([search(q1), search(q2)]);
  if (settled.every((s) => s.status === "rejected")) throw settled[0].reason;
  const seen = new Map();
  let first = 0;
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    for (const r of s.value.results || []) {
      const h = host(r.url);
      if (!h || AVOID.some((a) => h.includes(a))) continue;
      const rank = GOOD.findIndex((d) => h.endsWith(d));
      const item = { url: r.url, title: r.title, host: h, snippet: r.snippet, rank: rank === -1 ? 99 : rank, order: first++ };
      if (!seen.has(h) || seen.get(h).rank > item.rank) seen.set(h, item);
    }
  }
  const all = [...seen.values()].sort((a, b) => a.rank - b.rank || a.order - b.order);
  // The two best distinct operator/planner sources. National Rail is reached via its planner deep link.
  const picks = all.slice(0, 2).map((s) => ({ host: s.host, url: s.url }));
  return { all, picks };
}

// ---- Endpoint 2: Agent, one run per 2-hour slot, cached per slot ----
async function readSlot(input, slot, picks, keepWarm) {
  const lo = slot, hi = Math.min(slot + 119, 1439);
  const errors = [];
  for (const s of picks) {
    const url = s.host.endsWith("nationalrail.co.uk") ? plannerUrl(input, lo) : s.url;
    try {
      const r = await limited(() => runAgent({ url, goal: agentGoal(input, lo, hi), output_schema: SCHEMA, maxSeconds: 480 }));
      const res = r.result || {};
      if (res.blocked) { errors.push({ host: s.host, error: "Site blocked automated access" }); continue; }
      const noCard = res.railcard_applied_on_site !== true || /railcard[^.]*(not|unable|could not|couldn't|cannot)/i.test(res.note || "");
      const rows = (res.journeys || []).map((j) => {
        const row = { ...j };
        if (noCard) delete row.railcard_price_gbp; // never trust a railcard fare the site did not itself show
        return row;
      });
      if (!rows.length) { errors.push({ host: s.host, error: "No departures could be read" }); continue; }
      return { entry: { rows, host: s.host, url, retrievedAt: r.finishedAt, note: res.note || null, resolved: { origin: res.resolved_origin || null, destination: res.resolved_destination || null }, keepWarm, base: { from: input.from, to: input.to, date: input.date, railcard: input.railcard } }, errors };
    } catch (e) { errors.push({ host: s.host, error: e.message }); }
  }
  return { entry: null, errors };
}

export async function gatherRows(input, picks, { fresh = false, keepWarm = false, onUpdate } = {}) {
  const pref = toMin(input.time);
  const slots = slotsFor(input, pref, input.flexMinutes);
  const entries = new Map(), failures = [];
  const pending = [];
  for (const s of slots) {
    const c = fresh ? null : getFresh(slotKey(input, s));
    if (c) { entries.set(s, { ...c, cached: true }); if (keepWarm && !c.keepWarm) putSlot(slotKey(input, s), { ...c, keepWarm: true }); }
    else pending.push(s);
  }
  let left = pending.length;
  const emit = () => onUpdate?.({ entries, failures, pending: left, total: slots.length });
  emit();
  await Promise.all(pending.map(async (s) => {
    const { entry, errors } = await readSlot(input, s, picks, keepWarm);
    if (entry) { putSlot(slotKey(input, s), entry); entries.set(s, { ...entry, cached: false }); }
    else failures.push({ slot: s, errors });
    left--; emit();
  }));
  return { entries, failures, slots };
}

export function flatten(entries, failures) {
  const rows = [];
  const byHost = new Map();
  for (const e of entries.values()) {
    const src = { host: e.host, url: e.url, retrievedAt: e.retrievedAt };
    for (const r of e.rows) rows.push({ ...r, __source: src });
    const b = byHost.get(e.host) || { host: e.host, url: e.url, ok: true, count: 0, retrievedAt: e.retrievedAt, cached: 0, slots: 0 };
    b.count += e.rows.length; b.slots++; if (e.cached) b.cached++;
    if (e.retrievedAt < b.retrievedAt) b.retrievedAt = e.retrievedAt;
    byHost.set(e.host, b);
  }
  const status = [...byHost.values()];
  const seen = new Set();
  for (const f of failures) for (const er of f.errors) {
    const k = `${er.host}|${er.error}`;
    if (!seen.has(k)) { seen.add(k); status.push({ host: er.host, url: "", ok: false, error: er.error }); }
  }
  return { rows, status };
}

function assemble(input, entries, failures, extra = {}) {
  const { rows, status } = flatten(entries, failures);
  const journeys = normaliseJourneys(rows, input.railcard);
  const analysis = analyse(input, journeys);
  const all = [...entries.values()];
  return {
    input, analysis, journeys, sources: status,
    cache: { cachedSlots: all.filter((e) => e.cached).length, totalSlots: all.length, oldest: all.map((e) => e.retrievedAt).sort()[0] || null },
    resolved: all.map((e) => e.resolved).find((r) => r && (r.origin || r.destination)) || null,
    retrievedAt: new Date().toISOString(), ...extra,
  };
}

export async function runJob(id, input) {
  const job = jobs.get(id);
  try {
    job.stage = "search";
    const { all, picks } = await discoverSources(input);
    job.discovered = all.slice(0, 6).map(({ url, title, host: h }) => ({ url, title, host: h }));
    if (!picks.length) throw new Error("Search found no usable railway sources for this route.");

    job.stage = "compare";
    let splitP = null;
    if (input.split) {
      const src = all.find((s) => s.host.endsWith("thetrainline.com")) || all[0];
      splitP = limited(() => runAgent({ url: src.url, goal: splitGoal(input), output_schema: SPLIT_SCHEMA, maxSeconds: 480 }))
        .then((r) => ({ ...r, src })).catch((e) => ({ error: e.message }));
    }
    const { entries, failures } = await gatherRows(input, picks, {
      keepWarm: !!input.warm,
      onUpdate: ({ entries: en, failures: fl, pending, total }) => {
        if (pending === 0 || !en.size) return;
        const part = assemble(input, en, fl, { partial: true, pendingSlots: pending, totalSlots: total });
        if (part.analysis.ok) job.partial = part;
      },
    });
    if (!entries.size) throw new Error("Could not retrieve live fares: " + failures.flatMap((f) => f.errors).map((e) => `${e.host} (${e.error})`).filter((v, i, a) => a.indexOf(v) === i).join("; "));

    job.stage = "calculate";
    const result = assemble(input, entries, failures);
    job.stage = "arbitrage";
    job.partial = null;
    job.result = result;
    job.splitPending = !!splitP;
    job.stage = "done";
    if (splitP) {
      const sp = await splitP;
      if (sp.error) result.splitNote = "Could not verify a split-ticket option from the live source.";
      else {
        const split = verifySplit(sp.result, result.analysis.baseline);
        if (split) { split.source = { host: sp.src.host, url: sp.src.url, retrievedAt: sp.finishedAt }; result.split = split; }
        else result.splitNote = "No cheaper split-ticket itinerary could be verified from the live source.";
      }
      job.splitPending = false;
    }
  } catch (e) {
    job.error = e.message;
    job.stage = "error";
  }
}

export function startJob(input) {
  const id = crypto.randomUUID();
  jobs.set(id, { id, stage: "search", createdAt: Date.now() });
  runJob(id, input);
  if (jobs.size > 50) jobs.delete(jobs.keys().next().value);
  return id;
}

// Re-read pre-loaded (keepWarm) slots shortly before they go stale.
export async function refreshWarm() {
  dropExpiredWarm();
  for (const [key, e] of warmEntries()) {
    const age = Date.now() - Date.parse(e.retrievedAt);
    if (age < (ttlMinutes() - 15) * 60000) continue;
    const slot = Number(key.split("|").pop());
    const input = { from: e.base.from, to: e.base.to, date: e.base.date, railcard: e.base.railcard, time: hhmm(slot + 60), flexMinutes: 60 };
    const { entry } = await readSlot(input, slot, [{ host: e.host, url: e.url }], true);
    if (entry) putSlot(key, entry);
  }
}
