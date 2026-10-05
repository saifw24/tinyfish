"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { PLACES, STATION_NAMES } from "@/lib/stations";
import { fmtMin } from "@/lib/time";
import { gbp, describeShift, computePicks, targetPick } from "@/lib/analyze";

const STAGES = [
  ["search", "Searching live fares…"],
  ["compare", "Comparing nearby departures…"],
  ["calculate", "Calculating inconvenience…"],
  ["arbitrage", "Looking for arbitrage…"],
];
const order = STAGES.map((s) => s[0]);
const pad = (n) => String(n).padStart(2, "0");
const localISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => localISO(new Date());
const defDate = () => localISO(new Date(Date.now() + 14 * 864e5));
const ago = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "—");
const mins = (iso) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 1 ? "just now" : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
const niceDate = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const changesLabel = (n) => (n === 0 ? "Direct" : `${n} change${n > 1 ? "s" : ""}`);

/* ---------- icons ---------- */
const I = (p) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p} />;
const Pin = () => <I><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></I>;
const Cal = () => <I><rect x="3.5" y="5" width="17" height="15" rx="1.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></I>;
const Clk = () => <I><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></I>;
const CardI = () => <I><rect x="3" y="6" width="18" height="12" rx="1.5" /><path d="M3 10h18M6 15h4" /></I>;
const TrainI = () => <I><rect x="6" y="3.5" width="12" height="13" rx="2.5" /><path d="M6 11h12M9 20l1.5-3.5M15 20l-1.5-3.5" /><circle cx="9.5" cy="14" r=".6" /><circle cx="14.5" cy="14" r=".6" /></I>;
const Chev = ({ className = "chev" }) => <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>;
const Swap = () => <I><path d="M7 7h12l-3-3M17 17H5l3 3" /></I>;
const Arrow = () => <I width="24" height="24"><path d="M5 12h14M13 6l6 6-6 6" /></I>;
const Bell = () => <I width="34" height="34"><path d="M6 17h12l-1.5-2v-4.5a4.5 4.5 0 0 0-9 0V15L6 17zM10 20h4" /></I>;
const Route = () => <svg width="46" height="30" viewBox="0 0 46 30" fill="none" stroke="#e0950b" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><circle cx="8" cy="22" r="5" /><circle cx="38" cy="8" r="5" /><path d="M13 22h8c5 0 4-14 12-14" /></svg>;
const Logo = () => <svg width="54" height="32" viewBox="0 0 54 32" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="butt" aria-hidden="true"><path d="M2 9h38M30 1l12 8-12 8M52 23H14M24 15l-12 8 12 8" /></svg>;
const Ext = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9" /></svg>;

export default function Page() {
  const [tab, setTab] = useState("find");
  const [f, setF] = useState({ from: "London Euston", to: "Manchester Piccadilly", date: defDate(), time: "18:00", flexMinutes: 120, railcard: "16-25", maxChanges: 0, split: false });
  const [target, setTarget] = useState(20);
  const [shift, setShift] = useState(60);
  const [stage, setStage] = useState(null);
  const [err, setErr] = useState(null);
  const [res, setRes] = useState(null);
  const [discovered, setDiscovered] = useState([]);
  const [pre, setPre] = useState(null);
  const [watchCount, setWatchCount] = useState(0);
  const timer = useRef(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const refreshCount = async () => { try { const j = await (await fetch("/api/watch")).json(); setWatchCount((j.watches || []).filter((w) => w.status === "active").length); } catch {} };
  useEffect(() => { refreshCount(); const t = setInterval(refreshCount, 30000); window.addEventListener("watches-changed", refreshCount); return () => { clearInterval(t); window.removeEventListener("watches-changed", refreshCount); }; }, []);
  useEffect(() => () => clearInterval(timer.current), []);

  async function go(e) {
    e.preventDefault(); setErr(null); setRes(null); setDiscovered([]); setStage("search");
    const r = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, flexMinutes: +f.flexMinutes, maxChanges: +f.maxChanges, target: 0 }) });
    const j = await r.json();
    if (!r.ok) { setErr(j.error); setStage(null); return; }
    clearInterval(timer.current);
    timer.current = setInterval(async () => {
      const s = await (await fetch(`/api/search/${j.id}`)).json();
      if (s.discovered) setDiscovered(s.discovered);
      if (s.stage === "done") { setRes(s.result); setStage(null); if (!s.splitPending) clearInterval(timer.current); }
      else if (s.stage === "error") { clearInterval(timer.current); setErr(s.error); setStage(null); }
      else { setStage(s.stage); if (s.partial) setRes(s.partial); }
    }, 2500);
  }

  async function preload() {
    setPre({ busy: true, t: "Pre-loading live fares for 3 hours either side of your time… (a few minutes)" });
    const r = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, flexMinutes: 180, maxChanges: 3, split: false, target: 0, warm: true }) });
    const j = await r.json();
    if (!r.ok) { setPre({ t: j.error, bad: true }); return; }
    const t = setInterval(async () => {
      const s = await (await fetch(`/api/search/${j.id}`)).json();
      if (s.stage === "done") { clearInterval(t); setPre({ t: `Ready. Searches for ${f.from} → ${f.to} on ${f.date} around ${f.time} now answer in seconds (fares retrieved ${mins(s.result.cache.oldest)}, kept fresh while this server runs).` }); }
      else if (s.stage === "error") { clearInterval(t); setPre({ t: s.error, bad: true }); }
    }, 4000);
  }

  return (
    <>
      <header className="nav">
        <div className="brand"><Logo /><span>Student Rail Arbitrage</span></div>
        <nav className="tabs" aria-label="Sections">
          <button className={`tab ${tab === "find" ? "on" : ""}`} onClick={() => setTab("find")}>Find a journey</button>
          <button className={`tab ${tab === "watch" ? "on" : ""}`} onClick={() => setTab("watch")}>Watching{watchCount > 0 && <span className="badge">{watchCount}</span>}</button>
        </nav>
        <div className="navsp" />
      </header>

      <main className="page">
        {tab === "watch" ? <><h2 className="sec">Watching</h2><Watches onChange={refreshCount} /></> : (<>
          <div className="eyebrow">LESS SPEND. MORE WEEKEND.</div>
          <h1 className="hl">A little flexibility. A better fare.</h1>

          <form onSubmit={go}>
            <div className="bar">
              <PlaceField label="From" cls="l" value={f.from} onChange={(v) => setF({ ...f, from: v })} />
              <button type="button" className="swap" aria-label="Swap origin and destination" onClick={() => setF({ ...f, from: f.to, to: f.from })}><Swap /></button>
              <PlaceField label="To" value={f.to} onChange={(v) => setF({ ...f, to: v })} />
              <DateField value={f.date} min={todayISO()} onChange={(v) => setF({ ...f, date: v })} />
              <TimeField value={f.time} onChange={(v) => setF({ ...f, time: v })} />
              <button className="go" disabled={!!stage}>{stage ? "Working…" : "Find savings"}{!stage && <Arrow />}</button>
            </div>
            <div className="chips">
              <label className="chip"><Clk />
                <select value={f.flexMinutes} onChange={set("flexMinutes")} aria-label="Flexibility">
                  <option value={30}>±30 minutes</option><option value={60}>±1 hour</option><option value={120}>±2 hours</option><option value={180}>±3 hours</option>
                </select><Chev /></label>
              <label className="chip"><CardI />
                <select value={f.railcard} onChange={set("railcard")} aria-label="Railcard">
                  <option value="none">No railcard</option><option value="16-25">16–25 Railcard</option><option value="26-30">26–30 Railcard</option><option value="other">Other (no discount)</option>
                </select><Chev /></label>
              <label className="chip"><TrainI />
                <select value={f.maxChanges} onChange={set("maxChanges")} aria-label="Maximum changes">
                  <option value={0}>Direct only</option><option value={1}>Up to 1 change</option><option value={2}>Up to 2 changes</option><option value={3}>Up to 3 changes</option>
                </select><Chev /></label>
              <span className="sep" aria-hidden="true" />
              <label className="sw"><input type="checkbox" checked={f.split} onChange={set("split")} /><span className="track" /><span title="Checks whether separate tickets for parts of the trip are cheaper. Only shown if verified from live data.">Include split tickets ⓘ</span></label>
              <button type="button" className="link" onClick={preload} disabled={pre?.busy} title="Reads live fares in advance so the search is instant">⚡ Pre-load this route</button>
            </div>
            {pre && <div className={`prenote ${pre.bad ? "neg" : ""}`}>{pre.t}</div>}
          </form>

          {stage && (
            <div className="card stages" role="status" aria-live="polite">
              {STAGES.map(([k, label]) => {
                const i = order.indexOf(k), cur = order.indexOf(stage);
                return <div key={k} className={`stage ${i < cur ? "done" : i === cur ? "on" : ""}`}><span className="dot" />{label}</div>;
              })}
              {discovered.length > 0 && <div className="small">Sources found: {discovered.slice(0, 4).map((d) => d.host).join(", ")}</div>}
              <div className="small">If these fares were not pre-loaded, live browser agents are reading them now; results appear as each time slot arrives.</div>
            </div>
          )}
          {err && <div className="err" role="alert">{err}</div>}

          <div className="cols">
            <section aria-label="Results">
              <Results res={res} target={target} shift={shift} loading={!!stage} />
            </section>
            <SidePanel res={res} target={target} setTarget={setTarget} shift={shift} setShift={setShift} onCreated={refreshCount} />
          </div>
          {res && <More res={res} target={target} shift={shift} />}
        </>)}
      </main>
    </>
  );
}

/* ---------- derived view shared by Results / Side / More ---------- */
function useView(res, target, shift) {
  return useMemo(() => {
    const a = res?.analysis;
    if (!a?.ok) return { a, vis: [] };
    const eff = Math.min(shift, res.input.flexMinutes);
    const vis = (a.alternatives || []).filter((x) => x.displacement <= eff);
    const picks = vis.length ? computePicks(vis, a.baseline) : null;
    const tp = target > 0 && vis.length ? targetPick(vis, target) : null;
    const hero = tp || picks?.bestBalance || null;
    return { a, vis, hidden: (a.alternatives || []).length - vis.length, eff, picks, tp, hero, heroLabel: tp ? `MEETS YOUR £${target} TARGET` : "BEST BALANCE", maxSaving: vis.length ? Math.max(...vis.map((x) => x.saving)) : 0 };
  }, [res, target, shift]);
}

/* ---------- results column ---------- */
function Results({ res, target, shift, loading }) {
  const v = useView(res, target, shift);
  const [sort, setSort] = useState("rec");
  const [open, setOpen] = useState(null);
  const head = (
    <div className="sechead">
      <h2 className="sec">Your journey, optimised</h2>
      {res && <span className="fresh">Live fares · retrieved <b>{res.cache?.oldest ? mins(res.cache.oldest) : "just now"}</b> · {res.sources.filter((s) => s.ok).map((s) => s.host).join(", ")}</span>}
    </div>
  );
  if (!res) {
    return (<>{head}{!loading && <div className="empty"><b>Pick a journey and press Find savings.</b><br />We read live fares around your departure time and show the smallest change to your plans that saves the most.</div>}</>);
  }
  const a = v.a;
  if (!a.ok || !a.alternatives?.length) {
    return (<>{head}
      {a.baseline && <NormalCard b={a.baseline} />}
      <div className="card" style={{ marginTop: 14 }}><b>{a.reason}</b></div></>);
  }
  const b = a.baseline;
  const rows = [...v.vis].sort(sort === "cheap" ? (x, y) => x.price - y.price : sort === "fast" ? (x, y) => x.duration - y.duration : (x, y) => y.score - x.score);
  const tagFor = (x) => (x === v.picks?.bestBalance ? "Best balance" : x === v.picks?.cheapest ? "Cheapest" : x === v.picks?.bestArbitrage ? "Best arbitrage" : describeShift(x));
  const h = v.hero;
  return (
    <>
      {head}
      {res.partial && <div className="note" role="status">⏳ Early results: still reading {res.pendingSlots} more time slot{res.pendingSlots > 1 ? "s" : ""}. Numbers may improve.</div>}
      {res.resolved && (!res.input.from.code || !res.input.to.code) && <div className="note">📍 Fares are for the stations the live planner chose: <b>{res.resolved.origin || res.input.from.name}</b> → <b>{res.resolved.destination || res.input.to.name}</b>. Check these are the stations you meant.</div>}
      {h ? (
        <div className="hero">
          <div className="l">
            <span className="tag">{v.heroLabel}</span>
            <div className="big">Save {gbp(h.saving)}</div>
            <div className="lead">{h.displacement === 0 ? "Leave at your preferred time." : `Leave ${fmtMin(h.displacement)} ${h.dir}.`}</div>
            <div className="sub">{h.extra > 0 ? `Just ${fmtMin(h.extra)} extra on the train.` : h.extra < 0 ? `And ${fmtMin(h.extra)} quicker.` : "Same journey time."}</div>
          </div>
          <div className="r">
            <div>
              <div className="leg"><span className="node"><i /></span><div><div className="cap">Your current option</div>
                <div className="tm"><b>{b.departure}</b><span>→ {b.arrival}</span><span>{fmtMin(b.duration)}</span><span className="fare">{gbp(b.price)}</span></div></div></div>
              <div className="leg" style={{ marginTop: 14 }}><span className="node"><i className="f" /></span><div><div className="cap">Our suggestion</div>
                <div className="tm"><b>{h.departure}</b><span>→ {h.arrival}</span><span>{fmtMin(h.duration)}</span><span className="fare">{gbp(h.price)}</span></div></div></div>
            </div>
            {h.sources?.[0]?.url && <a className="view" href={h.sources[0].url} target="_blank" rel="noreferrer">View journey <Ext /></a>}
          </div>
        </div>
      ) : (
        <div className="card"><b>Nothing cheaper within a {fmtMin(v.eff)} time shift.</b> Raise “Maximum time shift” to see {v.hidden} cheaper option{v.hidden === 1 ? "" : "s"}.</div>
      )}

      <div className="cmp">
        <div className="cmphead">
          <h3>Compare departures</h3>
          <div className="seg" role="tablist" aria-label="Sort departures">
            {[["rec", "Recommended"], ["cheap", "Cheapest"], ["fast", "Fastest"]].map(([k, l]) => <button key={k} role="tab" aria-selected={sort === k} className={sort === k ? "on" : ""} onClick={() => setSort(k)}>{l}</button>)}
          </div>
        </div>
        <div className="tw">
          <table className="cmpt">
            <thead><tr><th>Departure</th><th>Arrival</th><th>Duration</th><th>Fare</th><th>Saving</th><th /></tr></thead>
            <tbody>
              {rows.map((x) => {
                const k = x.departure + x.arrival;
                return (
                  <FragmentRow key={k} x={x} sel={x === h} tag={tagFor(x)} open={open === k} toggle={() => setOpen(open === k ? null : k)} />
                );
              })}
              <tr><td className="dep"><b>{b.departure}</b><small className="m">{b.displacement ? "Your normal option" : "Your preferred time"}</small></td>
                <td>{b.arrival}</td><td>{fmtMin(b.duration)} · {changesLabel(b.changes)}</td><td className="fare">{gbp(b.price)}</td><td className="mutec">—</td><td /></tr>
            </tbody>
          </table>
        </div>
        {v.hidden > 0 && <div className="small" style={{ padding: "6px 4px 14px" }}>{v.hidden} more cheaper option{v.hidden > 1 ? "s" : ""} hidden by your {fmtMin(v.eff)} maximum time shift.</div>}
      </div>
    </>
  );
}

function FragmentRow({ x, sel, tag, open, toggle }) {
  return (
    <>
      <tr className={`clk ${sel ? "sel" : ""}`} onClick={toggle} tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle())} aria-expanded={open}>
        <td className="dep"><b>{x.departure}</b><small className={tag === describeShift(x) ? "m" : ""}>{tag}</small></td>
        <td>{x.arrival}</td><td>{fmtMin(x.duration)} · {changesLabel(x.changes)}</td>
        <td className="fare">{gbp(x.price)}</td><td className="save">{gbp(x.saving)}</td>
        <td><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: open ? "rotate(90deg)" : "none" }} aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg></td>
      </tr>
      {open && (
        <tr className="xp"><td colSpan={6}>
          <b>Student Arbitrage Score: {x.score}/100</b> (this app's own ranking, not an industry metric)
          <ul>{x.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          {[x.operator, x.ticketType].filter(Boolean).join(" · ")}{x.sources?.[0] ? ` · source ${x.sources[0].host}, retrieved ${ago(x.sources[0].retrievedAt)}` : ""}
          {x.railcardUnverified && <div className="neg">Could not verify the railcard fare from the live source.</div>}
        </td></tr>
      )}
    </>
  );
}

/* ---------- right-hand panel ---------- */
function SidePanel({ res, target, setTarget, shift, setShift, onCreated }) {
  const v = useView(res, target, shift);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const ready = !!v.a?.ok && (v.a.alternatives || []).length > 0;
  const h = v.hero;

  async function create() {
    setBusy(true); setMsg(null);
    const best = Math.min(v.a.baseline.price, ...v.a.alternatives.map((x) => x.price));
    const r = await fetch("/api/watch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: res.input, condition: { type: "saving_within", saving: target, withinMinutes: v.eff }, email, sources: res.sources.filter((s) => s.ok), baselinePrice: v.a.baseline.price, bestPrice: best }) });
    const j = await r.json();
    setBusy(false);
    setMsg(r.ok ? { ok: true, t: "Alert created. See it under Watching." } : { ok: false, t: j.error });
    if (r.ok) { window.dispatchEvent(new Event("watches-changed")); onCreated?.(); }
  }
  const miss = ready && target > 0 && !v.tp;
  return (
    <aside className="side" aria-label="Savings target">
      <h2>Make the saving worth it.</h2>
      <div className="lab" id="tl">Your target saving</div>
      <div className="tgt">{target > 0 ? gbp(target) : "Any"}</div>
      <input className="rng" type="range" min="0" max="50" step="1" value={target} aria-labelledby="tl" style={{ "--p": `${(target / 50) * 100}%` }} onChange={(e) => setTarget(+e.target.value)} />
      <div className="scale"><span>£0</span><span>£50</span></div>
      {miss && <div className="msg bad">No journey saves {gbp(target)} within {fmtMin(v.eff)}. Best available: {gbp(v.maxSaving)}.</div>}

      <div className="shift">
        <span id="ts">Maximum time shift</span>
        <label className="chip"><select aria-labelledby="ts" value={shift} onChange={(e) => setShift(+e.target.value)}>
          <option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={120}>2 hours</option><option value={180}>3 hours</option>
        </select><Chev /></label>
      </div>

      <div className="wj"><Bell /><div><h4>Watch this journey</h4><p>We’ll let you know when a fare meets your target.</p></div></div>
      <input className="mail" type="email" placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email for alerts (optional)" />
      <button className="alertbtn" onClick={create} disabled={!ready || target <= 0 || busy}>{busy ? "Setting up…" : "Create alert"}</button>
      {!ready && <div className="msg" style={{ color: "var(--mute)" }}>Run a search first.</div>}
      {ready && target <= 0 && <div className="msg" style={{ color: "var(--mute)" }}>Set a target above £0 to create an alert.</div>}
      {msg && <div className={`msg ${msg.ok ? "ok" : "bad"}`}>{msg.t}</div>}

      <div className="eff">
        <Route />
        <div>
          {h && h.perExtraMinute != null
            ? <><b>{gbp(+h.perExtraMinute.toFixed(2))}</b> saved per extra minute of travel</>
            : h ? <><b>No extra travel time</b> on the best option</> : <>£ saved per extra minute of travel</>}
          <p>Based on the best alternative to your current option.</p>
        </div>
      </div>
    </aside>
  );
}

/* ---------- below the fold: conclusions, full detail, sources, advanced alerts ---------- */
function NormalCard({ b }) {
  return (
    <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: "6px 24px", alignItems: "baseline", fontSize: 18 }}>
      <b>{b.departure} → {b.arrival}</b><b>{gbp(b.price)}</b><span>{fmtMin(b.duration)}</span><span>{changesLabel(b.changes)}</span>
      <span className="mute">{[b.operator, b.ticketType, b.railcardApplied ? "railcard fare" : null].filter(Boolean).join(" · ")}</span>
      {b.railcardUnverified && <span className="neg small">Could not verify the railcard fare from the live source.</span>}
    </div>
  );
}

function More({ res, target, shift }) {
  const v = useView(res, target, shift);
  const a = v.a;
  const p = v.picks;
  return (
    <div className="more">
      <h2 className="sec" style={{ marginTop: 22 }}>The detail</h2>
      {a?.baseline && <><h3 style={{ margin: "6px 0 10px" }}>Your normal option</h3><NormalCard b={a.baseline} /></>}
      {p && (
        <div className="picks">
          <Pick title="🏆 Best Arbitrage" o={p.bestArbitrage}>
            <b>{describeShift(p.bestArbitrage)} and save {gbp(p.bestArbitrage.saving)}.</b><br />
            {p.bestArbitrage.extra > 0 ? `You only spend ${fmtMin(p.bestArbitrage.extra)} more travelling.` : "No extra travel time."}<br />
            <b className="pos">{p.bestArbitrage.perExtraMinute != null ? `That's ${gbp(+p.bestArbitrage.perExtraMinute.toFixed(2))} saved for every extra minute of travel.` : `${gbp(+p.bestArbitrage.perInconvenienceMinute.toFixed(2))} saved per minute of schedule change.`}</b>
          </Pick>
          <Pick title="💸 Cheapest" o={p.cheapest}>Save {gbp(p.cheapest.saving)} compared with your preferred journey.<br /><span className="mute">Trade-off: {describeShift(p.cheapest).toLowerCase()}{p.cheapest.extra > 0 ? `, ${fmtMin(p.cheapest.extra)} longer` : ""}.</span></Pick>
          <Pick title="⚡ Best balance" o={p.bestBalance}>Save {gbp(p.bestBalance.saving)} while only changing your schedule by {fmtMin(p.bestBalance.displacement)}.</Pick>
          {p.notWorth && <Pick title="😭 Not worth it" o={p.notWorth} bad>You save another {gbp(p.notWorth.saving - p.bestArbitrage.saving)}, but it costs {fmtMin(p.notWorth.inconvenience - p.bestArbitrage.inconvenience)} more inconvenience{p.notWorth.changes > p.bestArbitrage.changes ? ` and needs ${p.notWorth.changes} change${p.notWorth.changes > 1 ? "s" : ""}` : ""}.</Pick>}
        </div>
      )}
      {v.vis.length > 0 && (<>
        <h3 style={{ margin: "26px 0 10px" }}>All {v.vis.length} way{v.vis.length > 1 ? "s" : ""} to save, ranked</h3>
        <div className="card tw" style={{ padding: 0 }}>
          <table className="cmpt" style={{ minWidth: 820 }}>
            <thead><tr><th>Option</th><th>Depart</th><th>Arrive</th><th>Duration</th><th>Changes</th><th>Price</th><th>Saving</th><th>Inconvenience</th><th>Score</th></tr></thead>
            <tbody>{v.vis.map((x) => (
              <tr key={x.departure + x.arrival}>
                <td>{describeShift(x)}</td><td>{x.departure}</td><td>{x.arrival}</td><td>{fmtMin(x.duration)}</td><td>{x.changes === 0 ? "Direct" : x.changes}</td>
                <td className="fare">{gbp(x.price)}</td><td className="save">−{gbp(x.saving)} <span className="small">({x.pct.toFixed(0)}%)</span></td>
                <td><span className={x.displacement ? "neg" : "pos"}>{x.displacement ? `${fmtMin(x.displacement)} ${x.dir}` : "on time"}</span> · <span className={x.extra > 0 ? "neg" : "pos"}>{x.extra > 0 ? `+${fmtMin(x.extra)}` : x.extra < 0 ? `−${fmtMin(x.extra)}` : "same"} travel</span>{x.perExtraMinute != null && <div className="small">{gbp(+x.perExtraMinute.toFixed(2))}/extra min</div>}</td>
                <td><b title={x.reasons.join("\n")}>{x.score}</b></td>
              </tr>))}</tbody>
          </table>
        </div>
        <p className="small"><b>Student Arbitrage Score (0–100)</b> is this app's own ranking, not an industry metric. It rewards saving vs your normal option (35), small schedule shift (25), little extra travel time (25) and fewer changes (15).</p>
      </>)}
      {res.input.split && <Split res={res} />}
      {(a?.notes || []).map((n) => <div key={n} className="small" style={{ marginTop: 6 }}>ℹ️ {n}</div>)}
      <SourceList res={res} />
      {a?.baseline && <AdvancedAlert res={res} />}
    </div>
  );
}

function Pick({ title, o, bad, children }) {
  return (
    <div className="card pick">
      <h3>{title}</h3>
      <div className={`n ${bad ? "neg" : "pos"}`}>{gbp(o.price)}</div>
      <div className="small" style={{ marginBottom: 6 }}>{o.departure} → {o.arrival} · {fmtMin(o.duration)} · {changesLabel(o.changes).toLowerCase()}</div>
      {children}
    </div>
  );
}

function Split({ res }) {
  const s = res.split;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 style={{ margin: "0 0 6px" }}>✂️ Split-ticket analysis</h3>
      {s ? (<>
        <div>Normal fare: <b>{gbp(s.normalFare)}</b></div>
        <ul>{s.legs.map((l, i) => <li key={i}>{l.from} → {l.to}: <b>{gbp(l.price_gbp)}</b></li>)}</ul>
        <div>Split total: <b>{gbp(s.total)}</b> · <b className="pos">Saving: {gbp(s.saving)}</b></div>
        <div className="small" style={{ marginTop: 6 }}>Extra complexity: {s.legs.length} separate tickets, each valid only for its own section; check that your train calls at the split station. {!s.comparableToBaseline && "The normal fare here differs from your normal option above, so compare with care."}</div>
        {s.source && <div className="small">Source: {s.source.host} · retrieved {ago(s.source.retrievedAt)}</div>}
      </>) : <div className="mute">{res.splitNote || "Checking split-ticket options on the live source…"}</div>}
    </div>
  );
}

function SourceList({ res }) {
  const c = res.cache;
  return (
    <div className="small" style={{ marginTop: 16 }}>
      {c && c.totalSlots > 0 && <div>{c.cachedSlots === c.totalSlots ? "⚡ Instant: " : c.cachedSlots ? `${c.cachedSlots} of ${c.totalSlots} time slots instant: ` : "Read live now: "}fares retrieved from the live source {c.oldest ? mins(c.oldest) : ""}.</div>}
      {res.sources.map((s) => (
        <div key={s.host + (s.error || "")}>
          {s.ok ? <>Source: <a href={s.url} target="_blank" rel="noreferrer">{s.host}</a> · {s.count} departures read · retrieved {ago(s.retrievedAt)} ({mins(s.retrievedAt)})</>
            : <>Could not verify fares from {s.host}: {s.error}.</>}
        </div>))}
    </div>
  );
}

function AdvancedAlert({ res }) {
  const { analysis: a } = res;
  const best = a.alternatives?.length ? Math.min(a.baseline.price, ...a.alternatives.map((x) => x.price)) : a.baseline.price;
  const [price, setPrice] = useState(Math.max(1, Math.floor(best - 1)));
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState(null);
  async function go() {
    const r = await fetch("/api/watch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: res.input, condition: { type: "price_below", value: +price }, email, sources: res.sources.filter((s) => s.ok), baselinePrice: a.baseline.price, bestPrice: best }) });
    const j = await r.json();
    setMsg(r.ok ? { ok: true, t: "Watching. See it under Watching." } : { ok: false, t: j.error });
    if (r.ok) window.dispatchEvent(new Event("watches-changed"));
  }
  return (
    <div className="card" style={{ marginTop: 22 }}>
      <h3 style={{ margin: "0 0 10px" }}>🔔 Alert me when the fare falls below a price</h3>
      <div className="row">
        <label className="fld">Fare below (£)<input type="number" min="1" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <label className="fld">Email (optional)<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@uni.ac.uk" /></label>
        <button className="btn" onClick={go}>Watch</button>
      </div>
      {msg && <div className={`msg ${msg.ok ? "ok" : "bad"}`}>{msg.t}</div>}
    </div>
  );
}

/* ---------- Watching tab ---------- */
function Watches({ onChange }) {
  const [ws, setWs] = useState(null);
  const [busy, setBusy] = useState({});
  const load = async () => { try { setWs((await (await fetch("/api/watch")).json()).watches || []); } catch { setWs([]); } onChange?.(); };
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);
  const check = async (id) => { setBusy((b) => ({ ...b, [id]: true })); await fetch(`/api/watch/${id}`, { method: "POST" }); await load(); setBusy((b) => ({ ...b, [id]: false })); };
  const del = async (id) => { await fetch(`/api/watch/${id}`, { method: "DELETE" }); load(); };
  if (!ws) return <div className="mute">Loading…</div>;
  if (!ws.length) return <div className="empty"><b>Nothing watched yet.</b><br />Run a search, set a target saving and press Create alert.</div>;
  return (
    <div>
      {ws.map((w) => (
        <div key={w.id} className="card" style={{ marginBottom: 14 }}>
          <b style={{ fontSize: 18 }}>{w.input.from.name} → {w.input.to.name}</b> · {w.input.date} · around {w.input.time}
          <div className="mute">{w.condition.type === "price_below" ? `Fare below ${gbp(w.condition.value)}` : `Save ≥ ${gbp(w.condition.saving)} within ${fmtMin(w.condition.withinMinutes)} of ${w.input.time}`} · {w.mode === "in-app-scheduler" ? "re-checked by in-app scheduler" : "TinyFish Monitor schedule + webhook"}{w.email ? (w.emailConfigured ? ` · email ${w.email}` : " · email not configured on server (in-app alerts only)") : ""}</div>
          <div className="small">Last check: {ago(w.lastCheck)} · {w.lastNote}{w.lastBest != null ? ` · best fare ${gbp(w.lastBest)}` : ""}</div>
          {w.alerts.map((al) => (
            <div key={al.at} className="alertrow"><b>🚨 PRICE DROP</b><br />{al.message}<div className="small">{ago(al.at)}{al.emailed ? " · emailed" : ""}</div></div>))}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn ghost" onClick={() => check(w.id)} disabled={busy[w.id]}>{busy[w.id] ? "Checking live…" : "Check now"}</button>
            <button className="btn ghost" onClick={() => del(w.id)}>Stop watching</button>
          </div>
        </div>))}
    </div>
  );
}

/* ---------- custom pickers ---------- */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  return { open, setOpen, ref };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function DateField({ value, min, onChange }) {
  const { open, setOpen, ref } = usePopover();
  const sel = new Date(value + "T12:00:00");
  const [view, setView] = useState({ y: sel.getFullYear(), m: sel.getMonth() });
  useEffect(() => { if (open) setView({ y: sel.getFullYear(), m: sel.getMonth() }); }, [open]);
  const first = new Date(view.y, view.m, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-first
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const today = todayISO();
  const minD = new Date(min + "T12:00:00");
  const canPrev = view.y > minD.getFullYear() || (view.y === minD.getFullYear() && view.m > minD.getMonth());
  const step = (d) => { const n = new Date(view.y, view.m + d, 1); setView({ y: n.getFullYear(), m: n.getMonth() }); };
  return (
    <div className="field fld-pop" ref={ref}>
      <button type="button" className="fbtn" onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open}>
        <Cal /><span className="in"><small>Date</small><span className="val">{niceDate(value)}</span></span><Chev />
      </button>
      {open && (
        <div className="pop cal" role="dialog" aria-label="Choose travel date">
          <div className="calhead">
            <button type="button" className="nb" onClick={() => step(-1)} disabled={!canPrev} aria-label="Previous month"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg></button>
            <b>{MONTHS[view.m]} {view.y}</b>
            <button type="button" className="nb" onClick={() => step(1)} aria-label="Next month"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg></button>
          </div>
          <div className="calgrid" role="grid">
            {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => <span key={d} className="dow">{d}</span>)}
            {cells.map((d, i) => {
              if (!d) return <span key={"e" + i} />;
              const iso = `${view.y}-${pad(view.m + 1)}-${pad(d)}`;
              const dis = iso < min;
              return (
                <button type="button" key={iso} disabled={dis} aria-label={niceDate(iso)} aria-pressed={iso === value}
                  className={`day ${iso === value ? "on" : ""} ${iso === today ? "today" : ""}`}
                  onClick={() => { onChange(iso); setOpen(false); }}>{d}</button>
              );
            })}
          </div>
          <div className="calfoot"><button type="button" className="link" onClick={() => { onChange(today); setOpen(false); }}>Today</button></div>
        </div>
      )}
    </div>
  );
}

function TimeField({ value, onChange }) {
  const { open, setOpen, ref } = usePopover();
  const [h, m] = value.split(":").map(Number);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = [...new Set([...Array.from({ length: 12 }, (_, i) => i * 5), m])].sort((a, b) => a - b);
  const hr = useRef(null), mr = useRef(null);
  useEffect(() => {
    if (!open) return;
    hr.current?.querySelector(".on")?.scrollIntoView({ block: "center" });
    mr.current?.querySelector(".on")?.scrollIntoView({ block: "center" });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    hr.current?.querySelector(".on")?.scrollIntoView({ block: "nearest" });
    mr.current?.querySelector(".on")?.scrollIntoView({ block: "nearest" });
  }, [value]);
  const set = (nh, nm) => onChange(`${pad(nh)}:${pad(nm)}`);
  return (
    <div className="field r fld-pop" ref={ref}>
      <button type="button" className="fbtn" onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open}>
        <Clk /><span className="in"><small>Time</small><span className="val">{value}</span></span><Chev />
      </button>
      {open && (
        <div className="pop tpick" role="dialog" aria-label="Choose departure time">
          <div className="cols2">
            <div><div className="colh">Hour</div><div className="scroll" ref={hr}>{hours.map((x) => <button type="button" key={x} className={`opt ${x === h ? "on" : ""}`} onClick={() => set(x, m)}>{pad(x)}</button>)}</div></div>
            <div><div className="colh">Min</div><div className="scroll" ref={mr}>{minutes.map((x) => <button type="button" key={x} className={`opt ${x === m ? "on" : ""}`} onClick={() => set(h, x)}>{pad(x)}</button>)}</div></div>
          </div>
          <div className="calfoot presets">
            {["07:00", "12:00", "18:00", "21:00"].map((t) => <button type="button" key={t} className="link" onClick={() => { onChange(t); setOpen(false); }}>{t}</button>)}
            <button type="button" className="btn done" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

function PlaceField({ label, value, onChange, cls = "" }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef(null);
  const id = useRef("pl" + Math.random().toString(36).slice(2, 7)).current;
  const norm = (x) => String(x).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9 ]/g, "");
  const q = norm(value).trim();
  const matches = useMemo(() => {
    if (!q) return PLACES.slice(0, 8);
    const out = [];
    for (const name of PLACES) {
      const n = norm(name);
      const i = n.indexOf(q);
      if (i === -1) continue;
      out.push({ name, rank: i === 0 ? 0 : n[i - 1] === " " ? 1 : 2 });
    }
    return out.sort((a, b) => a.rank - b.rank).slice(0, 8).map((x) => x.name);
  }, [q]);
  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    if (!open) return;
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);
  const choose = (name) => { onChange(name); setOpen(false); };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, matches.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && open && matches[active]) { e.preventDefault(); choose(matches[active]); }
    else if (e.key === "Escape") setOpen(false);
    else if (e.key === "Tab") setOpen(false);
  };
  const hi = (name) => {
    const i = norm(name).indexOf(q);
    if (!q || i === -1 || norm(name) !== name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9 ]/g, "")) return name;
    return <>{name.slice(0, i)}<mark>{name.slice(i, i + q.length)}</mark>{name.slice(i + q.length)}</>;
  };
  return (
    <div className={`field ${cls} fld-pop`} ref={ref}>
      <label className="fbtn" htmlFor={id} style={{ cursor: "text" }}>
        <Pin />
        <span className="in"><small>{label}</small>
          <input id={id} role="combobox" aria-expanded={open} aria-controls={id + "-l"} aria-autocomplete="list" aria-activedescendant={open && matches[active] ? `${id}-o${active}` : undefined}
            autoComplete="off" spellCheck="false" value={value} placeholder="Station or place"
            onChange={(e) => { onChange(e.target.value); setOpen(true); }}
            onFocus={(e) => { setOpen(true); e.target.select(); }}
            onBlur={() => { const m = PLACES.find((p) => norm(p) === norm(value)); if (m && m !== value) onChange(m); }}
            onKeyDown={onKey} required />
        </span>
      </label>
      {open && (
        <ul className="pop plist" id={id + "-l"} role="listbox" aria-label={`${label} suggestions`}>
          {matches.length === 0 && <li className="none">No match. Try a station, city, airport or university.</li>}
          {matches.map((name, i) => (
            <li key={name} id={`${id}-o${i}`} role="option" aria-selected={i === active} className={i === active ? "act" : ""}
              onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); choose(name); }}>
              <Pin /><span className="nm">{hi(name)}</span>
              <span className="kind">{STATION_NAMES.has(name) ? "Station" : "Place"}</span>
            </li>))}
        </ul>
      )}
    </div>
  );
}
