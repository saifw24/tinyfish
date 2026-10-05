import fs from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), ".data");
const file = path.join(dir, "watches.json");
const g = globalThis;

function load() {
  if (g.__watches) return g.__watches;
  try { g.__watches = JSON.parse(fs.readFileSync(file, "utf8")); } catch { g.__watches = {}; }
  return g.__watches;
}
function save() {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(g.__watches, null, 2));
}
export const allWatches = () => Object.values(load());
export const getWatch = (id) => load()[id] || null;
export function putWatch(w) { load()[w.id] = w; save(); return w; }
export function removeWatch(id) { delete load()[id]; save(); }
