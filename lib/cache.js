import fs from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), ".data");
const file = path.join(dir, "fares.json");
const g = globalThis;

export const ttlMinutes = () => Number(process.env.FARE_CACHE_MINUTES || 60);

function load() {
  if (g.__fares) return g.__fares;
  try { g.__fares = JSON.parse(fs.readFileSync(file, "utf8")); } catch { g.__fares = {}; }
  return g.__fares;
}
function save() {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(g.__fares));
}

export const cardKind = (r) => (r === "16-25" || r === "26-30" ? r : "none");
const pid = (p) => p.code || `n:${p.name.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
export const slotKey = (input, slot) => `${pid(input.from)}|${pid(input.to)}|${input.date}|${cardKind(input.railcard)}|${slot}`;

// 2-hour slots aligned to even hours, so searches around different times can share cached reads.
export function slotsFor(input, pref, flex) {
  const lo = Math.max(0, pref - flex), hi = Math.min(1439, pref + flex);
  const out = [];
  for (let s = Math.floor(lo / 120) * 120; s <= hi; s += 120) out.push(s);
  return out;
}

export function getFresh(key) {
  const e = load()[key];
  if (!e) return null;
  return Date.now() - Date.parse(e.retrievedAt) <= ttlMinutes() * 60000 ? e : null;
}
export function putSlot(key, entry) {
  const prev = load()[key];
  load()[key] = { ...entry, keepWarm: entry.keepWarm || prev?.keepWarm || false };
  save();
}
export const warmEntries = () => Object.entries(load()).filter(([, e]) => e.keepWarm);
export function dropExpiredWarm() {
  const today = new Date().toISOString().slice(0, 10);
  let changed = false;
  for (const [k, e] of Object.entries(load())) {
    if (e.base?.date && e.base.date < today) { delete load()[k]; changed = true; }
  }
  if (changed) save();
}
