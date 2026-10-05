import { toMin, fmtMin } from "./time.js";

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const gbp = (n) => `£${Number.isInteger(n) ? n : n.toFixed(2)}`;
export { gbp };

// Normalise raw agent rows into comparable journeys. Anything unverifiable is dropped, never guessed.
export function normaliseJourneys(rows, railcard) {
  const out = [];
  for (const r of rows) {
    const dep = toMin(r.departure), arr = toMin(r.arrival);
    if (dep == null || arr == null) continue;
    let duration = arr - dep;
    if (duration <= 0) duration += 24 * 60;
    const useCard = railcard && railcard !== "none" && railcard !== "other";
    const cardPrice = typeof r.railcard_price_gbp === "number" ? r.railcard_price_gbp : null;
    const std = typeof r.price_gbp === "number" ? r.price_gbp : null;
    const price = useCard && cardPrice != null ? cardPrice : std;
    if (price == null || typeof r.changes !== "number") continue;
    out.push({
      departure: r.departure.slice(0, 5), arrival: r.arrival.slice(0, 5),
      dep, arr, duration, changes: r.changes,
      operator: r.operator && !/^\(?\s*(null|not visible|unknown)/i.test(r.operator) ? r.operator : null,
      ticketType: r.ticket_type || null,
      price, standardPrice: std,
      railcardApplied: !!(useCard && cardPrice != null),
      railcardUnverified: !!(useCard && cardPrice == null),
      sources: r.__source ? [r.__source] : [],
    });
  }
  // de-duplicate across sources: same departure+arrival -> keep cheapest verified fare
  const byKey = new Map();
  for (const j of out) {
    const k = `${j.departure}-${j.arrival}`;
    const prev = byKey.get(k);
    if (!prev) byKey.set(k, j);
    else {
      const keep = j.price < prev.price ? j : prev;
      keep.sources = [...new Set([...prev.sources, ...j.sources])];
      byKey.set(k, keep);
    }
  }
  return [...byKey.values()].sort((a, b) => a.dep - b.dep);
}

export function analyse(input, journeys) {
  const pref = toMin(input.time);
  const flex = input.flexMinutes;
  const maxChanges = input.maxChanges;
  const notes = [];

  const inWindow = journeys.filter((j) => Math.abs(j.dep - pref) <= flex);
  if (!inWindow.length) return { ok: false, reason: "No verifiable journeys were found inside your time window.", all: journeys };

  const first = Math.min(...inWindow.map((j) => j.dep)), last = Math.max(...inWindow.map((j) => j.dep));
  const hm = (x) => `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
  if (first - (pref - flex) > 30) notes.push(`Departures before ${hm(first)} in your window could not be read from the live sources.`);
  if ((pref + flex) - last > 30) notes.push(`Departures after ${hm(last)} in your window could not be read from the live sources.`);

  const minDur = Math.min(...inWindow.map((j) => j.duration));
  const sane = inWindow.filter((j) => j.duration <= minDur * 2.2 && j.duration <= 12 * 60);
  if (sane.length < inWindow.length) notes.push(`${inWindow.length - sane.length} implausible journey(s) were excluded (e.g. overnight or disrupted).`);

  const viable = sane.filter((j) => j.changes <= maxChanges);
  if (!viable.length) return { ok: false, reason: `No journeys with ${maxChanges} change(s) or fewer were found in your window.`, all: journeys };

  for (const j of viable) j.displacement = Math.abs(j.dep - pref);
  const baseline = [...viable].sort((a, b) => a.displacement - b.displacement || a.changes - b.changes || a.price - b.price)[0];
  if (viable.some((j) => j.railcardUnverified))
    notes.push("Could not verify the railcard fare for some trains, so their standard fare is shown.");

  const alts = [];
  for (const j of viable) {
    if (j === baseline) continue;
    const saving = baseline.price - j.price;
    if (saving <= 0) continue;
    const extra = j.duration - baseline.duration;
    const displacement = j.displacement;
    const inconvenience = displacement + Math.max(0, extra);
    const pct = (saving / baseline.price) * 100;
    const parts = {
      price: clamp(pct / 50) * 35,
      schedule: (1 - clamp(displacement / Math.max(flex, 1))) * 25,
      duration: (1 - clamp(Math.max(0, extra) / 90)) * 25,
      changes: [15, 9, 3][j.changes] ?? 0,
    };
    const score = Math.round(parts.price + parts.schedule + parts.duration + parts.changes);
    const dir = j.dep < pref ? "earlier" : "later";
    const reasons = [
      `Saves ${gbp(saving)} (${pct.toFixed(0)}%) versus your normal option`,
      displacement === 0 ? "Leaves at your preferred time" : `Leaves ${fmtMin(displacement)} ${dir} than preferred`,
      extra > 0 ? `Journey is ${fmtMin(extra)} longer` : extra < 0 ? `Journey is ${fmtMin(extra)} shorter` : "Same journey time",
      j.changes === 0 ? "Direct" : `${j.changes} change${j.changes > 1 ? "s" : ""}`,
    ];
    alts.push({
      ...j, saving, pct, extra, displacement, inconvenience, dir,
      perExtraMinute: extra > 0 ? saving / extra : null,
      perInconvenienceMinute: saving / Math.max(1, inconvenience),
      score, scoreParts: parts, reasons,
    });
  }
  alts.sort((a, b) => b.score - a.score);

  const result = { ok: true, baseline, alternatives: alts, notes, windowCount: viable.length };
  if (!alts.length) { result.reason = "Nothing cheaper than your normal option was found in this window."; return result; }

  result.picks = computePicks(alts, baseline);

  if (input.target > 0) {
    const opt = targetPick(alts, input.target);
    result.target = opt
      ? { amount: input.target, met: true, option: opt }
      : { amount: input.target, met: false, maxSaving: Math.max(...alts.map((a) => a.saving)) };
  }
  const head = result.target?.met ? result.target.option : result.picks.bestArbitrage;
  result.headline = { option: head, saving: head.saving, inconvenience: head.inconvenience };
  return result;
}

export function describeShift(a) {
  if (a.displacement === 0) return "Leave at your preferred time";
  return `Leave ${fmtMin(a.displacement)} ${a.dir}`;
}

// Only ever return a split-ticket result that is internally consistent and verified.
export function verifySplit(raw, baseline) {
  if (!raw || raw.found !== true) return null;
  const legs = (raw.legs || []).filter((l) => l && l.from && l.to && typeof l.price_gbp === "number");
  if (legs.length < 2 || typeof raw.normal_fare_gbp !== "number") return null;
  const total = Math.round(legs.reduce((s, l) => s + l.price_gbp, 0) * 100) / 100;
  if (total >= raw.normal_fare_gbp) return null;
  return {
    normalFare: raw.normal_fare_gbp, legs, total, saving: Math.round((raw.normal_fare_gbp - total) * 100) / 100,
    departure: raw.departure || null, notes: raw.notes || null,
    comparableToBaseline: !baseline || Math.abs(baseline.price - raw.normal_fare_gbp) <= 1,
  };
}

// Used by watches: does a fresh analysis satisfy the user's condition?
export function evaluateCondition(cond, input, journeys) {
  const a = analyse(input, journeys);
  if (!a.ok) return { met: false, analysis: a };
  const pref = toMin(input.time);
  if (cond.type === "price_below") {
    const hit = [...a.alternatives, a.baseline].filter((j) => j.price < cond.value).sort((x, y) => x.price - y.price)[0];
    return { met: !!hit, hit, analysis: a };
  }
  const within = cond.withinMinutes ?? 60;
  const hit = a.alternatives
    .filter((j) => j.saving >= cond.saving && Math.abs(j.dep - pref) <= within)
    .sort((x, y) => x.inconvenience - y.inconvenience)[0];
  return { met: !!hit, hit, analysis: a };
}

// Shared by the server and the browser (the target slider / time-shift control re-run these client-side).
export function computePicks(alts, baseline) {
  if (!alts.length) return null;
  const eligible = alts.filter((a) => a.saving >= Math.max(3, baseline.price * 0.1));
  const pool = eligible.length ? eligible : alts;
  const bestArbitrage = [...pool].sort((a, b) => b.perInconvenienceMinute - a.perInconvenienceMinute || b.saving - a.saving)[0];
  const cheapest = [...alts].sort((a, b) => a.price - b.price)[0];
  const bestBalance = [...alts].sort((a, b) => b.score - a.score)[0];
  const notWorth = alts
    .filter((a) => a !== bestArbitrage && a.saving > bestArbitrage.saving && a.saving - bestArbitrage.saving <= 10 && a.inconvenience >= bestArbitrage.inconvenience + 30)
    .sort((a, b) => a.price - b.price)[0] || null;
  return { bestArbitrage, cheapest, bestBalance, notWorth };
}

export function targetPick(alts, target) {
  return alts.filter((a) => a.saving >= target)
    .sort((a, b) => a.inconvenience - b.inconvenience || b.saving - a.saving)[0] || null;
}
