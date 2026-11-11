// Date, formatting and general helpers. All dates are YYYY-MM-DD strings handled in UTC to avoid DST drift.
// Times are "YYYY-MM-DDTHH:MM" strings in a single reference clock (treated as UTC for arithmetic).

export const D = {
  parse(s) { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); },
  fmt(t) { return new Date(t).toISOString().slice(0, 10); },
  add(s, n) { return D.fmt(D.parse(s) + n * 864e5); },
  diff(a, b) { return Math.round((D.parse(b) - D.parse(a)) / 864e5); },
  dow(s) { return new Date(D.parse(s)).getUTCDay(); },
  isWeekend(s) { const d = D.dow(s); return d === 0 || d === 6; },
  range(start, n) { return Array.from({ length: n }, (_, i) => D.add(start, i)); },
  between(start, end) { const n = D.diff(start, end) + 1; return n > 0 ? D.range(start, n) : []; },
  today() { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; },
  month(s) { return s.slice(0, 7); },
  quarter(s) { const m = Number(s.slice(5, 7)); return `${s.slice(0, 4)}-Q${Math.ceil(m / 3)}`; },
  quarterStart(s) { const m = Number(s.slice(5, 7)); const qm = (Math.ceil(m / 3) - 1) * 3 + 1; return `${s.slice(0, 4)}-${String(qm).padStart(2, '0')}-01`; },
  quarterEnd(s) { const qs = D.quarterStart(s); const [y, m] = qs.split('-').map(Number); return D.fmt(Date.UTC(y, m - 1 + 3, 1) - 864e5); },
  weekStart(s) { const d = D.dow(s); return D.add(s, -((d + 6) % 7)); }, // Monday
  label(s, opts = { month: 'short', day: 'numeric' }) { return new Date(D.parse(s)).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts }); },
  long(s) { return D.label(s, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); },
  dowShort(s) { return ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][D.dow(s)]; },
};

export const T = {
  ms(s) { return Date.parse(s.length === 16 ? s + ':00Z' : s); },
  hours(a, b) { return (T.ms(b) - T.ms(a)) / 36e5; },
  addH(s, h) { return new Date(T.ms(s) + h * 36e5).toISOString().slice(0, 16); },
  date(s) { return s.slice(0, 10); },
  hm(s) { return s ? s.slice(11, 16) : ''; },
  short(s) { return s ? `${D.label(s.slice(0, 10))} ${s.slice(11, 16)}` : '—'; },
  now() { return new Date().toISOString(); },
  stamp(iso) { const d = new Date(iso); return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); },
};

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
export const clone = o => JSON.parse(JSON.stringify(o));
export const sum = a => a.reduce((s, x) => s + (Number(x) || 0), 0);
export const round1 = n => Math.round(n * 10) / 10;
export const by = (k, dir = 1) => (a, b) => (typeof k === 'function' ? (k(a) > k(b) ? 1 : k(a) < k(b) ? -1 : 0) : (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0)) * dir;
export function variance(arr) { if (!arr.length) return 0; const m = sum(arr) / arr.length; return sum(arr.map(x => (x - m) ** 2)) / arr.length; }
export function stdev(arr) { return Math.sqrt(variance(arr)); }

// Seeded PRNG (mulberry32) — reproducible lottery.
export function rng(seed) {
  let a = typeof seed === 'number' ? seed : [...String(seed)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0, 1779033703);
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function shuffle(arr, seed) { const r = rng(seed); const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export function csv(rows) {
  return rows.map(r => r.map(v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
}
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}
export function download(name, content, type = 'text/csv') {
  const blob = new Blob([content], { type }); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
export const money = n => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export const hrs = n => `${round1(Number(n) || 0).toFixed(1)}`;
