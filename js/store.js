// Browser-local state, session, audit trail and notifications.
import { D, uid, clone } from './util.js';
import { SCENARIOS } from './presets.js';

const KEY = 'flightdeck-bid-v3';
export let S = null;              // persisted department state
export const session = { role: null, userId: null, layout: 'calendar' }; // chosen at every load, never persisted
export const TODAY = D.today();
const listeners = new Set();

export const ROLES = {
  admin: { label: 'Administrator / Scheduler', short: 'Scheduler' },
  crew: { label: 'Crew member', short: 'Crew' },
  accounting: { label: 'Accounting / Finance', short: 'Accounting' },
  management: { label: 'Management', short: 'Management' },
};

const PERMS = {
  admin: ['configure', 'schedule.edit', 'timeoff.approve', 'bids.approve', 'trips.edit', 'trips.view', 'acct.view', 'reports', 'audit', 'override'],
  management: ['configure', 'schedule.edit', 'timeoff.approve', 'bids.approve', 'trips.edit', 'trips.view', 'acct.view', 'reports', 'audit', 'override', 'exceptions.approve'],
  accounting: ['trips.view', 'acct.view', 'acct.edit', 'reports'],
  crew: ['self'],
};
export const can = p => !!session.role && PERMS[session.role].includes(p);
export const tripsOn = () => !!S?.dept.modules.trips;

export function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) { const s = JSON.parse(raw); if (s && s.schema === 3) { S = migrate(s); return true; } } } catch { /* ignore */ }
  return false;
}
// Bring older saved data up to date (line-check observer fields added in spec revision 2).
export function migrate(s) {
  s.observations ||= [];
  s.dept.observer ||= { flightTimeCounts: true };
  for (const c of s.crew) { c.checkAirman ??= false; c.peerObserver ??= false; }
  for (const t of s.trips) { t.crew.obs ??= null; t.observer ||= { wanted: !!t.crew.obs, kind: 'any' }; }
  return s;
}
export function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { console.warn('Save failed', e); } listeners.forEach(f => f()); }
export function onChange(f) { listeners.add(f); }
export function setState(s) { S = migrate(s); }
export function loadScenario(name, afterBuild) {
  S = migrate(SCENARIOS[name].build(TODAY));
  if (afterBuild) afterBuild(S);
  audit('Loaded scenario', SCENARIOS[name].label, 'System');
  save();
}
export function resetAll() { localStorage.removeItem(KEY); S = null; }

export function actorName() {
  if (!session.role) return 'System';
  if (session.role === 'crew') return crewName(session.userId);
  return `${ROLES[session.role].short} (demo)`;
}
export function audit(action, detail = '', actor, justification = '') {
  S.audit.unshift({ id: uid('au'), at: new Date().toISOString(), actor: actor || actorName(), role: session.role || 'system', action, detail, justification });
  if (S.audit.length > 3000) S.audit.length = 3000;
}
// to: crew id, or 'role:admin' | 'role:accounting' | 'role:management' | 'role:crew' (all crew)
export function notify(to, text, link = '') {
  const list = Array.isArray(to) ? to : [to];
  for (const t of list) if (t) S.notifications.unshift({ id: uid('nt'), to: t, text, link, at: new Date().toISOString(), read: false });
  if (S.notifications.length > 1500) S.notifications.length = 1500;
}
export function myNotifications() {
  if (!session.role) return [];
  return S.notifications.filter(n => n.to === `role:${session.role}` || (session.role === 'management' && n.to === 'role:admin') || (session.role === 'crew' && (n.to === session.userId || n.to === 'role:crew')));
}
export function exception(kind, detail, justification, ref = null) {
  const ex = { id: uid('ex'), kind, detail, justification, ref, by: actorName(), at: new Date().toISOString(), status: 'pending', decidedBy: null, decidedAt: null };
  S.exceptions.unshift(ex);
  notify('role:management', `Exception awaiting approval: ${detail}`, '#/exceptions');
  audit('Exception raised', `${kind}: ${detail}`, null, justification);
  return ex;
}

export const crewById = id => S.crew.find(c => c.id === id);
export const crewName = id => crewById(id)?.name || '—';
export const acById = id => S.aircraft.find(a => a.id === id);
export const catByCode = code => S.categories.find(c => c.code === code);
export const paxById = id => S.passengers.find(p => p.id === id);
export const tripById = id => S.trips.find(t => t.id === id);
export const pilots = () => S.crew.filter(c => c.group === 'Pilots' && c.status === 'active');
export const activeCrew = () => S.crew.filter(c => c.status === 'active');
export const types = () => [...new Set(S.aircraft.map(a => a.type))];
export const horizon = () => D.range(TODAY, S.dept.horizonDays);
export const lockEnd = () => D.add(TODAY, S.dept.lockDays - 1);
export const isLocked = date => ['locked', 'published'].includes(S.roster.status[date]);
export const snapshot = () => clone(S);
