import fs from "node:fs";
import path from "node:path";

// Next.js loads .env.local itself; also accept the .env.txt the user created.
function loadEnvFallback() {
  if (process.env.TINYFISH_API_KEY) return;
  for (const f of [".env.txt", ".env"]) {
    try {
      const txt = fs.readFileSync(path.join(process.cwd(), f), "utf8");
      for (const line of txt.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch {}
  }
}

function key() {
  loadEnvFallback();
  const k = process.env.TINYFISH_API_KEY;
  if (!k) throw new Error("TINYFISH_API_KEY is not set. Add it to .env.local.");
  return k;
}

export function loadEnv() { loadEnvFallback(); }

async function call(url, { method = "GET", body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { "X-API-Key": key(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || json?.raw || res.statusText;
    const err = new Error(`TinyFish ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// ---- Endpoint 1: Search ----
export async function search(query, opts = {}) {
  const p = new URLSearchParams({ query, location: "GB", language: "en", ...opts });
  return call(`https://api.search.tinyfish.ai?${p}`);
}

// ---- Endpoint 2: Agent (async run + poll) ----
export async function runAgent({ url, goal, output_schema, maxSeconds = 720 }) {
  const started = await call("https://agent.tinyfish.ai/v1/automation/run-async", {
    method: "POST",
    body: {
      url, goal, output_schema,
      browser_profile: "lite",
      proxy_config: { enabled: true, type: "tinyfish", country_code: "GB" },
      agent_config: { max_duration_seconds: maxSeconds - 60 },
    },
  });
  const id = started.run_id;
  if (!id) throw new Error(started?.error?.message || "Agent run could not be created");
  const deadline = Date.now() + maxSeconds * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    const run = await call(`https://agent.tinyfish.ai/v1/runs/${id}`);
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(run.status)) {
      if (run.status !== "COMPLETED") {
        throw new Error(run.error?.message || `Agent run ${run.status.toLowerCase()}`);
      }
      return { runId: id, result: run.result, finishedAt: run.finished_at || new Date().toISOString() };
    }
  }
  try { await call(`https://agent.tinyfish.ai/v1/runs/${id}/cancel`, { method: "POST" }); } catch {}
  throw new Error("Agent run timed out");
}

// ---- Endpoint 3: Monitor ----
export const createMonitor = (body) => call("https://agent.tinyfish.ai/v1/monitors", { method: "POST", body });
export const runMonitorNow = (id) => call(`https://agent.tinyfish.ai/v1/monitors/${id}/runs`, { method: "POST" });
export const setMonitorStatus = (id, status) =>
  call(`https://agent.tinyfish.ai/v1/monitors/${id}`, { method: "PATCH", body: { status } });
export const deleteMonitor = (id) => call(`https://agent.tinyfish.ai/v1/monitors/${id}`, { method: "DELETE" });

// Simple concurrency limiter (account allows 2 concurrent automation runs).
let active = 0;
const waiting = [];
export async function limited(fn, max = 2) {
  if (active >= max) await new Promise((r) => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}
