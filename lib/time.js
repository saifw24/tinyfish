export const toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const fmtMin = (n) => {
  const a = Math.abs(Math.round(n));
  const h = Math.floor(a / 60), m = a % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
};
export const parseDuration = (s) => {
  const m = /(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?/i.exec(String(s || ""));
  if (!m || (!m[1] && !m[2])) return null;
  return Number(m[1] || 0) * 60 + Number(m[2] || 0);
};
