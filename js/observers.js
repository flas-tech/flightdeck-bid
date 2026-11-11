// Calendar-day line-check observer assignments (used with or without the Trip module).
import { D, uid } from './util.js';
import { S, TODAY, crewById, crewName, audit, notify, isLocked, exception } from './store.js';
import { canObserve, leaveOn, coverage, shortText, observationsOn, tripAssignedOn, OBS_KINDS } from './engine.js';
import { syncObsCells } from './trips.js';

export function checkObservation(o) {
  const out = []; const c = crewById(o.crewId);
  if (!c) return [{ level: 'block', text: 'Choose an observer' }];
  if (!o.start || !o.end || o.end < o.start) return [{ level: 'block', text: 'Enter a valid date range' }];
  const dates = D.between(o.start, o.end);
  if (!canObserve(c, o.kind)) out.push({ level: 'block', text: `${c.name} is not flagged as ${o.kind === 'standards' ? 'a Standards Captain / Check Airman' : 'a Standards Captain or Peer Observer'}` });
  const lv = dates.find(d => leaveOn(c.id, d)); if (lv) out.push({ level: 'block', text: `${c.name} is on approved leave ${D.label(lv)}` });
  const busy = dates.map(d => observationsOn(d).find(x => x.crewId === c.id && x.obsId !== o.id)).find(Boolean);
  if (busy) out.push({ level: 'block', text: `${c.name} is already an observer ${busy.number ? 'on ' + busy.number : 'that day'}` });
  const trip = dates.map(d => tripAssignedOn(c.id, d)).find(Boolean); if (trip) out.push({ level: 'block', text: `${c.name} is crewing ${trip.number} on these dates` });
  for (const id of o.observedIds || []) if (id === c.id) out.push({ level: 'block', text: 'An observer cannot observe themselves' });
  const short = dates.filter(d => d >= TODAY).map(d => coverage(d, { remove: [c.id], leaveOnly: !S.roster.cells[d] })).filter(x => !x.ok);
  out.push(short.length ? { level: 'warn', text: `Coverage short with ${c.name} removed from the pool: ${short.map(x => `${D.label(x.date)} (${shortText(x)})`).join('; ')}` } : { level: 'ok', text: `Coverage still met with ${c.name} removed from the available pool` });
  if (dates.some(isLocked)) out.push({ level: 'warn', text: 'Inside the locked window — this is a post-lock change and requires a reason (logged)' });
  out.push({ level: 'info', text: `${dates.length} observation day(s) count as flight work days for ${c.name}` });
  return out;
}
export function addObservation(o, reason = '') {
  const rec = { id: uid('ob'), status: 'scheduled', created: new Date().toISOString(), observedIds: [], note: '', ...o };
  S.observations.push(rec);
  const dates = D.between(rec.start, rec.end);
  syncObsCells(rec.crewId, dates, true);
  const post = dates.some(isLocked);
  audit(post ? 'Post-lock observer added' : 'Observer scheduled', `${crewName(rec.crewId)} ${D.label(rec.start)}${rec.end !== rec.start ? '–' + D.label(rec.end) : ''} (${OBS_KINDS[rec.kind]})${rec.observedIds.length ? ' observing ' + rec.observedIds.map(crewName).join(', ') : ''}`, null, reason);
  notify(rec.crewId, `Line-check observer ${D.label(rec.start)}${rec.end !== rec.start ? '–' + D.label(rec.end) : ''} — counts as a flight work day`, '#/observers');
  for (const id of rec.observedIds) notify(id, `Line check scheduled ${D.label(rec.start)} with ${crewName(rec.crewId)}`, '#/observers');
  return rec;
}
export function cancelObservation(id, reason = '') {
  const o = S.observations.find(x => x.id === id); if (!o) return;
  o.status = 'cancelled'; o.cancelReason = reason;
  const dates = D.between(o.start, o.end);
  syncObsCells(o.crewId, dates, false);
  audit(dates.some(isLocked) ? 'Post-lock observer removed' : 'Observer assignment cancelled', `${crewName(o.crewId)} ${D.label(o.start)}`, null, reason);
  notify(o.crewId, `Observer assignment ${D.label(o.start)} cancelled${reason ? ': ' + reason : ''}`, '#/observers');
}
export { exception };
