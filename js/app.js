import { esc, D } from './util.js';
import { S, session, load, save, loadScenario, onChange, ROLES, can, tripsOn, myNotifications, crewName, TODAY, audit } from './store.js';
import { SCENARIOS } from './presets.js';
import { generateRoster } from './engine.js';
import { $, $$, toast } from './ui.js';
import * as dashboard from './views/dashboard.js';
import * as schedule from './views/schedule.js';
import * as timeoff from './views/timeoff.js';
import * as bids from './views/bids.js';
import * as trips from './views/trips.js';
import * as passengers from './views/passengers.js';
import * as accounting from './views/accounting.js';
import * as reports from './views/reports.js';
import * as admin from './views/admin.js';
import * as misc from './views/misc.js';

const ROUTES = {
  dashboard: { label: 'Dashboard', view: dashboard, ok: () => true, grp: 'Overview' },
  notifications: { label: 'Notifications', view: misc.notifications, ok: () => true, grp: 'Overview', count: () => myNotifications().filter(n => !n.read).length },
  schedule: { label: 'Schedule', view: schedule, ok: () => session.role !== 'accounting', grp: 'Crew availability' },
  timeoff: { label: 'Time off', view: timeoff, ok: () => session.role !== 'accounting', grp: 'Crew availability', count: () => can('timeoff.approve') ? S.requests.filter(r => r.status === 'pending').length : 0 },
  bids: { label: 'Bids & swaps', view: bids, ok: () => session.role !== 'accounting', grp: 'Crew availability', count: () => can('bids.approve') ? S.bids.filter(b => b.status === 'open').length : S.bids.filter(b => b.status === 'awaiting-partner' && b.withCrewId === session.userId).length },
  trips: { label: 'Trips', view: trips, ok: () => tripsOn(), grp: 'Trip scheduling' },
  passengers: { label: 'Passengers', view: passengers, ok: () => tripsOn() && session.role !== 'crew', grp: 'Trip scheduling' },
  accounting: { label: 'Accounting records', view: accounting, ok: () => tripsOn() && can('acct.view'), grp: 'Trip scheduling', count: () => session.role === 'accounting' ? S.trips.filter(t => t.billingFlag).length : 0 },
  reports: { label: 'Reports & fairness', view: reports, ok: () => true, grp: 'Insight' },
  exceptions: { label: 'Exceptions', view: misc.exceptions, ok: () => can('override'), grp: 'Insight', count: () => S.exceptions.filter(e => e.status === 'pending').length },
  audit: { label: 'Audit trail', view: misc.audit, ok: () => can('audit') || session.role === 'accounting', grp: 'Insight' },
  admin: { label: 'Setup & rules', view: admin, ok: () => can('configure'), grp: 'Administration' },
};

function parseHash() { const [, route = 'dashboard', ...rest] = (location.hash || '#/dashboard').split('/'); return { route, param: rest.join('/') }; }

function renderNav(active) {
  let html = '', grp = '';
  for (const [k, r] of Object.entries(ROUTES)) {
    if (!r.ok()) continue;
    if (r.grp !== grp) { grp = r.grp; html += `<div class="grp">${esc(grp)}</div>`; }
    const n = r.count ? r.count() : 0;
    html += `<a href="#/${k}" class="${k === active ? 'on' : ''}" ${k === active ? 'aria-current="page"' : ''}>${esc(r.label)}${n ? `<span class="n">${n}</span>` : ''}</a>`;
  }
  $('#side').innerHTML = html;
}
function renderTop() {
  $('#deptName').textContent = S.dept.name;
  const mode = { '91': 'Part 91', '135': 'Part 135', mixed: 'Mixed 91 / 135' }[S.dept.mode];
  const who = session.role === 'crew' ? crewName(session.userId) : ROLES[session.role].label;
  $('#topMeta').innerHTML = `<span class="badge info">${esc(mode)}</span><span class="badge ${tripsOn() ? 'ok' : 'muted'}">Trip module ${tripsOn() ? 'on' : 'off'}</span><span class="badge">${esc(who)}</span><span class="badge muted">Today ${esc(D.label(TODAY))}</span>`;
  const n = myNotifications().filter(x => !x.read).length; const b = $('#bellCount'); b.hidden = !n; b.textContent = n > 99 ? '99+' : n;
}
export function render() {
  if (!session.role || !S) return;
  let { route, param } = parseHash();
  if (!ROUTES[route] || !ROUTES[route].ok()) route = 'dashboard';
  renderTop(); renderNav(route);
  const main = $('#view'); const y = window.scrollY;
  if (session.role === 'crew' && !S.crew.some(c => c.id === session.userId)) { main.innerHTML = '<div class="empty"><p>This department has no crew profile for you yet. Use Switch user and sign in as Administrator / Scheduler to add crew.</p></div>'; return; }
  try { ROUTES[route].view.render(main, param); }
  catch (e) { console.error(e); main.innerHTML = `<div class="alert bad">Something went wrong rendering this page: ${esc(e.message)}</div>`; }
  if (render._last === location.hash) window.scrollTo(0, y); else { window.scrollTo(0, 0); }
  render._last = location.hash;
  $('#side').classList.remove('open'); $('#navToggle').setAttribute('aria-expanded', 'false');
}

// ---------------------------------------------------------------- interface chooser (shown at every load)
function chooser() {
  const el = $('#chooser'); el.hidden = false;
  const st = { scenario: S ? 'keep' : 'coastal', role: 'admin', userId: '', layout: 'calendar' };
  const draw = () => {
    const crewList = st.scenario === 'keep' ? S.crew : SCENARIOS[st.scenario].build(TODAY).crew;
    if (st.role === 'crew' && !crewList.some(c => c.id === st.userId)) st.userId = crewList.find(c => c.group === 'Pilots')?.id || crewList[0]?.id || '';
    const opt = (k, v, title, desc) => `<button class="opt ${st[k] === v ? 'on' : ''}" data-k="${k}" data-v="${esc(v)}" aria-pressed="${st[k] === v}"><strong>${esc(title)}</strong><span>${esc(desc)}</span></button>`;
    el.innerHTML = `<div class="choose">
      <h1>How would you like to view FlightDeck Bid today?</h1>
      <p class="muted">This demo asks every time you open it. Everything is fictional and stays in this browser — nothing is sent to a server.</p>
      <h2><span class="step-n">1</span>Department</h2>
      <div class="opts">${S ? opt('scenario', 'keep', `Continue: ${S.dept.name}`, 'Keep your current demo data and changes.') : ''}${Object.entries(SCENARIOS).map(([k, s]) => opt('scenario', k, s.label, s.desc)).join('')}</div>
      <h2><span class="step-n">2</span>Role</h2>
      <div class="opts">${opt('role', 'admin', 'Administrator / Scheduler', 'Configure, build trips, generate, lock and publish.')}${opt('role', 'crew', 'Crew member', 'View schedule, request time off, bid and swap.')}${opt('role', 'accounting', 'Accounting / Finance', 'Trip records, billing fields, invoices, period reports.')}${opt('role', 'management', 'Management', 'All scheduler rights plus exception approval.')}</div>
      ${st.role === 'crew' ? `<h2><span class="step-n">3</span>Who are you?</h2><div class="field" style="max-width:360px"><select id="chUser" aria-label="Crew member">${crewList.filter(c => c.status === 'active').map(c => `<option value="${c.id}" ${c.id === st.userId ? 'selected' : ''}>${esc(c.name)} — ${esc(c.group)}${c.quals.length ? ' · ' + esc(c.quals.map(q => q.type + ' ' + q.seat).join(', ')) : ''}</option>`).join('')}</select>${crewList.length ? '' : '<small>No crew in this department yet — sign in as Administrator first to add crew.</small>'}</div>` : ''}
      <h2><span class="step-n">${st.role === 'crew' ? 4 : 3}</span>Layout</h2>
      <div class="opts">${opt('layout', 'calendar', 'Calendar', 'Month view with daily chips.')}${opt('layout', 'grid', 'Staffing grid', 'Crew × day roster with coverage row.')}${opt('layout', 'dashboard', 'Dashboard', 'Start from alerts, approvals and KPIs.')}</div>
      <div class="row"><button class="btn primary" id="enter">Enter demo</button>${st.scenario !== 'keep' && S ? '<small class="muted">Loading a department replaces the current demo data in this browser.</small>' : ''}</div>
    </div>`;
    $$('.opt', el).forEach(b => b.onclick = () => { st[b.dataset.k] = b.dataset.v; draw(); });
    $('#chUser', el)?.addEventListener('change', e => st.userId = e.target.value);
    $('#enter', el).onclick = () => {
      if (st.scenario !== 'keep') loadScenario(st.scenario);
      if (st.scenario !== 'keep' && S.crew.length) { generateRoster(); audit('Roster generated', 'Initial proposed roster for demo scenario', 'System'); save(); }
      session.role = st.role; session.userId = st.role === 'crew' ? st.userId : null; session.layout = st.layout;
      audit('Signed in (demo)', `${ROLES[st.role].label}${st.role === 'crew' ? ' — ' + crewName(st.userId) : ''}; layout ${st.layout}`); save();
      el.hidden = true; el.innerHTML = '';
      const dest = !S.dept.setupComplete && can('configure') ? '#/admin/setup' : st.layout === 'dashboard' ? '#/dashboard' : '#/schedule';
      if (location.hash === dest) render(); else location.hash = dest;
      toast(`Signed in as ${st.role === 'crew' ? crewName(st.userId) : ROLES[st.role].label}`);
    };
  };
  draw();
}

function boot() {
  load();
  onChange(render);
  window.addEventListener('hashchange', render);
  $('#switchUser').onclick = () => { session.role = null; chooser(); };
  $('#bell').onclick = () => { location.hash = '#/notifications'; };
  $('#navToggle').onclick = () => { const o = $('#side').classList.toggle('open'); $('#navToggle').setAttribute('aria-expanded', String(o)); };
  chooser();
}
boot();
