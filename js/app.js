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
import { acct, ctx, initAccount, onAccount, signedIn, displayName, signOut, isAdmin, MEMBER_ROLES, APP_ROLE, fetchDept, createDept, queueDeptSave, flushDept, onDeptConflict, deptVersion, hasPendingSave, onDeptSaveError, inviteInfo, acceptInvite, friendly } from './account.js';
import * as team from './views/team.js';
import * as guide from './views/guide.js';
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
  members: { label: 'Members', view: { render: team.renderMembers }, ok: () => team.canManageMembers(), grp: 'Administration' },
  departments: { label: 'Departments', view: { render: team.renderDepartments }, ok: () => acct.listedAdmin, grp: 'Schedule Captain team' },
  users: { label: 'Users', view: { render: team.renderUsers }, ok: () => acct.listedAdmin, grp: 'Schedule Captain team' },
  inbox: { label: 'App feedback', view: { render: fb.renderInbox }, ok: () => acct.listedAdmin, grp: 'Schedule Captain team', count: () => fb.inboxNew },
  guide: { label: 'Staffing & bidding guide', view: guide, ok: () => true, grp: 'Help' },
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
  html += `<a href="#" data-switch>Switch department or view</a><div class="ver-line">Version ${APP_VERSION}</div>`;
  $('#side').innerHTML = html;
  $('[data-switch]', $('#side')).onclick = e => { e.preventDefault(); session.role = null; $('#side').classList.remove('open'); chooser(); };
}
const BANNER_DEFAULT = 'Early access — not an approved scheduling, compliance or accounting system.';
function renderBanner() {
  const b = $('.demo-banner'); if (!b) return;
  if (ctx.mode === 'support') { b.className = 'demo-banner support-bar'; b.innerHTML = `<span>Support view of <strong>${esc(ctx.supportOf)}</strong>. Read-only copy — changes are not saved to the department.</span><button type="button" id="exitSupport">Exit support view</button>`; $('#exitSupport').onclick = exitSupport; return; }
  b.className = 'demo-banner'; b.textContent = ctx.mode === 'sample' ? 'Sample department (super admin only) — fictional data, not saved. Not an approved scheduling, compliance or accounting system.' : BANNER_DEFAULT;
}
function leaveWorkspace() { resetAll(); Object.assign(ctx, { mode: null, deptId: null, version: 0, role: null, crewId: null, name: '', supportOf: null }); session.role = null; }
function exitSupport() { leaveWorkspace(); history.replaceState(null, '', location.pathname); chooser(); toast('Left support view'); }
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
  if (acct.ready && !signedIn()) { chooser(); return; }
  let { route, param } = parseHash();
  if (!ROUTES[route] || !ROUTES[route].ok()) route = 'dashboard';
  fb.noteRoute(route);
  renderTop(); renderNav(route);
  const main = $('#view'); const y = window.scrollY;
  if (session.role === 'crew' && !S.crew.some(c => c.id === session.userId)) { main.innerHTML = '<div class="empty"><p>This department has no crew profile for you yet. Ask your department admin to link you to your crew profile on the Members page.</p></div>'; return; }
  try { ROUTES[route].view.render(main, param); }
  catch (e) { console.error(e); main.innerHTML = `<div class="alert bad">Something went wrong rendering this page: ${esc(e.message)}</div>`; }
  if (render._last === location.hash) window.scrollTo(0, y); else { window.scrollTo(0, 0); }
  render._last = location.hash;
  $('#side').classList.remove('open'); $('#navToggle').setAttribute('aria-expanded', 'false');
}

// ---------------------------------------------------------------- interface chooser (shown at every load)
const ROLE_DESC = { admin: 'Configure, build trips, generate, lock and publish.', crew: 'View schedule, request time off, bid and swap.', accounting: 'Trip records, billing fields, invoices, period reports.', management: 'All scheduler rights plus exception approval.' };
let pendingInvite = null; // { token, info }
async function chooser() {
  await flushDept().catch(() => {});
  leaveWorkspace();
  const el = $('#chooser'); el.hidden = false; renderBanner();
  const st = { pick: '', viewAs: 'admin', userId: '', layout: 'calendar', newName: '' }; let crewCache = {}, busy = false;
  const brand = `<div class="choose-brand">${LOGO}<div><strong>${PRODUCT}</strong><small>Crew availability, bidding and trip scheduling for flight departments</small></div></div>`;
  const inviteCard = () => pendingInvite ? (pendingInvite.info?.valid ? `<div class="alert info" style="margin-bottom:12px"><strong>You're invited to ${esc(pendingInvite.info.department)}</strong> as ${esc(MEMBER_ROLES[pendingInvite.info.role])}. ${signedIn() ? '' : `Create your account with <strong>${esc(pendingInvite.info.email)}</strong>, or log in if you already have one.`}</div>` : `<div class="alert bad" style="margin-bottom:12px">This invite link is no longer valid. Ask your department admin for a new one.</div>`) : '';
  const draw = async () => {
    if (!acct.ready) { el.innerHTML = `<div class="choose">${brand}<div class="acct-bar"><span class="muted">Checking your account…</span></div></div>`; return; }
    if (!signedIn()) {
      el.innerHTML = `<div class="choose landing">${brand}${inviteCard()}<div class="card"><h1>Sign in to ${PRODUCT}</h1>
        <p>Build your department's crew availability, time-off bidding and trip schedule, and invite your crew, schedulers and accounting team.</p>
        <ul><li>Seniority, lottery, rotating or points-based bidding — your department's rules.</li><li>Fixed-wing and helicopter types, multi-type pilots, maintenance, dispatch and line groups.</li><li>Future PTO, line-check observers, optional trips and accounting.</li></ul>
        <div class="row"><button class="btn primary" data-acct="signup">Create free account</button><button class="btn" data-acct="login">Log in</button></div>
        <p class="muted" style="margin-top:14px">Free during the beta. Early access — not an approved scheduling, compliance or accounting system.</p></div></div>`;
      $$('[data-acct]', el).forEach(b => b.onclick = e => { e.preventDefault(); fb.authModal(b.dataset.acct, null, pendingInvite?.info?.valid ? pendingInvite.info.email : ''); });
      return;
    }
    if (pendingInvite?.info?.valid && !busy) {
      busy = true;
      try { const id = await acceptInvite(pendingInvite.token); toast(`Welcome to ${pendingInvite.info.department}`); st.pick = id; pendingInvite = null; }
      catch (e) { toast(friendly(e), 'bad'); pendingInvite = { ...pendingInvite, info: { ...pendingInvite.info, valid: false, error: friendly(e) } }; }
      busy = false; history.replaceState(null, '', location.pathname);
    }
    const sup = acct.listedAdmin;
    const depts = acct.depts;
    const picks = [...depts.map(d => d.id), 'new', ...(sup ? Object.keys(SCENARIOS).filter(k => k !== 'blank').map(k => 'sample:' + k) : [])];
    if (!picks.includes(st.pick)) st.pick = depts[0]?.id || 'new';
    const dept = depts.find(d => d.id === st.pick);
    const isSample = st.pick.startsWith('sample:');
    const canViewAs = isSample || st.pick === 'new' || dept?.role === 'dept_admin' || (sup && dept);
    const fixedRole = dept && !canViewAs ? APP_ROLE[dept.role] : null;
    // crew list for "view as crew"
    let crewList = [];
    if (canViewAs && st.viewAs === 'crew') {
      if (isSample) crewList = SCENARIOS[st.pick.slice(7)].build(TODAY).crew;
      else if (dept) { if (!crewCache[dept.id]) { crewCache[dept.id] = 'loading'; fetchDept(dept.id).then(d => { crewCache[dept.id] = d.state.crew || []; draw(); }).catch(() => { crewCache[dept.id] = []; draw(); }); } crewList = Array.isArray(crewCache[dept.id]) ? crewCache[dept.id] : []; }
      if (!crewList.some(c => c.id === st.userId)) st.userId = crewList.find(c => c.group === 'Pilots')?.id || crewList[0]?.id || '';
    }
    const opt = (k, v, title, desc) => `<button class="opt ${st[k] === v ? 'on' : ''}" data-k="${k}" data-v="${esc(v)}" aria-pressed="${st[k] === v}"><strong>${esc(title)}</strong><span>${desc}</span></button>`;
    const suspended = dept && dept.status !== 'active' && !sup;
    const crewBlocked = suspended || (fixedRole === 'crew' && !dept.crew_id);
    el.innerHTML = `<div class="choose">${brand}${inviteCard()}
      <div class="acct-bar"><span>Signed in as <strong>${esc(displayName())}</strong>${sup ? ' <span class="badge info">Super admin</span>' : ''}</span><span class="row">${sup ? '<a href="#" data-go="departments">Departments</a><a href="#" data-go="users">Users</a><a href="#" data-go="inbox">App feedback</a>' : ''}<a href="#" data-go="account">Account</a><a href="#" data-acct="out">Sign out</a></span></div>
      <h1>${depts.length ? `How would you like to view ${PRODUCT} today?` : `Welcome to ${PRODUCT}`}</h1>
      <p class="muted">${depts.length ? 'Departments you belong to are listed below. Changes save automatically and are shared with everyone in the department.' : 'Create your department to get started, then invite your crew, schedulers and accounting team. If someone invited you, open the invite link they sent.'}</p>
      <h2><span class="step-n">1</span>Department</h2>
      <div class="opts">${depts.map(d => opt('pick', d.id, d.name, `${esc(MEMBER_ROLES[d.role])} · ${d.members} member${d.members === 1 ? '' : 's'}${d.status !== 'active' ? ' · <strong>Suspended</strong>' : ''}`)).join('')}${opt('pick', 'new', 'Create a new department', 'You become its department admin. Free during the beta.')}</div>
      ${suspended ? '<div class="alert bad" style="margin-top:10px">This department is suspended, so it can’t be opened right now. Contact the Schedule Captain team to restore access.</div>' : ''}
      ${st.pick === 'new' ? `<div class="field" style="max-width:420px;margin-top:10px"><label for="newName"><span>Department name</span></label><input id="newName" maxlength="120" placeholder="e.g. Coastal Air Flight Department" value="${esc(st.newName || acct.profile?.organization || '')}"></div>` : ''}
      ${sup ? `<h2 style="font-size:15px">Sample departments <span class="badge info">Super admin only</span></h2><p class="muted" style="margin-top:-4px">Local sandboxes for demos. Nothing is saved.</p><div class="opts">${Object.entries(SCENARIOS).filter(([k]) => k !== 'blank').map(([k, sc]) => opt('pick', 'sample:' + k, sc.label, esc(sc.desc))).join('')}</div>` : ''}
      ${st.pick === 'new' ? '' : fixedRole ? `<h2><span class="step-n">2</span>Your access</h2><p>You'll enter as <strong>${esc(MEMBER_ROLES[dept.role])}</strong>.${!suspended && crewBlocked ? ' <span class="alert bad" style="display:block;margin-top:8px">Your department admin hasn’t linked you to your crew profile yet. Ask them to link you on the Members page.</span>' : ''}</p>` : `
      <h2><span class="step-n">2</span>${dept?.role === 'dept_admin' ? 'View as' : 'Role'}</h2>
      <div class="opts">${['admin', 'crew', 'accounting', 'management'].map(r => opt('viewAs', r, ROLES[r].label, ROLE_DESC[r])).join('')}</div>
      ${st.viewAs === 'crew' ? `<h2><span class="step-n">3</span>Which crew member?</h2><div class="field" style="max-width:360px"><select id="chUser" aria-label="Crew member">${crewList.filter(c => c.status === 'active').map(c => `<option value="${c.id}" ${c.id === st.userId ? 'selected' : ''}>${esc(c.name)} — ${esc(c.group)}</option>`).join('')}</select>${crewList.length ? '' : '<small>No crew in this department yet — enter as Administrator / Scheduler first to add crew.</small>'}</div>` : ''}`}
      <h2><span class="step-n">${st.pick === 'new' ? 2 : !fixedRole && st.viewAs === 'crew' ? 4 : 3}</span>Layout</h2>
      <div class="opts">${opt('layout', 'calendar', 'Calendar', 'Month view with daily chips.')}${opt('layout', 'grid', 'Staffing grid', 'Crew × day roster with coverage row.')}${opt('layout', 'dashboard', 'Dashboard', 'Start from alerts, approvals and KPIs.')}</div>
      <div class="row"><button class="btn primary" id="enter" ${crewBlocked ? 'disabled' : ''}>${st.pick === 'new' ? 'Create department' : 'Enter'}</button></div>
    </div>`;
    $$('.opt', el).forEach(b => b.onclick = () => { st[b.dataset.k] = b.dataset.v; draw(); });
    $('#newName', el)?.addEventListener('input', e => st.newName = e.target.value);
    $$('[data-acct]', el).forEach(b => b.onclick = async e => { e.preventDefault(); await signOut(); resetAll(); toast('Signed out'); });
    $$('[data-go]', el).forEach(a => a.onclick = e => { e.preventDefault(); enterAdminPage('#/' + a.dataset.go); });
    $('#chUser', el)?.addEventListener('change', e => st.userId = e.target.value);
    $('#enter', el).onclick = () => enter(dept, isSample, fixedRole, crewBlocked);
  };
  const enterAdminPage = async dest => {
    // Admin pages need a workspace behind them; use the first department or a sample.
    if (acct.depts[0]) { st.pick = acct.depts[0].id; st.viewAs = 'admin'; return enter(acct.depts.find(d => d.id === st.pick), false, null, false, dest); }
    if (acct.listedAdmin) { st.pick = 'sample:coastal'; st.viewAs = 'admin'; return enter(null, true, null, false, dest); }
    st.pick = 'new'; draw(); if (dest === '#/account') toast('Create a department first, then open Account from the menu');
  };
  const enter = async (dept, isSample, fixedRole, crewBlocked, forceDest) => {
    if (crewBlocked) return;
    const btn = $('#enter', el); if (btn) btn.disabled = true;
    try {
      if (isSample) { loadScenario(st.pick.slice(7)); if (S.crew.length) generateRoster(); Object.assign(ctx, { mode: 'sample', deptId: null, version: 0, role: 'dept_admin', crewId: null, name: S.dept.name }); }
      else if (st.pick === 'new') {
        const name = (st.newName || acct.profile?.organization || '').trim(); if (!name) { toast('Enter a department name', 'bad'); if (btn) btn.disabled = false; return; }
        loadScenario('blank'); S.dept.name = name; S.audit = [];
        const id = await createDept(name, JSON.parse(JSON.stringify(S)));
        const d = await fetchDept(id); setState(d.state); Object.assign(ctx, { mode: 'dept', deptId: d.id, version: d.version, role: 'dept_admin', crewId: null, name: d.name });
      } else {
        if (dept.status !== 'active' && !isAdmin()) throw new Error('This department is suspended. Contact the Schedule Captain team.');
        const d = await fetchDept(dept.id); setState(d.state); Object.assign(ctx, { mode: 'dept', deptId: d.id, version: d.version, role: dept.role, crewId: dept.crew_id, name: d.name });
      }
      const role = st.pick === 'new' ? 'admin' : fixedRole || st.viewAs;
      session.role = role; session.userId = role === 'crew' ? (fixedRole ? dept.crew_id : st.userId) : null; session.layout = st.layout; session.person = displayName();
      if (role === 'crew' && !S.crew.some(c => c.id === session.userId)) { if (fixedRole) throw new Error('Your linked crew profile was not found. Ask your department admin to re-link you on the Members page.'); }
      audit('Signed in', `${displayName()} as ${ROLES[role].label}${role === 'crew' ? ' — ' + crewName(session.userId) : ''}`); if (ctx.mode !== 'dept') save(); // sign-ins ride along with the next real save, so logging in never bumps the shared version
      el.hidden = true; el.innerHTML = '';
      const dest = forceDest || (!S.dept.setupComplete && can('configure') ? '#/admin/setup' : st.layout === 'dashboard' ? '#/dashboard' : '#/schedule');
      if (location.hash === dest) render(); else location.hash = dest;
      toast(st.pick === 'new' ? 'Department created. Set it up, then invite your people from Members.' : `Signed in to ${S.dept.name}`);
      setTimeout(() => fb.whatsNewPopup(), 400);
    } catch (e) { toast(friendly(e), 'bad'); leaveWorkspace(); if (btn) btn.disabled = false; draw(); }
  };
  chooser.redraw = draw;
  draw();
}

const LOGO = '<svg viewBox="0 0 32 32" width="40" height="40" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#1f4f74"/><rect x="7" y="9" width="18" height="15" rx="2" fill="none" stroke="#fff" stroke-width="1.8"/><path d="M7 13.5h18M11 7v4M21 7v4" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><path d="M16 15.6l1.2 2.5 2.7.3-2 1.8.6 2.7-2.5-1.4-2.5 1.4.6-2.7-2-1.8 2.7-.3z" fill="#e8b04a"/></svg>';
const initials = n => (n || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

function boot() {
  onChange(render);
  onChange(() => { if (ctx.mode === 'dept' && signedIn() && session.role) queueDeptSave(S); });
  onAccount(() => { if (!$('#chooser').hidden) chooser.redraw?.(); else if (acct.ready && !signedIn()) chooser(); else if (session.role && S) render(); });
  onDeptConflict(async () => { try { const d = await fetchDept(ctx.deptId); setState(d.state); ctx.version = d.version; render(); toast('Someone else in your department saved changes at the same time. The latest version is loaded — please check and redo your last change.', 'bad'); } catch (e) { console.warn(e); } });
  let lastErr = 0;
  onDeptSaveError(e => { if (Date.now() - lastErr > 30000) { lastErr = Date.now(); toast(`Your latest changes could not be saved: ${friendly(e)}. They will be retried with your next change.`, 'bad'); } });
  setInterval(async () => {
    if (ctx.mode !== 'dept' || document.hidden || hasPendingSave() || !$('#modal').hidden) return;
    try { const v = await deptVersion(); if (v && v.version > ctx.version && !hasPendingSave() && ctx.mode === 'dept') { const d = await fetchDept(ctx.deptId); if (hasPendingSave()) return; setState(d.state); ctx.version = d.version; render(); toast(`Updated with changes from ${v.updated_by_name || 'your department'}`); } } catch { /* offline */ }
  }, 20000);
  window.addEventListener('pagehide', () => { flushDept(); });
  const jm = location.hash.match(/^#\/join\/([0-9a-f]{48})$/);
  if (jm) { pendingInvite = { token: jm[1], info: null }; inviteInfo(jm[1]).then(i => { pendingInvite.info = i || { valid: false }; chooser.redraw?.(); }).catch(() => { pendingInvite.info = { valid: false }; chooser.redraw?.(); }); }
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

// Label editable table cells so they can stack as cards on phones (see table.edit-stack in styles.css).
function labelEditTables() {
  document.querySelectorAll('table.edit-stack').forEach(t => {
    const heads = [...t.querySelectorAll('thead th')].map(th => th.textContent.trim());
    t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (!td.dataset.l && heads[i]) td.dataset.l = heads[i]; }));
  });
}
new MutationObserver(labelEditTables).observe(document.body, { childList: true, subtree: true });
