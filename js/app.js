import { esc, D } from './util.js';
import { S, session, load, save, loadScenario, onChange, ROLES, can, tripsOn, myNotifications, crewName, TODAY, audit, resetAll } from './store.js';
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
import * as observersView from './views/observers.js';
import * as fb from './views/feedback.js';
import { acct, initAccount, onAccount, signedIn, displayName, queueCloudSave, loadCloud, signOut } from './account.js';
import { setState } from './store.js';
import { APP_VERSION } from './releases.js';
import { PRODUCT } from './config.js';

const ROUTES = {
  dashboard: { label: 'Dashboard', view: dashboard, ok: () => true, grp: 'Overview' },
  notifications: { label: 'Notifications', view: misc.notifications, ok: () => true, grp: 'Overview', count: () => myNotifications().filter(n => !n.read).length },
  schedule: { label: 'Schedule', view: schedule, ok: () => session.role !== 'accounting', grp: 'Crew availability' },
  timeoff: { label: 'Time off', view: timeoff, ok: () => session.role !== 'accounting', grp: 'Crew availability', count: () => can('timeoff.approve') ? S.requests.filter(r => r.status === 'pending').length : 0 },
  bids: { label: 'Bids & swaps', view: bids, ok: () => session.role !== 'accounting', grp: 'Crew availability', count: () => can('bids.approve') ? S.bids.filter(b => b.status === 'open').length : S.bids.filter(b => b.status === 'awaiting-partner' && b.withCrewId === session.userId).length },
  observers: { label: 'Line checks', view: observersView, ok: () => session.role !== 'accounting', grp: 'Crew availability' },
  trips: { label: 'Trips', view: trips, ok: () => tripsOn(), grp: 'Trip scheduling' },
  passengers: { label: 'Passengers', view: passengers, ok: () => tripsOn() && session.role !== 'crew', grp: 'Trip scheduling' },
  accounting: { label: 'Accounting records', view: accounting, ok: () => tripsOn() && can('acct.view'), grp: 'Trip scheduling', count: () => session.role === 'accounting' ? S.trips.filter(t => t.billingFlag).length : 0 },
  reports: { label: 'Reports & fairness', view: reports, ok: () => true, grp: 'Insight' },
  exceptions: { label: 'Exceptions', view: misc.exceptions, ok: () => can('override'), grp: 'Insight', count: () => S.exceptions.filter(e => e.status === 'pending').length },
  audit: { label: 'Audit trail', view: misc.audit, ok: () => can('audit') || session.role === 'accounting', grp: 'Insight' },
  admin: { label: 'Setup & rules', view: admin, ok: () => can('configure'), grp: 'Administration' },
  users: { label: 'Users & support', view: { render: fb.renderUsers }, ok: () => acct.listedAdmin, grp: 'Schedule Captain team' },
  inbox: { label: 'App feedback', view: { render: fb.renderInbox }, ok: () => acct.listedAdmin, grp: 'Schedule Captain team', count: () => fb.inboxNew },
  whatsnew: { label: 'What’s new', view: { render: fb.renderWhatsNew }, ok: () => true, grp: 'Help', badge: () => fb.updatedChip() ? 'New' : '' },
  feedback: { label: 'Send feedback', view: { render: fb.renderSend }, ok: () => true, grp: 'Help' },
  account: { label: 'Account', view: { render: fb.renderAccount }, ok: () => true, grp: 'Help' },
};

function parseHash() { const [, route = 'dashboard', ...rest] = (location.hash || '#/dashboard').split('/'); return { route, param: rest.join('/') }; }

function renderNav(active) {
  let html = '', grp = '';
  for (const [k, r] of Object.entries(ROUTES)) {
    if (!r.ok()) continue;
    if (r.grp !== grp) { grp = r.grp; html += `<div class="grp">${esc(grp)}</div>`; }
    const n = r.count ? r.count() : 0;
    const bd = r.badge ? r.badge() : '';
    html += `<a href="#/${k}" class="${k === active ? 'on' : ''}" ${k === active ? 'aria-current="page"' : ''}>${esc(r.label)}${n ? `<span class="n">${n}</span>` : bd ? `<span class="n">${esc(bd)}</span>` : ''}</a>`;
  }
  html += `<a href="#" data-switch>Switch user or role</a><div class="ver-line">Version ${APP_VERSION}</div>`;
  $('#side').innerHTML = html;
  $('[data-switch]', $('#side')).onclick = e => { e.preventDefault(); session.role = null; $('#side').classList.remove('open'); chooser(); };
}
const BANNER_DEFAULT = 'Early access — not an approved scheduling, compliance or accounting system.';
function renderBanner() {
  const b = $('.demo-banner'); if (!b) return;
  if (S?.supportOf) { b.className = 'demo-banner support-bar'; b.innerHTML = `<span>Support view of <strong>${esc(S.supportOf.name)}</strong>’s department (${esc(S.supportOf.email)}). Read-only copy — changes are not saved to their account.</span><button type="button" id="exitSupport">Exit support view</button>`; $('#exitSupport').onclick = exitSupport; return; }
  b.className = 'demo-banner'; b.textContent = S?.sample ? 'Sample department (admin only) — fictional data. Not an approved scheduling, compliance or accounting system.' : BANNER_DEFAULT;
}
function exitSupport() { resetAll(); session.role = null; history.replaceState(null, '', location.pathname); chooser(); toast('Left support view'); }
function renderTop() {
  renderBanner();
  $('#deptName').textContent = S.dept.name;
  const mode = { '91': 'Part 91', '135': 'Part 135', mixed: 'Mixed 91 / 135' }[S.dept.mode];
  const who = session.role === 'crew' ? crewName(session.userId) : ROLES[session.role].label;
  $('#topMeta').innerHTML = `<span class="badge info">${esc(mode)}</span><span class="badge ${tripsOn() ? 'ok' : 'muted'}">Trip module ${tripsOn() ? 'on' : 'off'}</span><span class="badge">${esc(who)}</span><span class="badge muted">Today ${esc(D.label(TODAY))}</span>`;
  const ab = $('#acctBtn'); ab.textContent = signedIn() ? initials(displayName()) : 'Log in'; ab.title = signedIn() ? `Account: ${displayName()}` : 'Log in or create a free account'; ab.classList.toggle('avatar', signedIn());
  const n = myNotifications().filter(x => !x.read).length; const b = $('#bellCount'); b.hidden = !n; b.textContent = n > 99 ? '99+' : n;
}
export function render() {
  if (!session.role || !S) return;
  if (acct.ready && !signedIn()) { session.role = null; chooser(); return; }
  let { route, param } = parseHash();
  if (!ROUTES[route] || !ROUTES[route].ok()) route = 'dashboard';
  fb.noteRoute(route);
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
  const el = $('#chooser'); el.hidden = false; renderBanner();
  const st = { scenario: '', role: 'admin', userId: '', layout: 'calendar' }; let cloudState = null, cloudLoading = false;
  const brand = `<div class="choose-brand">${LOGO}<div><strong>${PRODUCT}</strong><small>Crew availability, bidding and trip scheduling for flight departments</small></div></div>`;
  const draw = () => {
    if (!acct.ready && localStorage.getItem('sc-auth')) { el.innerHTML = `<div class="choose">${brand}<div class="acct-bar"><span class="muted">Checking your account…</span></div></div>`; return; }
    if (!signedIn()) {
      el.innerHTML = `<div class="choose landing">${brand}<div class="card"><h1>Sign in to ${PRODUCT}</h1>
        <p>Build your department's crew availability, time-off bidding and trip schedule. Everything you set up is saved to your account.</p>
        <ul><li>Seniority, lottery, rotating or points-based bidding — your department's rules.</li><li>Fixed-wing and helicopter types, multi-type pilots, maintenance, dispatch and line groups.</li><li>Future PTO, line-check observers, optional trips and accounting.</li></ul>
        <div class="row"><button class="btn primary" data-acct="signup">Create free account</button><button class="btn" data-acct="login">Log in</button></div>
        <p class="muted" style="margin-top:14px">Early access. Not an approved scheduling, compliance or accounting system.</p></div></div>`;
      $$('[data-acct]', el).forEach(b => b.onclick = e => { e.preventDefault(); fb.authModal(b.dataset.acct); });
      return;
    }
    const isAdm = acct.listedAdmin;
    const mineLocal = S && !S.supportOf && S.ownerId === acct.user.id && (isAdm || !S.sample);
    const valid = [...(acct.cloud ? ['cloud'] : []), ...(mineLocal ? ['keep'] : []), 'blank', ...(isAdm ? Object.keys(SCENARIOS).filter(k => k !== 'blank') : [])];
    if (!valid.includes(st.scenario)) st.scenario = mineLocal ? 'keep' : acct.cloud ? 'cloud' : isAdm ? 'coastal' : 'blank';
    if (st.scenario === 'cloud' && !cloudState && !cloudLoading) { cloudLoading = true; loadCloud().then(c => { cloudState = c; cloudLoading = false; if (!c) st.scenario = 'blank'; draw(); }).catch(() => { cloudLoading = false; toast('Could not load your saved department', 'bad'); st.scenario = 'blank'; draw(); }); }
    const crewList = st.scenario === 'keep' ? S.crew : st.scenario === 'cloud' ? (cloudState?.crew || []) : SCENARIOS[st.scenario].build(TODAY).crew;
    if (st.role === 'crew' && !crewList.some(c => c.id === st.userId)) st.userId = crewList.find(c => c.group === 'Pilots')?.id || crewList[0]?.id || '';
    const opt = (k, v, title, desc) => `<button class="opt ${st[k] === v ? 'on' : ''}" data-k="${k}" data-v="${esc(v)}" aria-pressed="${st[k] === v}"><strong>${esc(title)}</strong><span>${esc(desc)}</span></button>`;
    const fresh = valid.length && (acct.cloud || mineLocal);
    el.innerHTML = `<div class="choose">${brand}
      <div class="acct-bar"><span>Signed in as <strong>${esc(displayName())}</strong>${isAdm ? ' ' + '<span class="badge info">Admin</span>' : ''}</span><span class="row">${isAdm ? '<a href="#" data-go="users">Users &amp; support</a><a href="#" data-go="inbox">App feedback</a>' : ''}<a href="#" data-acct="out">Sign out</a></span></div>
      <h1>How would you like to view ${PRODUCT} today?</h1>
      <p class="muted">This asks every time you open it. Your department is saved to your account as you work.${isAdm ? ' Sample departments are shown to admins only, for demos and support.' : ''}</p>
      <h2><span class="step-n">1</span>Department</h2>
      <div class="opts">${acct.cloud ? opt('scenario', 'cloud', `My department: ${acct.cloud.department || 'Saved department'}`, `Saved to your account ${new Date(acct.cloud.updated_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.${cloudLoading ? ' Loading…' : ''}`) : ''}${mineLocal && !acct.cloud ? opt('scenario', 'keep', `Continue: ${S.dept.name}`, 'Keep your current department and changes.') : ''}${opt('scenario', 'blank', fresh ? 'Start a new department' : 'Set up my department', fresh ? 'Start over with the guided setup. Replaces your saved department.' : 'Walk through department setup: aircraft, crew, rules and bidding.')}</div>
      ${isAdm ? `<h2 style="font-size:15px">Sample departments <span class="badge info">Admin only</span></h2><div class="opts">${Object.entries(SCENARIOS).filter(([k]) => k !== 'blank').map(([k, sc]) => opt('scenario', k, sc.label, sc.desc)).join('')}</div>` : ''}
      <h2><span class="step-n">2</span>Role</h2>
      <div class="opts">${opt('role', 'admin', 'Administrator / Scheduler', 'Configure, build trips, generate, lock and publish.')}${opt('role', 'crew', 'Crew member', 'View schedule, request time off, bid and swap.')}${opt('role', 'accounting', 'Accounting / Finance', 'Trip records, billing fields, invoices, period reports.')}${opt('role', 'management', 'Management', 'All scheduler rights plus exception approval.')}</div>
      ${st.role === 'crew' ? `<h2><span class="step-n">3</span>Who are you?</h2><div class="field" style="max-width:360px"><select id="chUser" aria-label="Crew member">${crewList.filter(c => c.status === 'active').map(c => `<option value="${c.id}" ${c.id === st.userId ? 'selected' : ''}>${esc(c.name)} — ${esc(c.group)}${c.quals.length ? ' · ' + esc(c.quals.map(q => q.type + ' ' + q.seat).join(', ')) : ''}</option>`).join('')}</select>${crewList.length ? '' : '<small>No crew in this department yet — enter as Administrator / Scheduler first to add crew.</small>'}</div>` : ''}
      <h2><span class="step-n">${st.role === 'crew' ? 4 : 3}</span>Layout</h2>
      <div class="opts">${opt('layout', 'calendar', 'Calendar', 'Month view with daily chips.')}${opt('layout', 'grid', 'Staffing grid', 'Crew × day roster with coverage row.')}${opt('layout', 'dashboard', 'Dashboard', 'Start from alerts, approvals and KPIs.')}</div>
      <div class="row"><button class="btn primary" id="enter">Enter</button>${!['keep', 'cloud'].includes(st.scenario) && fresh ? `<small class="muted">${st.scenario === 'blank' ? 'Starting a new department replaces your saved department.' : 'Loading a sample replaces your saved department.'}</small>` : ''}</div>
    </div>`;
    $$('.opt', el).forEach(b => b.onclick = () => { st[b.dataset.k] = b.dataset.v; draw(); });
    $$('[data-acct]', el).forEach(b => b.onclick = async e => { e.preventDefault(); await signOut(); cloudState = null; resetAll(); toast('Signed out'); });
    $$('[data-go]', el).forEach(a => a.onclick = e => { e.preventDefault(); st.role = 'admin'; enter('#/' + a.dataset.go); });
    $('#chUser', el)?.addEventListener('change', e => st.userId = e.target.value);
    $('#enter', el).onclick = () => enter();
  };
  const enter = (forceDest) => {
    if (st.scenario === 'cloud') { if (!cloudState) return toast('Your saved department is still loading', 'bad'); setState(cloudState); }
    else if (st.scenario !== 'keep') {
      loadScenario(st.scenario);
      if (st.scenario === 'blank') { const org = acct.profile?.organization?.trim(); if (org) S.dept.name = org; }
      else S.sample = true;
    }
    delete S.supportOf; S.ownerId = acct.user.id;
    if (!['keep', 'cloud', 'blank'].includes(st.scenario) && S.crew.length) { generateRoster(); audit('Roster generated', 'Initial proposed roster for sample department', 'System'); }
    session.role = st.role; session.userId = st.role === 'crew' ? st.userId : null; session.layout = st.layout;
    audit('Signed in', `${ROLES[st.role].label}${st.role === 'crew' ? ' — ' + crewName(st.userId) : ''}; layout ${st.layout}`); save();
    el.hidden = true; el.innerHTML = '';
    const dest = forceDest || (!S.dept.setupComplete && can('configure') ? '#/admin/setup' : st.layout === 'dashboard' ? '#/dashboard' : '#/schedule');
    if (location.hash === dest) render(); else location.hash = dest;
    toast(`Signed in as ${st.role === 'crew' ? crewName(st.userId) : ROLES[st.role].label}`);
    setTimeout(() => fb.whatsNewPopup(), 400);
  };
  chooser.redraw = draw;
  draw();
}

const LOGO = '<svg viewBox="0 0 32 32" width="40" height="40" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#1f4f74"/><rect x="7" y="9" width="18" height="15" rx="2" fill="none" stroke="#fff" stroke-width="1.8"/><path d="M7 13.5h18M11 7v4M21 7v4" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><path d="M16 15.6l1.2 2.5 2.7.3-2 1.8.6 2.7-2.5-1.4-2.5 1.4.6-2.7-2-1.8 2.7-.3z" fill="#e8b04a"/></svg>';
const initials = n => (n || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

function boot() {
  load();
  onChange(render);
  onChange(() => { if (signedIn() && session.role) queueCloudSave(S); });
  onAccount(() => { if (!$('#chooser').hidden) chooser.redraw?.(); else if (acct.ready && !signedIn()) { resetAll(); session.role = null; chooser(); } else if (session.role && S) render(); });
  initAccount();
  window.addEventListener('hashchange', render);
  $('#switchUser').onclick = () => { session.role = null; chooser(); };
  $('#bell').onclick = () => { location.hash = '#/notifications'; };
  $('#fbBtn').onclick = () => { location.hash = '#/feedback'; };
  $('#acctBtn').onclick = () => { if (signedIn()) location.hash = '#/account'; else fb.authModal('login'); };
  $('#navToggle').onclick = () => { const o = $('#side').classList.toggle('open'); $('#navToggle').setAttribute('aria-expanded', String(o)); };
  chooser();
}
boot();
