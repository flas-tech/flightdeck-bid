// Trip scheduling module: validation, pre-lock suggestions, lock-time crew matching, disruptions and close-out.
import { D, T, clone, uid, sum, round1 } from './util.js';
import { S, TODAY, acById, crewById, crewName, pilots, activeCrew, audit, notify, paxById, tripById, lockEnd, isLocked, actorName } from './store.js';
import { tripDates, tripStart, tripEnd, tripType, aircraftDown, qualifies, rosterCode, isWork, leaveOn, compliance, liveTrip, coverage, shortText, crewStats, setCell, canObserve, observerOn, observationsOn, tripCrewIds, seatOf, OBS_KINDS, OBS } from './engine.js';

export const STATUSES = ['Draft', 'Tentative', 'Firm', 'Cancelled', 'Completed'];
export const REASONS = ['Client request', 'Weather', 'Maintenance', 'Crew unavailable', 'ATC / airport', 'Passenger change', 'Operational', 'Billing correction', 'Other'];
export const SEAT_KEY = { PIC: 'pic', SIC: 'sic', OBS: 'obs' };
export const SEAT_NAME = { pic: 'PIC', sic: 'SIC', obs: 'Observer' };
const overlaps = (a, b) => { const as = tripStart(a), ae = tripEnd(a), bs = tripStart(b), be = tripEnd(b); return as && bs && as < be && bs < ae; };

export function newTrip() {
  return {
    id: uid('tr'), number: `T-${S.tripSeq++}`, status: 'Draft', part: 'aircraft', ruleSetId: null, legs: [], paxIds: [], hitchhikers: [], paxCount: 0,
    flexible: false, flexHours: 0, hitchAllowed: false, aircraftPref: '', tail: '', special: '', priority: 'Normal', notes: '',
    billing: { client: '', costCenter: '', code: '', invoiceStatus: 'Not invoiced', invoiceNo: '', costs: { fuel: 0, landing: 0, catering: 0, crew: 0, other: 0 }, notes: '' },
    crew: { pic: null, sic: null, obs: null }, observer: { wanted: false, kind: 'any' }, assign: 'unassigned', history: [], changes: [], billingFlag: false, frozen: false, created: new Date().toISOString(),
  };
}
export function tailConflicts(t, trips = S.trips) { return t.tail ? trips.filter(x => x.id !== t.id && x.tail === t.tail && ['Tentative', 'Firm'].includes(x.status) && overlaps(t, x)) : []; }
export function tailDown(t, tail = t.tail) { const a = acById(tail); if (!a) return null; for (const d of tripDates(t)) { const r = aircraftDown(a, d); if (r) return `${a.tail} unavailable ${D.label(d)}: ${r}`; } return null; }

export function validateTrip(t) {
  const out = []; const firmish = t.status !== 'Draft';
  if (!t.legs.length) out.push({ level: firmish ? 'block' : 'warn', text: 'At least one leg is required' });
  t.legs.forEach((l, i) => {
    const n = `Leg ${i + 1}`;
    if (!/^[A-Z0-9]{3,4}$/.test(l.from || '') || !/^[A-Z0-9]{3,4}$/.test(l.to || '')) out.push({ level: firmish ? 'block' : 'warn', text: `${n}: enter 3–4 character airport identifiers` });
    if (!l.dep || !l.arr) out.push({ level: firmish ? 'block' : 'warn', text: `${n}: departure and arrival times required` });
    else if (l.arr <= l.dep) out.push({ level: 'block', text: `${n}: arrival must be after departure` });
    if (l.from && l.to && l.from === l.to) out.push({ level: 'warn', text: `${n}: origin and destination are the same` });
    if (i > 0) { const p = t.legs[i - 1]; if (p.to !== l.from) out.push({ level: 'warn', text: `${n} departs ${l.from || '?'} but previous leg arrives ${p.to || '?'}` }); if (p.arr && l.dep && l.dep < p.arr) out.push({ level: 'block', text: `${n} departs before leg ${i} arrives` }); }
  });
  const ac = acById(t.tail);
  if (firmish && t.status === 'Firm' && !ac) out.push({ level: 'warn', text: 'Firm trip has no aircraft assigned yet' });
  if (ac) {
    if (t.aircraftPref && ac.type !== t.aircraftPref) out.push({ level: 'warn', text: `Assigned ${ac.tail} (${ac.type}) differs from preferred type ${t.aircraftPref}` });
    const maxPax = Math.max(Number(t.paxCount) || 0, ...t.legs.map(l => Number(l.pax) || 0));
    if (maxPax > ac.seats) out.push({ level: 'block', text: `${maxPax} passengers exceeds ${ac.tail} seating (${ac.seats})` });
    const dn = tailDown(t); if (dn) out.push({ level: 'warn', text: dn });
    for (const x of tailConflicts(t)) out.push({ level: t.status === 'Firm' && x.status === 'Firm' ? 'block' : 'warn', text: `${ac.tail} also on ${x.number} (${x.status}) at overlapping times` });
  }
  const ob = t.crew?.obs ? crewById(t.crew.obs) : null;
  if (ob) {
    const kind = t.observer?.kind || 'any';
    if (!canObserve(ob, kind)) out.push({ level: 'block', text: `${ob.name} is not flagged as ${kind === 'standards' ? 'a Standards Captain / Check Airman' : 'a Standards Captain or Peer Observer'}` });
    if (ob.id === t.crew.pic || ob.id === t.crew.sic) out.push({ level: 'block', text: `${ob.name} cannot observe a trip they are crewing` });
    const dl = tripDates(t).find(d => leaveOn(ob.id, d)); if (dl) out.push({ level: 'block', text: `Observer ${ob.name} is on approved leave ${D.label(dl)}` });
    const other = S.trips.find(x => x.id !== t.id && liveTrip(x) && tripCrewIds(x).includes(ob.id) && overlaps(t, x)); if (other) out.push({ level: 'block', text: `Observer ${ob.name} is also on ${other.number} at overlapping times` });
    const dayObs = tripDates(t).map(d => (S.observations || []).find(o => o.status !== 'cancelled' && o.crewId === ob.id && o.start <= d && o.end >= d)).find(Boolean); if (dayObs) out.push({ level: 'warn', text: `Observer ${ob.name} also has a calendar-day observation ${D.label(dayObs.start)}` });
    const short = tripDates(t).filter(d => d >= TODAY).map(d => coverage(d, { leaveOnly: !S.roster.cells[d] })).filter(c => !c.ok);
    out.push(short.length ? { level: 'warn', text: `With ${ob.name} observing, coverage is short on ${short.map(c => `${D.label(c.date)} (${shortText(c)})`).join('; ')}` } : { level: 'ok', text: `Observer ${ob.name} qualified; coverage still met with the observer removed from the pool` });
  } else if (t.observer?.wanted) out.push({ level: 'info', text: `Line-check observer requested (${OBS_KINDS[t.observer.kind || 'any']}) — proposed at lock or pick one now` });
  if (t.paxIds.length > (Number(t.paxCount) || 0)) out.push({ level: 'warn', text: `${t.paxIds.length} passengers selected but passenger count is ${t.paxCount}` });
  if (t.hitchhikers.length && !t.hitchAllowed) out.push({ level: 'warn', text: 'Hitchhikers listed but trip is specified-passengers-only' });
  if (t.flexible && !(Number(t.flexHours) > 0)) out.push({ level: 'info', text: 'Flexible trip has no flex window; suggestions will try ±24 h' });
  if (!t.billing.code && t.status !== 'Draft') out.push({ level: 'info', text: 'No billing code yet (Accounting can add later)' });
  if (!out.some(x => x.level !== 'info')) out.push({ level: 'ok', text: 'Entry validation passed' });
  return out;
}

export function tripFlight(t, actual = false) { return round1(sum(t.legs.map(l => actual && l.flightAct != null ? Number(l.flightAct) : Math.max(0, T.hours(l.dep, l.arr))))); }
export function tripBlock(t, actual = false) { return round1(sum(t.legs.map(l => actual && l.blockAct != null ? Number(l.blockAct) : Math.max(0, T.hours(l.dep, l.arr)) + 0.3))); }
export function setStatus(t, status, note = '') {
  if (t.status === status) return; t.status = status; t.history.push({ status, at: new Date().toISOString(), by: actorName(), note });
}

// ------------------------------------------------------------------ candidate crew for a seat
export function candidates(t, seat, { trips = S.trips, exclude = [] } = {}) {
  const type = tripType(t); const dates = tripDates(t); const out = []; const isObs = seat === 'OBS'; const kind = t.observer?.kind || 'any';
  const pool = isObs ? activeCrew().filter(c => c.checkAirman || c.peerObserver) : pilots();
  const others = tripCrewIds(t).filter(id => id !== t.crew[SEAT_KEY[seat]]);
  for (const c of pool) {
    const why = [];
    if (exclude.includes(c.id)) continue;
    if (isObs) { if (!canObserve(c, kind)) why.push(kind === 'standards' ? 'not a Standards Captain / Check Airman' : 'not an observer'); if (others.includes(c.id)) why.push('crewing this trip'); }
    else if (!dates.every(d => qualifies(c, type, seat, d))) { why.push(`not ${type} ${seat} qualified/current`); }
    if (!isObs && t.crew.obs === c.id) why.push('assigned as observer on this trip');
    const codes = dates.map(d => rosterCode(c.id, d));
    const offOk = x => isObs && x === S.dept.offCode; // an observer can be scheduled on an off day (it becomes a work day)
    if (dates.some(d => leaveOn(c.id, d))) why.push('on leave');
    else if (codes.some(x => x && !isWork(x) && !offOk(x))) why.push(`roster shows ${codes.filter(x => x && !isWork(x)).join('/')} on trip dates`);
    const busy = trips.find(x => x.id !== t.id && liveTrip(x) && ((x.assign !== 'unassigned' && (x.crew.pic === c.id || x.crew.sic === c.id)) || x.crew.obs === c.id) && overlaps(t, x));
    if (busy) why.push(`already on ${busy.number}${busy.crew.obs === c.id ? ' as observer' : ''}`);
    const dayObs = dates.find(d => (S.observations || []).some(o => o.status !== 'cancelled' && o.crewId === c.id && o.start <= d && o.end >= d));
    if (dayObs) why.push(`line-check observer ${D.label(dayObs)}`);
    let viol = [];
    if (!why.length) {
      const tmp = trips.map(x => x.id === t.id ? { ...x, crew: { ...x.crew, [SEAT_KEY[seat]]: c.id }, assign: x.assign === 'unassigned' ? 'proposed' : x.assign } : x);
      const before = new Set(compliance(c.id, trips).filter(v => v.severity === 'violation').map(v => v.rule + v.detail));
      viol = compliance(c.id, tmp).filter(v => v.severity === 'violation' && !before.has(v.rule + v.detail));
      if (viol.length) why.push(`duty/rest: ${viol.map(v => v.detail).join('; ')}`);
    }
    const tripDays = new Set(trips.filter(x => x.id !== t.id && liveTrip(x) && tripCrewIds(x).includes(c.id)).flatMap(tripDates).filter(d => d >= TODAY)).size;
    const offDays = isObs ? codes.filter(x => x === S.dept.offCode).length : 0;
    // observers: prefer someone already rostered to work (no off day consumed) and, for 'any', peer observers before check airmen
    out.push({ c, ok: !why.length, why, standby: codes.includes('SB'), tripDays, offDays, score: tripDays * 10 + offDays * 4 + (isObs && kind !== 'standards' && c.checkAirman && !c.peerObserver ? 1 : 0) + (codes.includes('SB') ? 2 : 0) + (c.contract && S.dept.contractLast ? 100 : 0) + (S.dept.seniorityTieBreaker ? c.seniority * 0.01 : 0) });
  }
  return out.sort((a, b) => (b.ok - a.ok) || a.score - b.score);
}

// ------------------------------------------------------------------ lock-time matching
export function matchTrips({ through = lockEnd() } = {}) {
  const trips = clone(S.trips); const results = [];
  const todo = trips.filter(t => ['Tentative', 'Firm'].includes(t.status) && t.assign !== 'published' && t.assign !== 'confirmed' && tripDates(t).some(d => d >= TODAY && d <= through)).sort((a, b) => tripStart(a).localeCompare(tripStart(b)));
  for (const t of todo) {
    const ac = acById(t.tail); const seats = ac ? (ac.minCrew >= 2 ? ['PIC', 'SIC'] : ['PIC']) : ['PIC', 'SIC'];
    if (t.observer?.wanted || t.crew.obs) seats.push('OBS');
    const r = { tripId: t.id, number: t.number, picks: {}, notes: [] };
    if (!ac) r.notes.push('No aircraft assigned — matched against preferred type');
    for (const seat of seats) {
      const key = SEAT_KEY[seat];
      if (seat === 'OBS' && t.crew.obs) { r.picks.obs = t.crew.obs; r.notes.push(`Observer: ${crewName(t.crew.obs)} — pre-assigned by scheduler; resource held`); continue; }
      const cands = candidates(t, seat, { trips, exclude: Object.entries(t.crew).filter(([k, v]) => v && k !== key).map(([, v]) => v) });
      const best = cands.find(x => x.ok);
      if (best) { t.crew[key] = best.c.id; r.picks[key] = best.c.id; r.notes.push(seat === 'OBS' ? `Observer: ${best.c.name} (${best.c.checkAirman ? 'Standards Captain' : 'Peer Observer'}) — available${best.offDays ? `, uses ${best.offDays} off day(s)` : ''}; removed from coverage pool` : `${seat}: ${best.c.name} — qualified, available, fewest trip days (${best.tripDays})${best.standby ? ', from standby' : ''}`); }
      else { t.crew[key] = null; r.picks[key] = null; r.notes.push(`${SEAT_NAME[key]}: unfilled — ${cands.slice(0, 2).map(x => `${x.c.name}: ${x.why[0]}`).join('; ') || (seat === 'OBS' ? 'no qualified observers' : 'no pilots')}`); }
    }
    t.assign = 'proposed';
    results.push(r);
  }
  return { results, trips };
}
export function applyMatch(m) {
  for (const r of m.results) {
    const t = tripById(r.tripId); if (!t) continue;
    t.crew.pic = r.picks.pic ?? t.crew.pic; t.crew.sic = r.picks.sic ?? t.crew.sic; if ('obs' in r.picks) t.crew.obs = r.picks.obs ?? t.crew.obs; t.assign = 'proposed';
  }
  audit('Lock matching proposed', `${m.results.length} trip(s) matched; awaiting scheduler confirmation`);
}
export function confirmAssignment(t) {
  t.assign = 'confirmed';
  for (const id of [t.crew.pic, t.crew.sic].filter(Boolean)) for (const d of tripDates(t)) { if (S.roster.cells[d] && rosterCode(id, d) !== 'W') setCell(d, id, 'W'); }
  if (t.crew.obs) syncObsCells(t.crew.obs, tripDates(t), true);
  audit('Trip crew confirmed', `${t.number}: PIC ${crewName(t.crew.pic)}, SIC ${crewName(t.crew.sic)}${t.crew.obs ? `, Observer ${crewName(t.crew.obs)}` : ''}`);
}
export function publishTrip(t) {
  t.assign = 'published';
  for (const id of [t.crew.pic, t.crew.sic].filter(Boolean)) notify(id, `Assigned to ${t.number} ${routeText(t)} on ${D.label(T.date(tripStart(t)))}`, `#/trips/${t.id}`);
  if (t.crew.obs) notify(t.crew.obs, `Line-check observer on ${t.number} ${routeText(t)} on ${D.label(T.date(tripStart(t)))} — counts as a flight work day`, `#/trips/${t.id}`);
}
// Keep roster cells in step with observer assignments (OBS on add, back to the off code on removal).
export function syncObsCells(crewId, dates, on) {
  for (const d of dates) { if (!S.roster.cells[d]) continue; const cur = rosterCode(crewId, d);
    if (on && !leaveOn(crewId, d)) setCell(d, crewId, OBS);
    else if (!on && cur === OBS && !observerOn(crewId, d)) setCell(d, crewId, S.dept.offCode); }
}
export function setTripObserver(t, crewId, reason = 'Operational', viaDisruption = false) {
  const old = t.crew.obs; if (old === crewId) return;
  t.crew.obs = crewId || null; if (crewId) t.observer = { ...(t.observer || { kind: 'any' }), wanted: true };
  if (old) syncObsCells(old, tripDates(t), false);
  if (crewId && (t.assign !== 'unassigned' || S.roster.cells[tripDates(t)[0]])) syncObsCells(crewId, tripDates(t), true);
  logChange(t, crewId ? (old ? 'Observer changed' : 'Observer added') : 'Observer removed', reason, `Line-check observer ${crewName(old)} → ${crewName(crewId)}`, true);
  if (old) notify(old, `Removed as observer on ${t.number}`, `#/trips/${t.id}`);
  if (crewId) notify(crewId, `Assigned as line-check observer on ${t.number} ${routeText(t)} (${D.label(T.date(tripStart(t)))}) — counts as a work day`, `#/trips/${t.id}`);
  if (!viaDisruption) audit(crewId ? 'Observer assigned' : 'Observer removed', `${t.number}: ${crewName(old)} → ${crewName(crewId)}`);
}
export const routeText = t => t.legs.length ? [t.legs[0].from, ...t.legs.map(l => l.to)].join('–') : 'no legs';

// ------------------------------------------------------------------ pre-lock suggestions
export function buildSuggestions() {
  const prev = Object.fromEntries((S.suggestions || []).map(s => [s.key, s.status]));
  const out = []; const add = s => {
    if (prev[s.key] === 'dismissed' || prev[s.key] === 'applied') return;
    const ds = [...new Set(s.tripIds.flatMap(id => tripDates(tripById(id) || { legs: [] })))].filter(d => d >= TODAY);
    const n = ds.reduce((a, d) => a + observationsOn(d).length, 0);
    s.obsImpact = ds.length ? (n ? `${n} observer-day(s) on these dates are already removed from the available pool` : 'No observers scheduled on these dates') : '';
    out.push({ status: 'open', ...s });
  };
  const live = S.trips.filter(t => ['Tentative', 'Firm', 'Draft'].includes(t.status) && tripEnd(t) && T.date(tripEnd(t)) >= TODAY && t.assign !== 'published');
  const freeTail = (t, type) => S.aircraft.filter(a => a.type === type && a.id !== t.tail && !tripDates(t).some(d => aircraftDown(a, d)) && !tailConflicts({ ...t, tail: a.id }).length);
  for (const t of live) {
    // aircraft reassignment
    const conflict = tailConflicts(t).length || tailDown(t);
    if (t.tail && conflict && t.status !== 'Draft') {
      const alt = freeTail(t, tripType(t))[0];
      add({ key: `tail:${t.id}:${t.tail}`, kind: 'Aircraft reassignment', tripIds: [t.id], text: `${t.number}: ${tailDown(t) || `${acById(t.tail).tail} double-booked`}`, detail: alt ? `Reassign to ${alt.tail} (${alt.type}), which is free for the whole trip.` : 'No free aircraft of the same type — consider retiming.', action: alt ? { type: 'setTail', tripId: t.id, tail: alt.id } : null });
    }
    if (!t.tail && t.aircraftPref && t.status !== 'Draft') {
      const alt = freeTail({ ...t, tail: '' }, t.aircraftPref)[0];
      if (alt) add({ key: `assigntail:${t.id}`, kind: 'Aircraft assignment', tripIds: [t.id], text: `${t.number} has no tail assigned`, detail: `${alt.tail} (${alt.type}) is free for the whole trip.`, action: { type: 'setTail', tripId: t.id, tail: alt.id } });
    }
    // retime flexible trips when the day is short of qualified crew
    if (t.flexible && t.status !== 'Draft') {
      const short = tripDates(t).map(d => coverage(d, { leaveOnly: !S.roster.cells[d] })).find(c => !c.ok);
      const noCrew = !candidates(t, 'PIC').some(x => x.ok);
      if (short || noCrew) {
        const span = Math.max(1, Math.round((Number(t.flexHours) || 24) / 24));
        for (const k of [1, -1, 2, -2].filter(x => Math.abs(x) <= span)) {
          const moved = shiftTrip(clone(t), k * 24); if (T.date(tripStart(moved)) < TODAY) continue;
          if (tripDates(moved).every(d => coverage(d, { leaveOnly: !S.roster.cells[d] }).ok) && !tailConflicts(moved).length && candidates(moved, 'PIC').some(x => x.ok)) {
            add({ key: `shift:${t.id}:${k}`, kind: 'Re-time flexible trip', tripIds: [t.id], text: `${t.number} ${short ? `falls on a short-crew day (${shortText(short)})` : 'has no available qualified PIC'}`, detail: `Move ${k > 0 ? 'later' : 'earlier'} by ${Math.abs(k)} day(s) to ${D.label(T.date(tripStart(moved)))}, within its flex window, where coverage and a qualified crew are available.`, action: { type: 'shift', tripId: t.id, hours: k * 24 } });
            break;
          }
        }
      }
    }
    // observer placement: requested but not yet assigned
    if (t.observer?.wanted && !t.crew.obs && t.status !== 'Draft') {
      const best = candidates(t, 'OBS').find(x => x.ok);
      if (best) { const after = tripDates(t).filter(d => d >= TODAY).map(d => coverage(d, { remove: [best.c.id], leaveOnly: !S.roster.cells[d] })).filter(c => !c.ok);
        add({ key: `obs:${t.id}:${best.c.id}`, kind: 'Observer placement', tripIds: [t.id], text: `${t.number} requests a line-check observer`, detail: `Assign ${best.c.name} (${best.c.checkAirman ? 'Standards Captain' : 'Peer Observer'})${best.offDays ? `, using ${best.offDays} off day(s)` : ''}. ${after.length ? `Coverage would be short on ${after.map(c => `${D.label(c.date)} (${shortText(c)})`).join('; ')}.` : 'Coverage still met with the observer removed from the pool.'}`, action: { type: 'setObs', tripId: t.id, crewId: best.c.id } }); }
      else add({ key: `obsnone:${t.id}`, kind: 'Observer placement', tripIds: [t.id], text: `${t.number} requests an observer but none is available`, detail: 'No flagged Standards Captain or Peer Observer is free and compliant for the whole trip.', action: null });
    }
    // hitchhiker opportunities on empty legs
    if (t.hitchAllowed) for (const l of t.legs.filter(l => !(Number(l.pax) > 0))) {
      const cand = live.find(x => x.id !== t.id && ['Draft', 'Tentative'].includes(x.status) && x.legs.length === 1 && x.legs[0].from === l.from && x.legs[0].to === l.to && Math.abs(T.hours(x.legs[0].dep, l.dep)) <= Math.max(24, Number(x.flexHours) || 0));
      if (cand) add({ key: `hitch:${t.id}:${l.id}:${cand.id}`, kind: 'Hitchhiker opportunity', tripIds: [t.id, cand.id], text: `${t.number} ${l.from}–${l.to} is an empty leg; ${cand.number} requests the same city pair`, detail: `Add ${cand.paxIds.length || cand.paxCount} passenger(s) from ${cand.number} as hitchhikers and cancel ${cand.number} (reason: combined).`, action: { type: 'hitch', tripId: t.id, legId: l.id, fromTrip: cand.id } });
      else add({ key: `empty:${t.id}:${l.id}`, kind: 'Hitchhiker opportunity', tripIds: [t.id], text: `${t.number} ${l.from}–${l.to} on ${D.label(T.date(l.dep))} is an empty leg open to hitchhikers`, detail: 'No matching request found. Add hitchhikers from the trip record if someone needs this city pair.', action: null });
    }
  }
  // combine compatible trips
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j]; if (a.status === 'Draft' || b.status === 'Draft' || !a.legs.length || !b.legs.length) continue;
    const sameRoute = a.legs[0].from === b.legs[0].from && a.legs[a.legs.length - 1].to === b.legs[b.legs.length - 1].to;
    const gap = Math.abs(T.hours(tripStart(a), tripStart(b))); const flexOk = (a.flexible || b.flexible) && gap <= Math.max(Number(a.flexHours) || 0, Number(b.flexHours) || 0, 12);
    const acA = acById(a.tail) || S.aircraft.find(x => x.type === (a.aircraftPref || b.aircraftPref)); const seats = acA?.seats || 0;
    if (sameRoute && flexOk && (Number(a.paxCount) + Number(b.paxCount)) <= seats && (a.hitchAllowed || b.hitchAllowed)) {
      const keep = a.status === 'Firm' || (a.tail && !b.tail) ? a : b; const merge = keep === a ? b : a;
      add({ key: `combine:${a.id}:${b.id}`, kind: 'Combine compatible trips', tripIds: [a.id, b.id], text: `${a.number} and ${b.number} share ${routeText(a)} ${gap ? `${round1(gap)} h apart` : 'at the same time'}`, detail: `Combine into ${keep.number} (${Number(a.paxCount) + Number(b.paxCount)} pax ≤ ${seats} seats). ${merge.number} would be cancelled with reason “Combined” and its passengers moved.`, action: { type: 'combine', keep: keep.id, merge: merge.id } });
    }
  }
  // coverage warnings in horizon for trip days
  const days = [...new Set(live.filter(t => t.status !== 'Draft').flatMap(tripDates))].filter(d => d >= TODAY && d <= D.add(TODAY, S.dept.horizonDays - 1)).sort();
  for (const d of days) { const c = coverage(d, { leaveOnly: !S.roster.cells[d] }); if (!c.ok) add({ key: `cov:${d}:${shortText(c)}`, kind: 'Coverage warning', tripIds: [], text: `${D.long(d)}: short ${shortText(c)} with trips scheduled`, detail: 'Review time off, standby or consider retiming flexible trips.', action: null }); }
  // crew reassignment where an assigned pilot now has a violation
  for (const t of live.filter(t => t.assign !== 'unassigned' || t.crew.obs)) for (const seat of ['pic', 'sic', 'obs']) {
    const id = t.crew[seat]; if (!id) continue;
    const v = compliance(id).find(x => x.severity === 'violation' && x.trips.includes(t.number));
    if (v) { const alt = candidates({ ...t, crew: { ...t.crew, [seat]: null } }, seat.toUpperCase(), { trips: S.trips.map(x => x.id === t.id ? { ...x, crew: { ...x.crew, [seat]: null } } : x) }).find(x => x.ok);
      add({ key: `crew:${t.id}:${seat}:${id}`, kind: 'Crew reassignment', tripIds: [t.id], text: `${t.number}: ${crewName(id)} — ${v.detail}`, detail: alt ? `Reassign ${SEAT_NAME[seat]} to ${alt.c.name}.` : 'No compliant alternate found.', action: alt ? { type: 'reassign', tripId: t.id, seat, crewId: alt.c.id } : null }); }
  }
  S.suggestions = [...out, ...(S.suggestions || []).filter(s => s.status !== 'open').slice(0, 100)];
  return out;
}
export function shiftTrip(t, hours) { for (const l of t.legs) { l.dep = T.addH(l.dep, hours); l.arr = T.addH(l.arr, hours); } return t; }
export function applySuggestion(sg) {
  const a = sg.action; if (!a) return;
  if (a.type === 'setTail') { const t = tripById(a.tripId); t.tail = a.tail; logChange(t, 'Aircraft change', 'Operational', `Tail set to ${acById(a.tail).tail} (pre-lock suggestion)`, false); }
  if (a.type === 'shift') { const t = tripById(a.tripId); shiftTrip(t, a.hours); logChange(t, 'Re-timed', 'Operational', `Moved ${a.hours > 0 ? '+' : ''}${a.hours / 24} day(s) within flex window`, true); }
  if (a.type === 'setObs') { setTripObserver(tripById(a.tripId), a.crewId, 'Operational'); }
  if (a.type === 'reassign' && a.seat === 'obs') { setTripObserver(tripById(a.tripId), a.crewId, 'Operational'); }
  else if (a.type === 'reassign') { const t = tripById(a.tripId); const old = t.crew[a.seat]; t.crew[a.seat] = a.crewId; logChange(t, 'Crew change', 'Operational', `${a.seat.toUpperCase()} ${crewName(old)} → ${crewName(a.crewId)}`, false); notify([old, a.crewId], `${t.number} crew change: ${a.seat.toUpperCase()} now ${crewName(a.crewId)}`, `#/trips/${t.id}`); }
  if (a.type === 'combine') {
    const k = tripById(a.keep), m = tripById(a.merge);
    k.paxIds = [...new Set([...k.paxIds, ...m.paxIds])]; k.paxCount = Number(k.paxCount) + Number(m.paxCount); k.legs.forEach(l => l.pax = (Number(l.pax) || 0) + (Number(m.legs[0]?.pax) || 0));
    k.notes = `${k.notes ? k.notes + ' ' : ''}Combined with ${m.number}.`.trim();
    setStatus(m, 'Cancelled', `Combined into ${k.number}`); logChange(m, 'Cancelled', 'Operational', `Combined into ${k.number}`, true); logChange(k, 'Passengers added', 'Operational', `Combined ${m.number} (${m.paxCount} pax)`, true);
  }
  if (a.type === 'hitch') {
    const t = tripById(a.tripId), f = tripById(a.fromTrip); const l = t.legs.find(x => x.id === a.legId);
    t.hitchhikers = [...new Set([...t.hitchhikers, ...f.paxIds])]; l.pax = (Number(l.pax) || 0) + (Number(f.paxCount) || f.paxIds.length);
    setStatus(f, 'Cancelled', `Passengers moved to ${t.number} empty leg`); logChange(f, 'Cancelled', 'Passenger change', `Passengers hitchhiking on ${t.number}`, true); logChange(t, 'Hitchhikers added', 'Passenger change', `${f.paxIds.map(id => paxById(id)?.name).join(', ') || f.paxCount + ' pax'} on ${l.from}–${l.to}`, true);
  }
  sg.status = 'applied'; sg.appliedAt = new Date().toISOString();
  audit('Suggestion approved', `${sg.kind}: ${sg.text}`);
}
export function logChange(t, type, reason, detail, billingImpact) {
  t.changes.push({ id: uid('ch'), at: new Date().toISOString(), by: actorName(), type, reason, detail, billingImpact, postLock: t.assign === 'published' || tripDates(t).some(isLocked) });
  if (billingImpact && (t.assign === 'published' || t.status === 'Completed' || tripDates(t).some(isLocked))) { t.billingFlag = true; notify('role:accounting', `Billing impact on ${t.number}: ${type} — ${detail}`, `#/accounting/${t.id}`); }
}

// ------------------------------------------------------------------ disruptions
export const DISRUPTIONS = {
  time: 'Time or destination change', wx: 'Weather delay', pax: 'Passenger change', mx: 'Maintenance (aircraft down)', crew: 'Crew unavailable', popup: 'Pop-up trip', observer: 'Observer added / removed', cancel: 'Trip cancellation', correction: 'Post-completion record correction',
};
export function evaluateDisruption(d) {
  const trips = clone(S.trips); const imp = { items: [], violations: [], recoveries: [], billing: false, affectedCrew: new Set(), affectedTrips: new Set() };
  const t = trips.find(x => x.id === d.tripId);
  const crewViol = (tt, list) => { for (const id of tripCrewIds(tt)) { imp.affectedCrew.add(id); for (const v of compliance(id, list).filter(v => v.severity === 'violation' && v.trips.includes(tt.number))) imp.violations.push({ ...v, name: crewName(id) }); } };
  const seatRecoveries = (tt, list, seat, outId) => { const cs = candidates(tt, seat, { trips: list, exclude: [outId] }).filter(x => x.ok).slice(0, 3); cs.forEach(x => imp.recoveries.push({ id: uid('rc'), text: `${tt.number}: assign ${x.c.name} as ${SEAT_NAME[SEAT_KEY[seat]]} (${x.tripDays} trip days in horizon)`, action: { type: 'reassign', tripId: tt.id, seat: seat.toLowerCase(), crewId: x.c.id } })); if (!cs.length) imp.items.push(`${tt.number}: no compliant ${SEAT_NAME[SEAT_KEY[seat]]} replacement found — ${seat === 'OBS' ? 'the observation can be dropped or moved' : 'consider retiming or cancelling'}`); };
  if (d.type === 'time' || d.type === 'wx') {
    const idx = t.legs.findIndex(l => l.id === d.legId);
    if (d.type === 'wx') { const h = Number(d.delayHrs) || 0; for (let i = Math.max(0, idx); i < t.legs.length; i++) { t.legs[i].dep = T.addH(t.legs[i].dep, h); t.legs[i].arr = T.addH(t.legs[i].arr, h); } imp.items.push(`${t.number}: legs ${idx + 1}–${t.legs.length} delayed ${h} h`); }
    else { const l = t.legs[idx]; if (d.newDep) l.dep = d.newDep; if (d.newArr) l.arr = d.newArr; if (d.newTo) { l.to = d.newTo.toUpperCase(); if (t.legs[idx + 1]) t.legs[idx + 1].from = l.to; } imp.items.push(`${t.number} leg ${idx + 1}: now ${l.from}–${l.to} ${T.short(l.dep)} → ${T.short(l.arr)}`); }
    imp.billing = true; imp.affectedTrips.add(t.id); crewViol(t, trips);
    for (const x of tailConflicts(t, trips)) imp.items.push(`Aircraft conflict with ${x.number}`);
    for (const v of imp.violations) seatRecoveries(t, trips, SEAT_NAME[seatOf(t, v.crewId)] === 'Observer' ? 'OBS' : seatOf(t, v.crewId).toUpperCase(), v.crewId);
  }
  if (d.type === 'pax') { t.paxCount = Number(d.paxCount); const ac = acById(t.tail); imp.items.push(`${t.number}: passenger count ${S.trips.find(x => x.id === t.id).paxCount} → ${t.paxCount}`); if (ac && t.paxCount > ac.seats) { imp.items.push(`Exceeds ${ac.tail} seating (${ac.seats})`); S.aircraft.filter(a => a.seats >= t.paxCount && a.id !== ac.id && !tailConflicts({ ...t, tail: a.id }, trips).length && !tailDown(t, a.id)).forEach(a => imp.recoveries.push({ id: uid('rc'), text: `Swap to ${a.tail} (${a.type}, ${a.seats} seats)`, action: { type: 'setTail', tripId: t.id, tail: a.id } })); } imp.billing = true; imp.affectedTrips.add(t.id); }
  if (d.type === 'cancel') { imp.items.push(`${t.number} will be cancelled; crew released`); imp.billing = true; imp.affectedTrips.add(t.id); tripCrewIds(t).forEach(id => imp.affectedCrew.add(id)); }
  if (d.type === 'mx') {
    const a = acById(d.aircraftId); const hit = trips.filter(x => x.tail === d.aircraftId && ['Tentative', 'Firm'].includes(x.status) && tripDates(x).some(dd => dd >= d.start && dd <= d.end));
    imp.items.push(`${a.tail} down ${D.label(d.start)}–${D.label(d.end)}; ${hit.length} trip(s) affected`);
    for (const x of hit) { imp.affectedTrips.add(x.id); const alts = S.aircraft.filter(b => b.id !== a.id && b.type === a.type && !tripDates(x).some(dd => aircraftDown(b, dd)) && !tailConflicts({ ...x, tail: b.id }, trips).length); if (alts.length) alts.forEach(b => imp.recoveries.push({ id: uid('rc'), text: `${x.number}: move to ${b.tail}`, action: { type: 'setTail', tripId: x.id, tail: b.id } })); else imp.items.push(`${x.number}: no same-type aircraft free — retime or cancel`); tripCrewIds(x).forEach(id => imp.affectedCrew.add(id)); }
  }
  if (d.type === 'crew') {
    const hit = trips.filter(x => liveTrip(x) && x.status !== 'Completed' && tripCrewIds(x).includes(d.crewId) && tripDates(x).some(dd => dd >= d.start && dd <= d.end));
    const dayObs = (S.observations || []).filter(o => o.status !== 'cancelled' && o.crewId === d.crewId && o.start <= d.end && o.end >= d.start);
    for (const o of dayObs) imp.items.push(`Calendar-day observation ${D.label(o.start)}${o.end !== o.start ? '–' + D.label(o.end) : ''} will be cancelled`);
    imp.items.push(`${crewName(d.crewId)} unavailable ${D.label(d.start)}–${D.label(d.end)}; ${hit.length} trip(s) affected`); imp.affectedCrew.add(d.crewId);
    for (const x of hit) { imp.affectedTrips.add(x.id); const key = seatOf(x, d.crewId); x.crew[key] = null; seatRecoveries(x, trips, key === 'obs' ? 'OBS' : key.toUpperCase(), d.crewId); }
    const days = D.between(d.start, d.end).filter(dd => S.roster.cells[dd]);
    const short = days.map(dd => coverage(dd, { remove: [d.crewId] })).filter(c => !c.ok); if (short.length) imp.items.push(`Roster coverage short on ${short.map(c => D.label(c.date)).join(', ')} once removed`);
  }
  if (d.type === 'observer') {
    imp.affectedTrips.add(t.id); imp.billing = true; tripCrewIds(t).forEach(id => imp.affectedCrew.add(id));
    const dates = tripDates(t).filter(dd => dd >= TODAY);
    if (d.obsAction === 'remove') {
      if (!t.crew.obs) imp.items.push(`${t.number} has no observer to remove`);
      else { imp.items.push(`${t.number}: remove observer ${crewName(t.crew.obs)}; they return to the available pool`); const was = t.crew.obs; t.crew.obs = null; imp.items.push(`Coverage ${dates.every(dd => coverage(dd, { leaveOnly: !S.roster.cells[dd] }).ok) ? 'met' : 'still short'} on trip dates after release`); imp.affectedCrew.add(was); }
    } else {
      const c = crewById(d.crewId);
      if (!c) imp.items.push('Choose an observer');
      else {
        const k = candidates({ ...t, crew: { ...t.crew, obs: null } }, 'OBS', { trips }).find(x => x.c.id === c.id);
        imp.items.push(`${t.number}: ${t.crew.obs ? `replace observer ${crewName(t.crew.obs)} with` : 'add observer'} ${c.name} (${c.checkAirman ? 'Standards Captain' : c.peerObserver ? 'Peer Observer' : 'not flagged'})`);
        if (!k || !k.ok) imp.items.push(`Not eligible: ${k ? k.why.join('; ') : 'not a flagged observer'}`);
        else { t.crew.obs = c.id; const sh = dates.map(dd => coverage(dd, { remove: [c.id], leaveOnly: !S.roster.cells[dd] })).filter(x => !x.ok); imp.items.push(sh.length ? `Coverage short with observer removed from pool: ${sh.map(x => `${D.label(x.date)} (${shortText(x)})`).join('; ')}` : 'Coverage still met with observer removed from the pool'); for (const v of compliance(c.id, trips).filter(v => v.severity === 'violation' && v.trips.includes(t.number))) imp.violations.push({ ...v, name: c.name }); }
        imp.affectedCrew.add(c.id); if (t.crew.obs && t.crew.obs !== c.id) imp.affectedCrew.add(t.crew.obs);
        imp.eligible = !!(k && k.ok);
      }
    }
  }
  if (d.type === 'popup') { imp.items.push(`New trip ${t?.number || ''} inside the locked window`); if (t) { imp.affectedTrips.add(t.id); for (const seat of ['PIC', 'SIC']) seatRecoveries(t, trips, seat, null); } }
  if (d.type === 'correction') { imp.items.push(`${t.number}: correction to completed record — ${d.detail || ''}`); imp.billing = true; imp.affectedTrips.add(t.id); }
  imp.affectedCrew = [...imp.affectedCrew]; imp.affectedTrips = [...imp.affectedTrips];
  return imp;
}
export function applyDisruption(d, recoveryIds = []) {
  const t = tripById(d.tripId); const imp = d.impact;
  if (d.type === 'wx' || d.type === 'time') {
    const idx = t.legs.findIndex(l => l.id === d.legId);
    if (d.type === 'wx') { for (let i = Math.max(0, idx); i < t.legs.length; i++) { t.legs[i].dep = T.addH(t.legs[i].dep, Number(d.delayHrs)); t.legs[i].arr = T.addH(t.legs[i].arr, Number(d.delayHrs)); } }
    else { const l = t.legs[idx]; if (d.newDep) l.dep = d.newDep; if (d.newArr) l.arr = d.newArr; if (d.newTo) { l.to = d.newTo.toUpperCase(); if (t.legs[idx + 1]) t.legs[idx + 1].from = l.to; } }
    logChange(t, DISRUPTIONS[d.type], d.reason, imp.items.join('; '), true);
  }
  if (d.type === 'pax') { const old = t.paxCount; t.paxCount = Number(d.paxCount); logChange(t, 'Passenger change', d.reason, `Passenger count ${old} → ${t.paxCount}`, true); }
  if (d.type === 'cancel') { setStatus(t, 'Cancelled', d.reason); logChange(t, 'Cancelled', d.reason, d.detail || 'Cancelled after lock', true); tripCrewIds(t).forEach(id => notify(id, `${t.number} cancelled — you are released`, `#/trips/${t.id}`)); }
  if (d.type === 'mx') { const a = acById(d.aircraftId); (a.downtime ||= []).push({ start: d.start, end: d.end, reason: d.detail || 'Unscheduled maintenance' }); for (const id of imp.affectedTrips) logChange(tripById(id), 'Aircraft down', d.reason, `${a.tail} unavailable ${D.label(d.start)}–${D.label(d.end)}`, false); notify('role:admin', `${a.tail} marked down ${D.label(d.start)}–${D.label(d.end)}`); }
  if (d.type === 'observer') {
    if (d.obsAction === 'remove') setTripObserver(t, null, d.reason, true);
    else if (imp.eligible) setTripObserver(t, d.crewId, d.reason, true);
  }
  if (d.type === 'crew') { for (const id of imp.affectedTrips) { const x = tripById(id); const seat = seatOf(x, d.crewId); if (!seat) continue; x.crew[seat] = null; logChange(x, 'Crew unavailable', d.reason, `${crewName(d.crewId)} removed from ${SEAT_NAME[seat]}`, seat === 'obs'); }
    for (const o of (S.observations || []).filter(o => o.status !== 'cancelled' && o.crewId === d.crewId && o.start <= d.end && o.end >= d.start)) { o.status = 'cancelled'; o.cancelReason = `${DISRUPTIONS.crew}: ${d.reason}`; } for (const dd of D.between(d.start, d.end)) if (S.roster.cells[dd]) setCell(dd, d.crewId, S.dept.offCode === 'U' ? 'U' : 'OFF'); }
  if (d.type === 'correction') logChange(t, 'Record correction', d.reason, d.detail || '', true);
  for (const r of imp.recoveries.filter(r => recoveryIds.includes(r.id))) {
    const a = r.action; const x = tripById(a.tripId);
    if (a.type === 'setTail') { x.tail = a.tail; logChange(x, 'Aircraft change', d.reason, `Recovery: ${r.text}`, false); }
    if (a.type === 'reassign' && a.seat === 'obs') { setTripObserver(x, a.crewId, d.reason, true); continue; }
    if (a.type === 'reassign') { const old = x.crew[a.seat]; x.crew[a.seat] = a.crewId; if (x.assign === 'unassigned') x.assign = 'proposed'; logChange(x, 'Crew change', d.reason, `Recovery: ${a.seat.toUpperCase()} ${crewName(old)} → ${crewName(a.crewId)}`, false); notify(a.crewId, `You are assigned to ${x.number} as ${a.seat.toUpperCase()} (${DISRUPTIONS[d.type]})`, `#/trips/${x.id}`); for (const dd of tripDates(x)) if (S.roster.cells[dd]) setCell(dd, a.crewId, 'W'); }
  }
  for (const id of imp.affectedCrew) notify(id, `Schedule disruption: ${DISRUPTIONS[d.type]}${t ? ` on ${t.number}` : ''} — ${imp.items[0] || ''}`, t ? `#/trips/${t.id}` : '#/schedule');
  if (imp.billing && t) { t.billingFlag = true; notify('role:accounting', `Billing-impact flag on ${t.number}: ${DISRUPTIONS[d.type]}`, `#/accounting/${t.id}`); }
  d.status = 'approved'; d.decidedAt = new Date().toISOString(); d.recoveriesApplied = recoveryIds;
  audit('Disruption approved', `${DISRUPTIONS[d.type]}${t ? ' — ' + t.number : ''}: ${imp.items.join('; ')}`, null, d.reason);
}

// ------------------------------------------------------------------ close-out & accounting
export function completeTrip(t, actuals) {
  for (const l of t.legs) { const a = actuals[l.id] || {}; l.depAct = a.depAct || l.dep; l.arrAct = a.arrAct || l.arr; l.flightAct = Number(a.flightAct ?? round1(T.hours(l.depAct, l.arrAct))); l.blockAct = Number(a.blockAct ?? round1(l.flightAct + 0.3)); l.paxAct = Number(a.paxAct ?? l.pax); }
  setStatus(t, 'Completed'); t.frozen = true; t.completedAt = new Date().toISOString();
  notify('role:accounting', `${t.number} completed — record frozen and ready for close-out`, `#/accounting/${t.id}`);
  audit('Trip completed', `${t.number}: ${tripFlight(t, true)} h flight, ${tripBlock(t, true)} h block; operational record frozen`);
}
export function tripCosts(t) { const c = t.billing.costs; return sum([c.fuel, c.landing, c.catering, c.crew, c.other]); }
export function manifest(t) { return [...t.paxIds.map(id => ({ ...paxById(id), role: 'Passenger' })), ...t.hitchhikers.map(id => ({ ...paxById(id), role: 'Hitchhiker' }))].filter(p => p.id); }
export function paxHistory(pid) { return S.trips.filter(t => t.paxIds.includes(pid) || t.hitchhikers.includes(pid)); }
export { tripDates, tripStart, tripEnd, tripType, crewById };
