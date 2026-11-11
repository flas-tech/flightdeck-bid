// Scheduling engine: coverage, roster generation, fairness, time-off checks, bidding awards and duty/rest compliance.
import { D, T, clone, sum, round1, shuffle, stdev, by } from './util.js';
import { S, TODAY, crewById, acById, catByCode, activeCrew, horizon, isLocked, audit, notify, crewName } from './store.js';
import { requiredRest, citeFor } from './rules.js';

// OBS = line-check observation day: counts as a flight work day, but the observer is not available for coverage.
export const isWork = code => code === 'W' || code === 'SB' || code === 'OBS';
export const OBS = 'OBS';

// ------------------------------------------------------------------ line-check observers
export const OBS_KINDS = { any: 'Standards Captain or Peer Observer', standards: 'Standards Captain / Check Airman only', peer: 'Peer Observer' };
export function canObserve(c, kind = 'any') {
  if (!c || c.status !== 'active') return false;
  if (kind === 'standards') return !!c.checkAirman;
  if (kind === 'peer') return !!(c.peerObserver || c.checkAirman);
  return !!(c.checkAirman || c.peerObserver);
}
export const observerLabel = c => c?.checkAirman ? 'Standards Captain / Check Airman' : c?.peerObserver ? 'Peer Observer' : '';
export const observers = () => activeCrew().filter(c => canObserve(c));
export const tripCrewIds = t => [t.crew?.pic, t.crew?.sic, t.crew?.obs].filter(Boolean);
export function seatOf(t, id) { return t.crew.pic === id ? 'pic' : t.crew.sic === id ? 'sic' : t.crew.obs === id ? 'obs' : null; }
// All observer resource uses on a date: calendar-day assignments plus trip observers (when the Trip module is on).
export function observationsOn(date, { trips = S.trips, obs = S.observations || [] } = {}) {
  const out = [];
  for (const o of obs) if (o.status !== 'cancelled' && o.start <= date && o.end >= date) out.push({ crewId: o.crewId, kind: o.kind, obsId: o.id, tripId: null, observed: o.observedIds || [], note: o.note });
  if (S.dept.modules.trips) for (const t of trips) if (t.crew?.obs && ['Tentative', 'Firm', 'Completed'].includes(t.status) && tripDates(t).includes(date)) out.push({ crewId: t.crew.obs, kind: t.observer?.kind || 'any', obsId: null, tripId: t.id, number: t.number, observed: [t.crew.pic, t.crew.sic].filter(Boolean) });
  return out;
}
export function observerOn(crewId, date, opts) { return observationsOn(date, opts).find(o => o.crewId === crewId) || null; }

const offCode = () => S.dept.offCode;

// ------------------------------------------------------------------ leave helpers
export function reqDates(r) { return D.between(r.start, r.end); }
export function leaveOn(crewId, date, reqs = S.requests, statuses = ['approved']) {
  return reqs.find(r => r.crewId === crewId && statuses.includes(r.status) && r.start <= date && r.end >= date && catByCode(r.code)?.unavailable !== false);
}
export function trainingDates(crewId, reqs = S.requests) {
  const out = new Set();
  for (const r of reqs) if (r.crewId === crewId && r.status === 'approved' && catByCode(r.code)?.training) reqDates(r).forEach(d => out.add(d));
  return out;
}
export function bufferDay(crewId, date) {
  const tb = S.dept.trainingBuffer; if (!tb?.enabled) return false;
  const t = trainingDates(crewId); if (t.has(date)) return false;
  const before = t.has(D.add(date, 1)), after = t.has(D.add(date, -1));
  return tb.placement === 'before' ? before : tb.placement === 'after' ? after : (before || after);
}

// ------------------------------------------------------------------ qualifications & demand
export function qualifies(c, type, seat, date = TODAY) {
  if (type === '*') return true;
  const has = c.quals.some(q => q.type === type && (q.seat === seat || (seat === 'SIC' && q.seat === 'PIC' && S.dept.coverage.picCanFillSic)));
  if (!has) return false;
  return !currencyBlocks(c, type, date);
}
export function currencyBlocks(c, type, date = TODAY) {
  return (c.currency || []).find(x => x.expires && x.expires < date && (x.type == null || x.type === '' || x.type === type)) || null;
}
export function aircraftDown(a, date) {
  if (a.status !== 'active') return a.status;
  const d = (a.downtime || []).find(x => x.start <= date && x.end >= date);
  return d ? d.reason || 'Downtime' : null;
}
export function tripType(t) { return acById(t.tail)?.type || t.aircraftPref || ''; }
export function tripStart(t) { return t.legs.length ? t.legs.reduce((m, l) => l.dep < m ? l.dep : m, t.legs[0].dep) : null; }
export function tripEnd(t) { return t.legs.length ? t.legs.reduce((m, l) => l.arr > m ? l.arr : m, t.legs[0].arr) : null; }
export function tripDates(t) { const s = tripStart(t), e = tripEnd(t); return s && e ? D.between(T.date(s), T.date(e)) : []; }
export const liveTrip = t => ['Tentative', 'Firm', 'Completed'].includes(t.status);
export function tripsOn(date) { return S.dept.modules.trips ? S.trips.filter(t => liveTrip(t) && tripDates(t).includes(date)) : []; }
function minCrewFor(type) { return Math.max(1, ...S.aircraft.filter(a => a.type === type).map(a => a.minCrew || 1)); }
function crewSlots(type, n, why) { const out = []; for (let i = 0; i < n; i++) { out.push({ type, seat: 'PIC', why }); if (minCrewFor(type) >= 2) out.push({ type, seat: 'SIC', why }); } return out; }

export function requiredSlots(date) {
  const cov = S.dept.coverage; const byType = {};
  for (const a of S.aircraft) if (!aircraftDown(a, date)) byType[a.type] = (byType[a.type] || 0) + 1;
  const tripCrews = {};
  for (const t of tripsOn(date)) { const ty = tripType(t); if (ty) tripCrews[ty] = (tripCrews[ty] || 0) + 1; }
  const duty = [], standby = [];
  const typesAll = new Set([...Object.keys(byType), ...Object.keys(tripCrews)]);
  for (const ty of typesAll) {
    const n = byType[ty] || 0; const util = Math.ceil(n * (cov.utilizationPct / 100) * (1 + cov.bufferPct / 100)); const trips = tripCrews[ty] || 0;
    let crews = 0, sb = 0;
    if (cov.model === 'full') crews = Math.max(n, trips);
    else if (cov.model === 'utilization') crews = Math.max(util, trips);
    else if (cov.model === 'standby') { crews = trips; sb = Number(cov.standbyCrewsPerType) || 0; }
    else { crews = Math.max(util, trips); sb = Number(cov.standbyCrewsPerType) || 0; }
    duty.push(...crewSlots(ty, crews, trips >= crews && trips ? 'trip demand' : cov.model));
    standby.push(...crewSlots(ty, sb, 'standby'));
  }
  return { duty, standby };
}

// Max bipartite matching (Kuhn). cands are crew objects in preference order.
export function match(slots, cands, date) {
  const order = slots.map((s, i) => ({ s, i, n: cands.filter(c => qualifies(c, s.type, s.seat, date)).length })).sort((a, b) => (a.s.seat === 'PIC' ? 0 : 1) - (b.s.seat === 'PIC' ? 0 : 1) || a.n - b.n);
  const ownerOf = new Map(); // crewId -> slot index
  const elig = slots.map(s => cands.filter(c => qualifies(c, s.type, s.seat, date)));
  function tryS(i, seen) {
    for (const c of elig[i]) {
      if (seen.has(c.id)) continue; seen.add(c.id);
      if (!ownerOf.has(c.id) || tryS(ownerOf.get(c.id), seen)) { ownerOf.set(c.id, i); return true; }
    }
    return false;
  }
  for (const { i } of order) tryS(i, new Set());
  const bySlot = new Map([...ownerOf].map(([cid, i]) => [i, cid]));
  return { assign: bySlot, short: slots.filter((_, i) => !bySlot.has(i)) };
}

function groupOf(c) { return S.dept.groups.find(g => g.name === c.group) || { name: c.group, kind: 'count', minOnDuty: 0 }; }

// Coverage using roster cells (W/SB) where present, else everyone not on leave.
export function coverage(date, { cells = S.roster.cells, reqs = S.requests, remove = [], leaveOnly = false } = {}) {
  const row = cells[date];
  const avail = c => {
    if (c.status !== 'active' || remove.includes(c.id)) return false;
    if (observerOn(c.id, date)) return false; // observers occupy a resource and leave the available pool
    if (leaveOnly || !row) return !leaveOn(c.id, date, reqs);
    return isWork(row[c.id]);
  };
  const res = { date, short: [], groups: [], slots: 0 };
  const { duty, standby } = requiredSlots(date);
  const slots = [...duty, ...standby]; res.slots = slots.length;
  const pil = activeCrew().filter(c => groupOf(c).kind === 'seat' && avail(c));
  res.short = match(slots, pil, date).short;
  for (const g of S.dept.groups.filter(g => g.kind === 'count')) {
    const have = activeCrew().filter(c => c.group === g.name && avail(c)).length;
    res.groups.push({ group: g.name, need: Number(g.minOnDuty) || 0, have });
  }
  res.ok = !res.short.length && res.groups.every(g => g.have >= g.need);
  res.available = pil.length; res.observers = observationsOn(date).length;
  return res;
}
export function shortText(cov) {
  const parts = [];
  const m = {}; for (const s of cov.short) { const k = `${s.type} ${s.seat}`; m[k] = (m[k] || 0) + 1; }
  for (const [k, n] of Object.entries(m)) parts.push(`${n}× ${k}`);
  for (const g of cov.groups) if (g.have < g.need) parts.push(`${g.need - g.have}× ${g.group}`);
  return parts.join(', ');
}

// ------------------------------------------------------------------ roster rules
function codeAt(cells, id, d) { return cells[d]?.[id]; }
export function streakIfWork(cells, id, date) {
  let n = 1, d = D.add(date, -1); while (isWork(codeAt(cells, id, d))) { n++; d = D.add(d, -1); }
  d = D.add(date, 1); while (isWork(codeAt(cells, id, d))) { n++; d = D.add(d, 1); }
  return n;
}
function isOffDay(code) {
  if (code == null) return true; // unknown / outside roster treated as off
  if (isWork(code)) return false;
  if (code === offCode()) return true;
  return S.dept.weeklyOff.countsLeave !== false; // leave counts as a day off unless configured otherwise
}
export function weeklyOffIfWork(cells, id, date) {
  const def = S.dept.weeklyOff.definition;
  const windows = def === 'rolling' ? Array.from({ length: 7 }, (_, i) => D.add(date, -i)) : [D.weekStart(date)];
  let worst = 7;
  for (const ws of windows) {
    let off = 0; for (const d of D.range(ws, 7)) { if (d === date) continue; if (isOffDay(codeAt(cells, id, d))) off++; }
    worst = Math.min(worst, off);
  }
  return worst;
}
export function canWork(cells, c, date, { weeklyMin = S.dept.weeklyOff.min } = {}) {
  if (leaveOn(c.id, date)) return { ok: false, why: 'on approved leave' };
  if (streakIfWork(cells, c.id, date) > S.dept.maxConsecutiveWork) return { ok: false, why: `would exceed ${S.dept.maxConsecutiveWork} consecutive work days` };
  if (weeklyOffIfWork(cells, c.id, date) < weeklyMin) return { ok: false, why: `would leave fewer than ${weeklyMin} ${S.dept.offCode} day(s) in the week` };
  return { ok: true };
}
export function bidOn(crewId, date, type) { return S.bids.find(b => b.crewId === crewId && b.date === date && b.type === type && ['open', 'honored'].includes(b.status)); }
export function tripAssignedOn(crewId, date) {
  return S.trips.find(t => liveTrip(t) && ((t.assign !== 'unassigned' && (t.crew.pic === crewId || t.crew.sic === crewId)) || t.crew.obs === crewId) && tripDates(t).includes(date));
}

// ------------------------------------------------------------------ roster generation
export function generateRoster({ from = TODAY, days = S.dept.horizonDays } = {}) {
  const dates = D.range(from, days).filter(d => !isLocked(d));
  const cells = clone(S.roster.cells);
  for (const d of dates) delete cells[d];
  const crew = activeCrew(); const f = S.dept.fairness; const hol = new Set(S.dept.holidays);
  const st = Object.fromEntries(crew.map(c => [c.id, { work: 0, wk: 0, hol: 0 }]));
  const avg = k => sum(crew.map(c => st[c.id][k])) / Math.max(1, crew.length);
  // Pass 0: reserve one qualified crew per seat for the whole span of each unassigned multi-day trip,
  // so lock-time matching can keep the same crew on every day of the trip.
  const resv = new Map(); const dset = new Set(dates); const held = id => resv.get(id) || new Set();
  const pending = S.trips.filter(t => ['Tentative', 'Firm'].includes(t.status) && t.assign === 'unassigned' && tripDates(t).some(d => dset.has(d))).sort((a, b) => tripStart(a).localeCompare(tripStart(b)));
  for (const t of pending) {
    const td = tripDates(t).filter(d => dset.has(d)); const type = tripType(t); if (!type) continue;
    const seats = (acById(t.tail)?.minCrew ?? 2) >= 2 ? ['PIC', 'SIC'] : ['PIC']; const used = [];
    for (const seat of seats) {
      const pick = crew.filter(c => !used.includes(c.id) && qualifies(c, type, seat, td[0]) && td.every(d => !leaveOn(c.id, d) && !observerOn(c.id, d) && !held(c.id).has(d)) && !(c.contract && S.dept.contractLast))
        .sort((a, b) => held(a.id).size - held(b.id).size || (seat === 'SIC' ? (a.quals.some(q => q.type === type && q.seat === 'PIC') ? 1 : 0) - (b.quals.some(q => q.type === type && q.seat === 'PIC') ? 1 : 0) : 0) || a.seniority - b.seniority)[0];
      if (pick) { used.push(pick.id); const h = held(pick.id); td.forEach(d => h.add(d)); resv.set(pick.id, h); }
    }
  }
  const onTrip = (id, d) => tripAssignedOn(id, d) || held(id).has(d);
  dates.forEach((date, idx) => {
    const row = {}; cells[date] = row;
    for (const c of crew) { const l = leaveOn(c.id, date); if (l) row[c.id] = l.code; else if (observerOn(c.id, date)) row[c.id] = OBS; }
    const weekend = D.isWeekend(date), holiday = hol.has(date);
    const cost = c => {
      const s = st[c.id]; const expected = (c.targetDays / 30) * (idx + 1);
      let v = f.target * (s.work - expected);
      if (weekend) v += f.weekend * (s.wk - avg('wk')) + (c.prefs.weekendsOff ? f.preference : 0);
      if (holiday) v += f.holiday * (s.hol - avg('hol') + 1);
      v += f.streak * (streakIfWork(cells, c.id, date) - 1);
      if (bidOn(c.id, date, 'off')) v += f.preference * 2;
      if (bidOn(c.id, date, 'work')) v -= f.preference;
      if (bufferDay(c.id, date)) v += f.preference;
      if (c.contract && S.dept.contractLast) v += 50;
      if (onTrip(c.id, date)) v -= 1000;
      return v + c.seniority * 0.001;
    };
    for (const g of S.dept.groups) {
      const members = crew.filter(c => c.group === g.name && !row[c.id]);
      const cands = members.filter(c => onTrip(c.id, date) || canWork(cells, c, date).ok).sort((a, b) => cost(a) - cost(b));
      if (g.kind === 'seat') {
        const { duty, standby } = requiredSlots(date);
        const m = match(duty, cands, date);
        for (const cid of m.assign.values()) row[cid] = 'W';
        for (const c of cands) if (onTrip(c.id, date)) row[c.id] = 'W';
        if (standby.length) { const rest = cands.filter(c => !row[c.id]); const m2 = match(standby, rest, date); for (const cid of m2.assign.values()) row[cid] = 'SB'; }
      } else {
        cands.slice(0, Number(g.minOnDuty) || 0).forEach(c => row[c.id] = 'W');
      }
    }
    for (const c of crew) if (!row[c.id]) row[c.id] = offCode();
    for (const c of crew) if (isWork(row[c.id])) { st[c.id].work++; if (weekend) st[c.id].wk++; if (holiday) st[c.id].hol++; }
  });
  // Pass 2: bring each person toward their work-day target, placing extra days where coverage margin is thinnest.
  const margin = {}; for (const d of dates) { const row = cells[d]; margin[d] = Object.values(row).filter(isWork).length - (requiredSlots(d).duty.length); }
  const deficit = c => Math.round((c.targetDays / 30) * dates.length) - dates.filter(d => isWork(cells[d][c.id])).length;
  for (const c of [...crew].sort((a, b) => deficit(b) - deficit(a) || a.seniority - b.seniority)) {
    if (c.contract && S.dept.contractLast) continue;
    let need = deficit(c);
    while (need > 0) {
      const strict = need < 3; const weeklyMin = strict ? (S.dept.weeklyOff.target || S.dept.weeklyOff.min) : S.dept.weeklyOff.min;
      const options = dates.filter(d => cells[d][c.id] === offCode() && !bidOn(c.id, d, 'off') && canWork(cells, c, d, { weeklyMin }).ok)
        .map(d => ({ d, score: margin[d] + (D.isWeekend(d) ? f.weekend * (c.prefs.weekendsOff ? 3 : 1) : 0) + (hol.has(d) ? f.holiday * 2 : 0) + (bufferDay(c.id, d) ? f.preference : 0) - (bidOn(c.id, d, 'work') ? 10 : 0) }))
        .sort((a, b) => a.score - b.score);
      if (!options.length) break;
      cells[options[0].d][c.id] = 'W'; margin[options[0].d]++; need--;
    }
  }
  S.roster.cells = cells; S.roster.generatedAt = new Date().toISOString();
  for (const d of dates) S.roster.status[d] = 'proposed';
  if (S.roster.period === 'published' || S.roster.period === 'locked') S.roster.period = 'draft';
  else if (!S.roster.period) S.roster.period = 'draft';
  return dates.length;
}

export function rosterCode(crewId, date) {
  const row = S.roster.cells[date]; if (row && row[crewId] != null) return row[crewId];
  const l = leaveOn(crewId, date); return l ? l.code : '';
}
export function setCell(date, crewId, code) { if (!S.roster.cells[date]) S.roster.cells[date] = {}; S.roster.cells[date][crewId] = code; }

// ------------------------------------------------------------------ fairness & stats
export function crewStats(c, dates = horizon()) {
  const hol = new Set(S.dept.holidays); let work = 0, sb = 0, obs = 0, off = 0, leave = 0, wk = 0, hd = 0, streak = 0, maxStreak = 0, tripDays = 0;
  for (const d of dates) {
    const code = rosterCode(c.id, d);
    const ob = !isWork(code) && observerOn(c.id, d); // observation outside a generated roster still counts
    if (isWork(code) || ob) { if (code === 'SB') sb++; else work++; if (code === OBS || ob) obs++; if (D.isWeekend(d)) wk++; if (hol.has(d)) hd++; streak++; maxStreak = Math.max(maxStreak, streak); }
    else { streak = 0; if (code === offCode()) off++; else if (code) leave++; }
    if (tripAssignedOn(c.id, d)) tripDays++;
  }
  const target = Math.round((c.targetDays / 30) * dates.length);
  const bids = S.bids.filter(b => b.crewId === c.id);
  return { work, sb, obs, off, leave, wk, hd, maxStreak, tripDays, target, delta: work + sb - target, bidsHonored: bids.filter(b => b.status === 'honored').length, bidsTotal: bids.length };
}
export function fairnessSummary(group = 'Pilots') {
  const crew = activeCrew().filter(c => c.group === group); const rows = crew.map(c => ({ c, ...crewStats(c) }));
  return { rows, wkSd: round1(stdev(rows.map(r => r.wk))), hdSd: round1(stdev(rows.map(r => r.hd))), streakSd: round1(stdev(rows.map(r => r.maxStreak))), deltaSd: round1(stdev(rows.map(r => r.delta))) };
}
export function rosterGaps(dates = horizon()) {
  if (!S.roster.generatedAt) return [];
  return dates.filter(d => S.roster.cells[d]).map(d => coverage(d)).filter(c => !c.ok);
}

// ------------------------------------------------------------------ balances & request checks
function periodKey(cat, date) { return cat.balance.period === 'month' ? date.slice(0, 7) : date.slice(0, 4); }
export function allotment(c, cat) { return c.allot?.[cat.code] ?? cat.balance.amount; }
export function usage(crewId, code, key, reqs = S.requests, exclude = null) {
  const cat = catByCode(code); const out = { approved: 0, pending: 0 };
  for (const r of reqs) {
    if (r.crewId !== crewId || r.code !== code || r.id === exclude) continue;
    if (!['approved', 'pending'].includes(r.status)) continue;
    const n = reqDates(r).filter(d => periodKey(cat, d) === key).length; out[r.status] += n;
  }
  return out;
}
export function balanceRows(c, ref = TODAY) {
  return S.categories.filter(cat => cat.balance.period !== 'none').map(cat => {
    const key = periodKey(cat, ref); const u = usage(c.id, cat.code, key); const a = allotment(c, cat);
    return { cat, key, allot: a, ...u, remaining: a - u.approved - u.pending };
  });
}

export function checkRequest(r, reqs = S.requests) {
  const out = []; const c = crewById(r.crewId); const cat = catByCode(r.code);
  if (!c || !cat) return [{ level: 'block', text: 'Unknown crew member or category' }];
  if (r.end < r.start) return [{ level: 'block', text: 'End date is before start date' }];
  const dates = reqDates(r);
  if (!cat.confirmed) out.push({ level: 'info', text: `${cat.code} meaning is not yet confirmed by the department` });
  // balances by period
  if (cat.balance.period !== 'none') {
    const keys = [...new Set(dates.map(d => periodKey(cat, d)))];
    for (const key of keys) {
      const n = dates.filter(d => periodKey(cat, d) === key).length; const u = usage(c.id, cat.code, key, reqs, r.id); const a = allotment(c, cat);
      if (u.approved + n > a) out.push({ level: 'block', text: `${cat.code} balance for ${key}: ${a} allotted, ${u.approved} approved, ${n} requested` });
      else if (u.approved + u.pending + n > a) out.push({ level: 'warn', text: `${cat.code} for ${key} exceeds balance when other pending requests are counted (${u.pending} pending)` });
      else out.push({ level: 'ok', text: `${cat.code} balance ${key}: ${a - u.approved - u.pending - n} remaining after this request` });
    }
  }
  // exclusions
  for (const ex of S.dept.exclusions || []) {
    if (![ex.a, ex.b].includes(r.code)) continue; const other = r.code === ex.a ? ex.b : ex.a;
    const months = new Set(dates.map(d => d.slice(0, 7)));
    const clash = reqs.filter(x => x.id !== r.id && x.crewId === c.id && x.code === other && ['approved', 'pending'].includes(x.status) && reqDates(x).some(d => months.has(d.slice(0, 7))));
    for (const x of clash) out.push({ level: x.status === 'approved' ? 'block' : 'warn', text: `${r.code} and ${other} cannot be used in the same month (${x.status} ${other} ${D.label(x.start)})` });
  }
  // absence cap
  const cap = S.dept.absenceCap;
  if (cap?.enabled && c.group === cap.group && cap.codes.includes(r.code)) {
    const over = dates.filter(d => { const ids = new Set(reqs.filter(x => x.id !== r.id && x.status === 'approved' && cap.codes.includes(x.code) && x.start <= d && x.end >= d).map(x => x.crewId)); ids.add(c.id); return ids.size > cap.max; });
    if (over.length) out.push({ level: 'block', text: `${cap.group} absence cap of ${cap.max} (${cap.codes.join('/')}) exceeded on ${over.map(d => D.label(d)).join(', ')}` });
    else out.push({ level: 'ok', text: `Within ${cap.group} absence cap of ${cap.max}` });
  }
  // blackouts
  for (const b of S.dept.blackouts || []) { if (dates.some(d => d >= b.start && d <= b.end)) out.push({ level: 'block', text: `Blackout period: ${b.label} (${D.label(b.start)}–${D.label(b.end)})` }); }
  // lock window
  if (dates.some(isLocked)) out.push({ level: 'warn', text: 'Dates fall inside the locked window; approval is a logged override' });
  // coverage
  const hEnd = D.add(TODAY, S.dept.horizonDays - 1);
  const inH = dates.filter(d => d >= TODAY && d <= hEnd); const beyond = dates.filter(d => d > hEnd);
  if (cat.unavailable && inH.length) {
    const short = inH.map(d => coverage(d, { reqs, remove: [c.id], leaveOnly: true })).filter(x => !x.ok);
    if (short.length) out.push({ level: 'block', text: `Coverage shortfall without this person on ${short.map(x => `${D.label(x.date)} (${shortText(x)})`).join('; ')}` });
    else out.push({ level: 'ok', text: `Coverage model still met on ${inH.length} day(s) in the horizon` });
  }
  if (beyond.length) out.push({ level: 'info', text: `${beyond.length} day(s) beyond the ${S.dept.horizonDays}-day horizon — coverage provisionally assessed; re-evaluated when dates enter the horizon` });
  if (dates.some(d => d < TODAY)) out.push({ level: 'info', text: 'Includes past dates (retroactive entry)' });
  // trip conflicts
  const tc = [...new Set(dates.map(d => tripAssignedOn(c.id, d)).filter(Boolean))];
  for (const t of tc) out.push({ level: 'warn', text: `Assigned to trip ${t.number}; approval opens a crew-unavailability disruption` });
  // observer assignments
  const obsDays = dates.filter(d => observerOn(c.id, d));
  if (obsDays.length && cat.unavailable) out.push({ level: 'block', text: `Scheduled as line-check observer on ${obsDays.map(d => D.label(d)).join(', ')} — the scheduler must remove or reassign the observer first` });
  const oc = dates.filter(d => d >= TODAY).map(d => [d, observationsOn(d).length]).filter(x => x[1]);
  if (oc.length && cat.unavailable) out.push({ level: 'info', text: `Coverage check already excludes ${oc.reduce((a, x) => a + x[1], 0)} observer-day(s) on these dates` });
  // overlap
  if (reqs.some(x => x.id !== r.id && x.crewId === c.id && ['approved', 'pending'].includes(x.status) && x.start <= r.end && x.end >= r.start)) out.push({ level: 'warn', text: 'Overlaps another request from this person' });
  return out;
}
export const worst = checks => checks.some(x => x.level === 'block') ? 'block' : checks.some(x => x.level === 'warn') ? 'warn' : 'ok';

export function applyLeaveToRoster(r) {
  for (const d of reqDates(r)) if (S.roster.cells[d]) setCell(d, r.crewId, r.code);
}
export function removeLeaveFromRoster(r) {
  for (const d of reqDates(r)) if (S.roster.cells[d] && S.roster.cells[d][r.crewId] === r.code) setCell(d, r.crewId, offCode());
}

// ------------------------------------------------------------------ ordering methods
export const METHODS = {
  seniority: 'Seniority',
  lottery: 'Seeded lottery',
  rotating: 'Rotating priority',
  points: 'Fairness points (least-recently honored first)',
};
export function orderCrew(method, ids) {
  const cs = ids.map(crewById).filter(Boolean);
  const contractTail = list => S.dept.contractLast ? [...list.filter(c => !c.contract), ...list.filter(c => c.contract)] : list;
  let out;
  if (method === 'lottery') out = shuffle([...cs].sort(by('seniority')), S.dept.lotterySeed);
  else if (method === 'rotating') { const s = [...cs].sort(by('seniority')); const k = s.length ? S.dept.rotationIndex % s.length : 0; out = [...s.slice(k), ...s.slice(0, k)]; }
  else if (method === 'points') out = [...cs].sort((a, b) => ((a.bidStats?.honored || 0) - (b.bidStats?.honored || 0)) || ((b.bidStats?.denied || 0) - (a.bidStats?.denied || 0)) || (S.dept.seniorityTieBreaker ? a.seniority - b.seniority : 0));
  else out = [...cs].sort(by('seniority'));
  return contractTail(out).map(c => c.id);
}

// ------------------------------------------------------------------ leave award (priority tiers then method)
export function awardLeave(method = S.dept.bidMethod) {
  const reqs = clone(S.requests); const pend = reqs.filter(r => r.status === 'pending');
  const order = orderCrew(method, [...new Set(pend.map(r => r.crewId))]);
  pend.sort((a, b) => (catByCode(a.code)?.priority ?? 9) - (catByCode(b.code)?.priority ?? 9) || order.indexOf(a.crewId) - order.indexOf(b.crewId) || a.created.localeCompare(b.created));
  const results = [];
  for (const r of pend) {
    const checks = checkRequest(r, reqs); const w = worst(checks);
    const decision = w === 'block' ? 'deny' : w === 'warn' ? 'review' : 'approve';
    if (decision === 'approve') r.status = 'approved';
    results.push({ id: r.id, decision, tier: catByCode(r.code)?.priority, checks });
  }
  return { method, order, results };
}

// ------------------------------------------------------------------ bid award (rounds; crew order by method)
export function awardBids(method = S.dept.bidMethod) {
  const cells = clone(S.roster.cells); const results = [];
  const open = S.bids.filter(b => b.status === 'open' && b.date >= TODAY && !isLocked(b.date) && (b.type !== 'swap' || b.partnerAccepted));
  const byCrew = {}; for (const b of open) (byCrew[b.crewId] ||= []).push(b);
  for (const k in byCrew) byCrew[k].sort((a, b) => (a.rank || 9) - (b.rank || 9) || a.created.localeCompare(b.created));
  const order = orderCrew(method, Object.keys(byCrew));
  const rounds = Math.max(0, ...Object.values(byCrew).map(l => l.length));
  for (let r = 0; r < rounds; r++) for (const cid of order) {
    const b = byCrew[cid][r]; if (!b) continue;
    results.push({ bid: b.id, round: r + 1, crewId: cid, ...evaluateBid(b, cells) });
  }
  return { method, order, results, cells };
}
function evaluateBid(b, cells) {
  const c = crewById(b.crewId); const changes = [];
  if (!cells[b.date]) return { outcome: 'denied', reason: 'No roster generated for this date yet', changes };
  const cur = cells[b.date][c.id];
  if (b.type === 'off') {
    if (observerOn(c.id, b.date)) return { outcome: 'denied', reason: 'Scheduled as line-check observer on this date (observer changes go through the scheduler)', changes };
    if (!isWork(cur)) return { outcome: 'honored', reason: cur === offCode() ? `Already a ${cur} day` : `Already off (${cur})`, changes };
    if (tripAssignedOn(c.id, b.date)) return { outcome: 'denied', reason: 'Assigned to a trip on this date', changes };
    cells[b.date][c.id] = offCode();
    let cov = coverage(b.date, { cells });
    if (cov.ok) { changes.push({ date: b.date, crewId: c.id, from: cur, to: offCode() }); return { outcome: 'honored', reason: 'Coverage still met', changes }; }
    if (S.dept.bidBackfill !== false) {
      const cands = activeCrew().filter(x => x.id !== c.id && x.group === c.group && cells[b.date][x.id] === offCode() && !bidOn(x.id, b.date, 'off') && canWork(cells, x, b.date).ok)
        .sort((x, y) => crewDelta(x, cells) - crewDelta(y, cells));
      for (const x of cands) {
        cells[b.date][x.id] = 'W'; cov = coverage(b.date, { cells });
        if (cov.ok) { changes.push({ date: b.date, crewId: c.id, from: cur, to: offCode() }, { date: b.date, crewId: x.id, from: offCode(), to: 'W' }); return { outcome: 'honored', reason: `Backfilled by ${x.name}`, changes }; }
        cells[b.date][x.id] = offCode();
      }
    }
    cells[b.date][c.id] = cur;
    return { outcome: 'denied', reason: `Would leave coverage short: ${shortText(cov) || 'no qualified backfill'}`, changes };
  }
  if (b.type === 'work') {
    if (isWork(cur)) return { outcome: 'honored', reason: cur === OBS ? 'Already working as line-check observer' : 'Already scheduled to work', changes };
    if (cur !== offCode()) return { outcome: 'denied', reason: `On leave (${cur})`, changes };
    const ok = canWork(cells, c, b.date); if (!ok.ok) return { outcome: 'denied', reason: `Hard rule: ${ok.why}`, changes };
    cells[b.date][c.id] = 'W'; changes.push({ date: b.date, crewId: c.id, from: cur, to: 'W' }); return { outcome: 'honored', reason: 'Added as work day', changes };
  }
  if (b.type === 'swap') {
    const p = crewById(b.withCrewId); if (!p) return { outcome: 'denied', reason: 'Swap partner not found', changes };
    const give = b.date, take = b.takeDate;
    if (!cells[take]) return { outcome: 'denied', reason: 'Take date not in roster', changes };
    const a1 = cells[give][c.id], p1 = cells[give][p.id], a2 = cells[take][c.id], p2 = cells[take][p.id];
    const ob = [[c, give], [p, give], [c, take], [p, take]].find(([x, d]) => observerOn(x.id, d));
    if (ob) return { outcome: 'denied', reason: `${ob[0].name} is a line-check observer on ${D.label(ob[1])}; observer days cannot be swapped`, changes };
    if (!isWork(a1) || p1 !== offCode()) return { outcome: 'denied', reason: `${c.name} must work and ${p.name} must be off on ${D.label(give)}`, changes };
    if (!isWork(p2) || a2 !== offCode()) return { outcome: 'denied', reason: `${p.name} must work and ${c.name} must be off on ${D.label(take)}`, changes };
    cells[give][c.id] = offCode(); cells[give][p.id] = a1; cells[take][p.id] = offCode(); cells[take][c.id] = p2;
    const chk = [canWork(cells, p, give), canWork(cells, c, take)]; const cov1 = coverage(give, { cells }), cov2 = coverage(take, { cells });
    if (chk.every(x => x.ok) && cov1.ok && cov2.ok && !tripAssignedOn(c.id, give) && !tripAssignedOn(p.id, take)) {
      changes.push({ date: give, crewId: c.id, from: a1, to: offCode() }, { date: give, crewId: p.id, from: p1, to: a1 }, { date: take, crewId: p.id, from: p2, to: offCode() }, { date: take, crewId: c.id, from: a2, to: p2 });
      return { outcome: 'honored', reason: 'Swap preserves coverage and rules', changes };
    }
    cells[give][c.id] = a1; cells[give][p.id] = p1; cells[take][c.id] = a2; cells[take][p.id] = p2;
    const why = [...chk.filter(x => !x.ok).map(x => x.why), !cov1.ok && `coverage short ${D.label(give)}: ${shortText(cov1)}`, !cov2.ok && `coverage short ${D.label(take)}: ${shortText(cov2)}`].filter(Boolean);
    return { outcome: 'denied', reason: why.join('; ') || 'Trip assignment conflict', changes };
  }
  return { outcome: 'denied', reason: 'Unknown bid type', changes };
}
function crewDelta(c, cells) { const ds = horizon().filter(d => cells[d]); return ds.filter(d => isWork(cells[d][c.id])).length - (c.targetDays / 30) * ds.length; }

export function applyBidAward(res) {
  S.roster.cells = res.cells;
  for (const r of res.results) {
    const b = S.bids.find(x => x.id === r.bid); if (!b) continue;
    b.status = r.outcome; b.reason = r.reason; b.decidedAt = new Date().toISOString(); b.method = res.method;
    const c = crewById(b.crewId); c.bidStats ||= { honored: 0, denied: 0 }; c.bidStats[r.outcome === 'honored' ? 'honored' : 'denied']++;
    notify(b.crewId, `Bid ${r.outcome}: ${b.type === 'swap' ? 'swap' : 'prefer ' + b.type} ${D.label(b.date)} — ${r.reason}`, '#/bids');
    for (const ch of r.changes) if (ch.crewId !== b.crewId) notify(ch.crewId, `Schedule change ${D.label(ch.date)}: ${ch.from} → ${ch.to} (${b.type} bid award)`, '#/schedule');
  }
  if (res.method === 'rotating') S.dept.rotationIndex++;
  audit('Bid award accepted', `${METHODS[res.method]}: ${res.results.filter(r => r.outcome === 'honored').length} honored, ${res.results.filter(r => r.outcome === 'denied').length} denied`);
}
export function compareMethods() {
  return Object.keys(METHODS).map(m => { const res = awardBids(m); const per = {}; for (const r of res.results) { per[r.crewId] ||= { h: 0, d: 0 }; per[r.crewId][r.outcome === 'honored' ? 'h' : 'd']++; } return { method: m, res, per, honored: res.results.filter(r => r.outcome === 'honored').length, total: res.results.length }; });
}

// ------------------------------------------------------------------ duty / rest compliance
export function ruleSetFor(t) {
  if (t.ruleSetId) { const rs = S.ruleSets.find(r => r.id === t.ruleSetId); if (rs) return rs; }
  const ac = acById(t.tail);
  if (ac?.ruleSetId) { const rs = S.ruleSets.find(r => r.id === ac.ruleSetId); if (rs) return rs; }
  let part = S.dept.mode === 'mixed' ? (t.part && t.part !== 'aircraft' ? t.part : (ac?.part || '91')) : S.dept.mode;
  return S.ruleSets.find(r => r.id === S.dept.defaultRuleSet[part]) || S.ruleSets[0];
}
function legHours(l) { if (l.obs && S.dept.observer?.flightTimeCounts === false) return 0; return Number(l.flightAct) || Math.max(0, T.hours(l.dep, l.arr)); }
function crewLegs(crewId, trips) {
  const out = [];
  for (const t of trips) {
    if (!liveTrip(t)) continue;
    const flying = t.assign !== 'unassigned' && (t.crew.pic === crewId || t.crew.sic === crewId);
    const obs = t.crew.obs === crewId; // observer duty is evaluated against the same rule set as the trip
    if (flying || obs) for (const l of t.legs) out.push({ ...l, dep: l.depAct || l.dep, arr: l.arrAct || l.arr, trip: t, rs: ruleSetFor(t), minCrew: acById(t.tail)?.minCrew || 2, obs: obs && !flying });
  }
  return out.sort((a, b) => a.dep.localeCompare(b.dep));
}
export function dutyPeriods(crewId, trips = S.trips) {
  const legs = crewLegs(crewId, trips); const duties = [];
  for (const l of legs) {
    const last = duties[duties.length - 1];
    if (last && T.hours(last.legs[last.legs.length - 1].arr, l.dep) < Number(last.rs.params.minRest || 10)) last.legs.push(l);
    else duties.push({ legs: [l], rs: l.rs });
  }
  for (const d of duties) {
    const p = d.rs.params; d.start = T.addH(d.legs[0].dep, -(Number(p.reportBufferMin) || 0) / 60); d.end = T.addH(d.legs[d.legs.length - 1].arr, (Number(p.releaseBufferMin) || 0) / 60);
    d.dutyHrs = T.hours(d.start, d.end); d.flightHrs = sum(d.legs.map(legHours)); d.trips = [...new Set(d.legs.map(l => l.trip.number))]; d.minCrew = Math.min(...d.legs.map(l => l.minCrew));
  }
  return duties;
}
export function compliance(crewId, trips = S.trips) {
  const c = crewById(crewId); const duties = dutyPeriods(crewId, trips); const out = [];
  const v = (sev, rule, rs, key, detail, d) => out.push({ crewId, severity: sev, rule, basis: citeFor(rs, key), detail, trips: d?.trips || [], date: d ? T.date(d.start) : null, ruleSet: rs.name });
  duties.forEach((d, i) => {
    const p = d.rs.params;
    if (p.maxDuty != null && d.dutyHrs > Number(p.maxDuty)) v('violation', 'Duty period', d.rs, 'maxDuty', `${round1(d.dutyHrs)} h duty exceeds ${p.maxDuty} h`, d);
    const fl = d.minCrew >= 2 ? p.flightPerDuty2p : p.flightPerDuty1p; const fk = d.minCrew >= 2 ? 'flightPerDuty2p' : 'flightPerDuty1p';
    if (fl != null && d.flightHrs > Number(fl)) v('violation', 'Flight time per duty', d.rs, fk, `${round1(d.flightHrs)} h flight exceeds ${fl} h`, d);
    if (i > 0) { const rest = T.hours(duties[i - 1].end, d.start); const need = requiredRest(d.rs, d.flightHrs); if (rest < need) v('violation', 'Rest before duty', d.rs, 'minRest', `${round1(rest)} h rest before duty; ${need} h required`, d); }
    const win = (h) => sum(duties.filter(x => x.start <= d.start && T.hours(x.start, d.start) < h).map(x => x.flightHrs));
    if (p.sevenDayFlight != null && win(168) > Number(p.sevenDayFlight)) v('violation', '7-day flight time', d.rs, 'sevenDayFlight', `${round1(win(168))} h in 7 days exceeds ${p.sevenDayFlight} h`, d);
    const m = T.date(d.start).slice(0, 7); const mh = sum(duties.filter(x => x.start.startsWith(m)).map(x => x.flightHrs));
    if (p.monthFlight != null && mh > Number(p.monthFlight)) v('violation', 'Monthly flight time', d.rs, 'monthFlight', `${round1(mh)} h in ${m} exceeds ${p.monthFlight} h`, d);
    const q = D.quarter(T.date(d.start)); const qh = (c.priorQuarterHrs || 0) + sum(duties.filter(x => D.quarter(T.date(x.start)) === q).map(x => x.flightHrs));
    if (p.quarterFlight != null && qh > Number(p.quarterFlight)) v('violation', 'Quarterly flight time', d.rs, 'quarterFlight', `${round1(qh)} h in ${q} (incl. ${c.priorQuarterHrs} h prior) exceeds ${p.quarterFlight} h`, d);
    if (p.sevenDay24Rest && Number(p.sevenDay24Rest) > 0) {
      const ws = T.addH(d.end, -168); const inWin = duties.filter(x => x.end > ws && x.start <= d.end);
      let maxGap = T.hours(ws, inWin[0].start); for (let k = 1; k < inWin.length; k++) maxGap = Math.max(maxGap, T.hours(inWin[k - 1].end, inWin[k].start));
      if (maxGap < 24) v('violation', '24 h free in 7 days', d.rs, 'sevenDay24Rest', 'No 24 consecutive hours free of duty in the preceding 7 days', d);
    }
  });
  // quarterly 24-hour rest periods (projection using roster; days outside the roster are assumed free)
  const rsQ = duties[0]?.rs || S.ruleSets.find(r => r.params.restPeriodsPerQuarter);
  if (rsQ?.params.restPeriodsPerQuarter && c.group === 'Pilots') {
    const qs = D.quarterStart(TODAY), qe = D.quarterEnd(TODAY); const busy = new Set(); for (const d of duties) D.between(T.date(d.start), T.date(d.end)).forEach(x => busy.add(x));
    const free = D.between(qs, qe).filter(d => !busy.has(d) && !isWork(rosterCode(c.id, d))).length;
    if (free < Number(rsQ.params.restPeriodsPerQuarter)) v('warning', 'Quarterly 24 h rest periods', rsQ, 'restPeriodsPerQuarter', `Projected ${free} free days in ${D.quarter(TODAY)}; ${rsQ.params.restPeriodsPerQuarter} required`, null);
  }
  // consecutive duty (policy) from roster
  let run = 0, maxRun = 0, at = null; for (const d of horizon()) { if (isWork(rosterCode(c.id, d)) || tripAssignedOn(c.id, d)) { run++; if (run > maxRun) { maxRun = run; at = d; } } else run = 0; }
  const rsC = duties[0]?.rs || S.ruleSets[0];
  if (rsC && maxRun > Number(rsC.params.maxConsecutiveDuty || 99)) out.push({ crewId, severity: 'warning', rule: 'Consecutive duty days', basis: 'Department policy', detail: `${maxRun} consecutive duty/available days ending ${D.label(at)} (max ${rsC.params.maxConsecutiveDuty})`, trips: [], date: at, ruleSet: rsC.name });
  return out;
}
export function allCompliance() {
  const out = [];
  for (const c of activeCrew().filter(c => c.group === 'Pilots' || canObserve(c))) out.push(...compliance(c.id));
  for (const c of activeCrew()) for (const cur of c.currency || []) {
    const days = D.diff(TODAY, cur.expires);
    if (days < 0) out.push({ crewId: c.id, severity: 'violation', rule: 'Currency expired', basis: 'Currency tracking', detail: `${cur.label} expired ${D.label(cur.expires)}${cur.type ? ` — not eligible for ${cur.type}` : ' — not eligible for duty'}`, trips: [], date: cur.expires });
    else if (days <= 30) out.push({ crewId: c.id, severity: 'warning', rule: 'Currency expiring', basis: 'Currency tracking', detail: `${cur.label} expires in ${days} day(s)`, trips: [], date: cur.expires });
  }
  return out;
}
export { crewName };
