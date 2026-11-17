// Account, Send feedback, admin App feedback inbox and What's new.
import { esc } from '../util.js';
import { S, session } from '../store.js';
import { acct, signedIn, isAdmin, displayName, signIn, signUp, signOut, updateProfile, sendFeedback, myFeedback, allFeedback, updateFeedback, claimAdmin, mfaEnroll, mfaVerify, friendly, changePassword, ctx, MEMBER_ROLES, removeMember, refreshAccount } from '../account.js';
import { APP_VERSION, RELEASES, unseen, markSeen, seenVer, cmpVer } from '../releases.js';
import { PRODUCT } from '../config.js';
import { $, $$, modal, close, toast, badge, empty, confirm } from '../ui.js';

const fmtDT = d => d ? new Date(d).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const fmtD = d => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const KIND = { idea: 'Idea or request', problem: 'Something is not working', question: 'Question', other: 'Other' };
const STATUS = { new: ['New', 'warn'], reviewing: ['Reviewing', 'info'], planned: ['Planned', 'info'], done: ['Done', 'ok'], declined: ['Not planned', 'muted'] };
const stBadge = s => badge(STATUS[s]?.[0] || s, STATUS[s]?.[1] || '');
let fbFrom = '';
const onRoute = r => (location.hash.replace(/^#\/?/, '').split('/')[0] || 'dashboard') === r;
export function noteRoute(route) { if (!['feedback', 'inbox', 'account', 'whatsnew'].includes(route)) fbFrom = location.hash || ''; }

// ---------------------------------------------------------------- sign in / create account
export function authModal(mode = 'login', after, email = '') {
  const em = esc(email);
  if (acct.offline) { toast('Accounts are unavailable right now. Please try again in a few minutes.', 'bad'); return; }
  const body = m => m === 'login'
    ? `<form id="af" class="auth-form"><label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" value="${em}" required></label>
       <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>
       <p class="modal-err" id="aerr" hidden></p><button class="btn primary" type="submit">Log in</button></form>
       <p class="muted" style="margin-bottom:0">New here? <a href="#" data-sw="signup">Create a free account</a>. Forgot your password? Contact the Schedule Captain team and they can reset it.</p>`
    : `<form id="af" class="auth-form"><label class="field"><span>Your name</span><input name="display_name" autocomplete="name" maxlength="80" required></label>
       <label class="field"><span>Flight department or company (optional)</span><input name="organization" autocomplete="organization" maxlength="120"></label>
       <label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" value="${em}" required></label>
       <label class="field"><span>Create a password</span><input name="password" type="password" minlength="10" maxlength="128" autocomplete="new-password" required><small>At least 10 characters with letters and numbers.</small></label>
       <p class="modal-err" id="aerr" hidden></p><button class="btn primary" type="submit">Create account</button></form>
       <p class="muted" style="margin-bottom:0">Already have an account? <a href="#" data-sw="login">Log in</a>. Departments are shared with the people their admin invites. During early access, avoid sensitive personal information.</p>`;
  const title = m => m === 'login' ? `Log in to ${PRODUCT}` : 'Create a free account';
  const wire = card => {
    $$('[data-sw]', card).forEach(a => a.onclick = e => { e.preventDefault(); mode = a.dataset.sw; $('#mtitle').textContent = title(mode); $('.modal-body', card).innerHTML = body(mode); wire(card); });
    $('#af', card).onsubmit = async e => {
      e.preventDefault(); const f = e.target; const b = $('button[type=submit]', f); const err = $('#aerr', card); err.hidden = true;
      b.disabled = true; const lbl = b.textContent; b.textContent = mode === 'login' ? 'Logging in…' : 'Creating account…';
      try {
        if (mode === 'login') await signIn(f.email.value, f.password.value);
        else await signUp({ email: f.email.value.trim(), password: f.password.value, display_name: f.display_name.value.trim(), organization: f.organization.value.trim() });
        close(true); toast(mode === 'login' ? `Signed in as ${displayName()}` : `Welcome, ${displayName()}. Your account is ready.`); after?.();
      } catch (ex) { err.textContent = friendly(ex); err.hidden = false; if (ex.code === 'exists') { mode = 'login'; } }
      finally { b.disabled = false; b.textContent = lbl; }
    };
  };
  return modal(title(mode), body(mode), { actions: [{ label: 'Cancel', value: null, kind: 'ghost' }], onOpen: wire });
}

// ---------------------------------------------------------------- What's new
export function whatsNewPopup(force = false) {
  const list = force ? RELEASES.slice(0, 1) : unseen(); if (!list.length) return;
  const prev = seenVer(); markSeen();
  modal(prev && !force ? `Updated to ${APP_VERSION}` : `What’s new in ${PRODUCT}`, `${list.map(rel).join('')}<p class="muted" style="margin-bottom:0"><a href="#/whatsnew" data-close>See every release</a></p>`, { wide: true, actions: [{ label: 'Got it', value: true, kind: 'primary' }] });
}
const rel = r => `<section class="rel"><h3>${esc(r.v)} <small class="muted">${esc(fmtD(r.d))}</small></h3><p><strong>${esc(r.t)}</strong></p><ul>${r.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></section>`;
export function renderWhatsNew(el) {
  markSeen();
  el.innerHTML = `<div class="page-head"><div><h1>What’s new</h1><p>You are using version ${APP_VERSION}. Every update is listed here with what changed.</p></div></div><div class="card">${RELEASES.map(rel).join('<hr>')}</div>`;
}
export const updatedChip = () => seenVer() && cmpVer(APP_VERSION, seenVer()) > 0;

// ---------------------------------------------------------------- Send feedback
export async function renderSend(el) {
  if (!signedIn()) {
    el.innerHTML = `<div class="page-head"><div><h1>Send feedback</h1><p>Ideas, requests, problems or questions go straight to the ${PRODUCT} team.</p></div></div>
      <div class="card"><p>Log in or create a free account to send feedback. That way the team can reply, and you can see the status of everything you sent.</p><div class="row"><button class="btn primary" data-a="signup">Create a free account</button><button class="btn" data-a="login">Log in</button></div></div>`;
    el.onclick = e => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) authModal(a, () => renderSend(el)); };
    return;
  }
  const from = fbFrom.replace(/^#\//, '') || 'dashboard';
  el.innerHTML = `<div class="page-head"><div><h1>Send feedback</h1><p>Ideas, requests, problems or questions about ${PRODUCT} go straight to the ${PRODUCT} team. Replies show here.</p></div></div>
    <div class="grid g2" style="align-items:start"><form class="card" id="fbf"><h2>New message</h2>
      <label class="field"><span>Type</span><select name="kind">${Object.entries(KIND).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
      <label class="field"><span>Message</span><textarea name="message" rows="7" minlength="3" maxlength="4000" required placeholder="What would make scheduling easier for your department?"></textarea></label>
      <label class="check"><input type="checkbox" name="ctx" checked> Include the page I was on (${esc(from)}), my demo role and department</label>
      <p class="muted">Signed in as ${esc(displayName())} (${esc(acct.user.email)}). Version ${APP_VERSION}.</p>
      <button class="btn primary" type="submit">Send feedback</button></form>
      <div class="card"><h2>Your messages</h2><div id="mine"><p class="muted">Loading…</p></div></div></div>`;
  const drawMine = async () => {
    try { const list = await myFeedback(); if (!onRoute('feedback')) return;
      $('#mine', el).innerHTML = list.length ? list.map(f => `<div class="fb-item"><div class="row" style="justify-content:space-between"><strong>${esc(KIND[f.kind])}</strong>${stBadge(f.status)}</div><p class="fb-msg">${esc(f.message)}</p><small class="muted">Sent ${esc(fmtDT(f.created_at))}${f.page ? ' · ' + esc(f.page) : ''}</small>${f.admin_reply ? `<div class="fb-reply"><strong>Reply from the ${PRODUCT} team</strong><p>${esc(f.admin_reply)}</p><small class="muted">${esc(fmtDT(f.replied_at))}</small></div>` : ''}</div>`).join('') : '<p class="muted">Nothing sent yet.</p>';
    } catch (e) { $('#mine', el).innerHTML = `<div class="alert bad">${esc(friendly(e))}</div>`; }
  };
  drawMine();
  $('#fbf', el).onsubmit = async e => {
    e.preventDefault(); const f = e.target; const b = $('button[type=submit]', f); b.disabled = true; b.textContent = 'Sending…';
    try {
      const ctx = f.ctx.checked ? { role: session.role, department: S?.dept?.name, scenario: S?.scenario, layout: session.layout, viewport: `${innerWidth}x${innerHeight}` } : {};
      await sendFeedback({ kind: f.kind.value, message: f.message.value.trim(), page: f.ctx.checked ? from : '', context: ctx });
      f.reset(); toast('Thanks. Your feedback was sent to the Schedule Captain team.'); drawMine();
    } catch (ex) { toast(friendly(ex), 'bad'); }
    finally { b.disabled = false; b.textContent = 'Send feedback'; }
  };
}

// ---------------------------------------------------------------- Admin: two-factor gate
export function mfaGate(el, then) {
  if (!acct.hasFactor) {
    el.innerHTML = `<div class="page-head"><div><h1>Set up two-factor sign-in</h1><p>Admin tools (feedback and user support) require an authenticator app.</p></div></div><div class="card" id="mf"><button class="btn primary" data-a="enroll">Set up authenticator</button></div>`;
    $('[data-a="enroll"]', el).onclick = async () => {
      try { const d = await mfaEnroll();
        $('#mf', el).innerHTML = `<p>Scan this code with an authenticator app such as Google Authenticator, Microsoft Authenticator, 1Password or Authy.</p><div class="qr"><img alt="QR code for authenticator app" src="${esc(d.totp.qr_code)}" width="200" height="200"></div><details><summary>Can’t scan? Enter this key instead</summary><code class="secret">${esc(d.totp.secret)}</code></details>
          <form id="mv" class="row" style="margin-top:12px"><label class="field" style="margin:0"><span>6-digit code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><button class="btn primary" type="submit">Verify</button></form>`;
        $('#mv', el).onsubmit = async e => { e.preventDefault(); try { await mfaVerify(e.target.code.value, d.id); toast('Two-factor sign-in is on'); then(); } catch (ex) { toast(friendly(ex), 'bad'); } };
      } catch (ex) { toast(friendly(ex), 'bad'); }
    };
    return;
  }
  el.innerHTML = `<div class="page-head"><div><h1>Verify it’s you</h1><p>Enter the 6-digit code from your authenticator app to open admin tools.</p></div></div><form class="card row" id="mv"><label class="field" style="margin:0"><span>6-digit code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><button class="btn primary" type="submit">Verify</button></form>`;
  $('#mv', el).onsubmit = async e => { e.preventDefault(); try { await mfaVerify(e.target.code.value); then(); } catch (ex) { toast(friendly(ex), 'bad'); } };
}

// ---------------------------------------------------------------- Admin: App feedback inbox
export let inboxNew = 0;
export async function renderInbox(el, param) {
  if (!onRoute('inbox')) return;
  if (!signedIn() || !acct.listedAdmin) { el.innerHTML = empty('Admin access only. Log in with an admin account.'); return; }
  if (!isAdmin()) return mfaGate(el, () => renderInbox(el, param));
  const filter = param || 'open';
  el.innerHTML = `<div class="page-head"><div><h1>App feedback</h1><p>Ideas, problems and questions sent from inside ${PRODUCT}. Set a status and reply; the sender sees both on their Send feedback page.</p></div><div class="actions"><button class="btn ghost" data-a="reload">Refresh</button></div></div><div id="ib"><p class="muted">Loading…</p></div>`;
  let list;
  try { list = await allFeedback(); } catch (e) { if (!onRoute('inbox')) return; $('#ib', el).innerHTML = `<div class="alert bad">${esc(friendly(e))}</div>`; return; }
  if (!onRoute('inbox')) return;
  inboxNew = list.filter(f => f.status === 'new').length;
  const groups = { open: f => ['new', 'reviewing', 'planned'].includes(f.status), new: f => f.status === 'new', done: f => ['done', 'declined'].includes(f.status), all: () => true };
  const shown = list.filter(groups[filter] || groups.open);
  const tabs = [['open', `Open (${list.filter(groups.open).length})`], ['new', `New (${inboxNew})`], ['done', 'Closed'], ['all', `All (${list.length})`]];
  $('#ib', el).innerHTML = `<div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button class="tab ${k === filter ? 'on' : ''}" data-f="${k}" aria-selected="${k === filter}">${esc(l)}</button>`).join('')}</div>
    ${shown.length ? shown.map(f => `<div class="card fb-admin" data-id="${f.id}"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><div><strong>${esc(f.profiles?.display_name || 'Unknown')}</strong> <small class="muted">${esc(f.profiles?.email || '')}${f.profiles?.organization ? ' · ' + esc(f.profiles.organization) : ''}</small></div><div class="row">${badge(KIND[f.kind], '')}${stBadge(f.status)}</div></div>
      <p class="fb-msg">${esc(f.message)}</p>
      <small class="muted">${esc(fmtDT(f.created_at))} · v${esc(f.app_version || '?')}${f.page ? ' · page ' + esc(f.page) : ''}${f.context?.role ? ' · role ' + esc(f.context.role) : ''}${f.context?.department ? ' · ' + esc(f.context.department) : ''}${f.context?.viewport ? ' · ' + esc(f.context.viewport) : ''}</small>
      <div class="fb-edit"><label class="field"><span>Status</span><select data-s>${Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}" ${k === f.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>Reply to sender (optional)</span><textarea data-r rows="2" maxlength="4000">${esc(f.admin_reply || '')}</textarea></label><button class="btn sm primary" data-save>Save</button></div></div>`).join('') : empty('Nothing here.')}`;
  el.onclick = async e => {
    if (e.target.closest('[data-a="reload"]')) return renderInbox(el, filter);
    const t = e.target.closest('[data-f]'); if (t) { location.hash = '#/inbox/' + t.dataset.f; return; }
    const s = e.target.closest('[data-save]'); if (!s) return;
    const card = s.closest('[data-id]'); s.disabled = true;
    try { await updateFeedback(card.dataset.id, $('[data-s]', card).value, $('[data-r]', card).value); toast('Saved. The sender can see the status and reply.'); renderInbox(el, filter); }
    catch (ex) { toast(friendly(ex), 'bad'); s.disabled = false; }
  };
}

// ---------------------------------------------------------------- Account page
export function renderAccount(el) {
  if (!signedIn()) {
    el.innerHTML = `<div class="page-head"><div><h1>Account</h1><p>You are using ${PRODUCT} as a guest. Your demo data stays in this browser.</p></div></div><div class="card"><p>With a free account your demo department is saved to your account and you can send feedback to the team.</p><div class="row"><button class="btn primary" data-a="signup">Create a free account</button><button class="btn" data-a="login">Log in</button></div></div>`;
    el.onclick = e => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) authModal(a, () => renderAccount(el)); };
    return;
  }
  const p = acct.profile || {};
  el.innerHTML = `<div class="page-head"><div><h1>Account</h1><p>Signed in as ${esc(acct.user.email)}${acct.listedAdmin ? ' · ' + (isAdmin() ? 'Super admin (verified)' : 'Super admin (two-factor needed)') : ''}.</p></div><div class="actions"><button class="btn" data-a="out">Sign out</button></div></div>
    <div class="grid g2" style="align-items:start">
    <form class="card" id="pf"><h2>Profile</h2><label class="field"><span>Name</span><input name="display_name" maxlength="80" value="${esc(p.display_name || '')}" required></label><label class="field"><span>Flight department or company</span><input name="organization" maxlength="120" value="${esc(p.organization || '')}"></label><button class="btn primary" type="submit">Save profile</button></form>
    <div class="card"><h2>Your departments</h2>${acct.depts.length ? `<ul class="plain">${acct.depts.map(d => `<li class="row" style="justify-content:space-between"><span><strong>${esc(d.name)}</strong><br><small class="muted">${esc(MEMBER_ROLES[d.role])} · ${d.members} member${d.members === 1 ? '' : 's'}${d.status !== 'active' ? ' · Suspended' : ''}</small></span><button class="btn sm ghost" data-a="leave" data-id="${d.id}" data-name="${esc(d.name)}">Leave</button></li>`).join('')}</ul>` : '<p class="muted">You are not in a department yet. Create one from the start screen, or open an invite link from your department admin.</p>'}<p class="muted">Department data is shared with its members and saves automatically. Early access: not an approved scheduling, compliance or accounting system.</p></div>
    <form class="card" id="pwf"><h2>Change password</h2><label class="field"><span>New password</span><input name="pw" type="password" autocomplete="new-password" minlength="10" required></label><label class="field"><span>Confirm new password</span><input name="pw2" type="password" autocomplete="new-password" minlength="10" required></label><button class="btn" type="submit">Change password</button></form>
    ${acct.listedAdmin ? '' : `<form class="card" id="cf"><h2>Admin access</h2><p class="muted">Have a one-time admin code from the ${PRODUCT} team? Enter it to turn this account into an admin. You will set up an authenticator app next.</p><label class="field"><span>Admin code</span><input name="code" autocomplete="off" required></label><button class="btn" type="submit">Claim admin access</button></form>`}
    ${acct.listedAdmin ? `<div class="card"><h2>Super admin</h2><p>${isAdmin() ? 'Two-factor verified for this session.' : 'Verify with your authenticator to open admin tools.'}</p><div class="row"><a class="btn primary" href="#/inbox">App feedback</a><a class="btn" href="#/departments">Departments</a><a class="btn" href="#/users">Users</a></div></div>` : ''}
    </div>`;
  $('#pf', el).onsubmit = async e => { e.preventDefault(); try { await updateProfile({ display_name: e.target.display_name.value.trim(), organization: e.target.organization.value.trim() }); toast('Profile saved'); renderAccount(el); } catch (ex) { toast(friendly(ex), 'bad'); } };
  $('#pwf', el).onsubmit = async e => { e.preventDefault(); const f = e.target; if (f.pw.value !== f.pw2.value) return toast('The passwords do not match', 'bad'); if (!/[A-Za-z]/.test(f.pw.value) || !/[0-9]/.test(f.pw.value)) return toast('Use at least 10 characters with letters and numbers', 'bad'); try { await changePassword(f.pw.value); f.reset(); toast('Password changed'); } catch (ex) { toast(friendly(ex), 'bad'); } };
  const cf = $('#cf', el); if (cf) cf.onsubmit = async e => { e.preventDefault(); try { await claimAdmin(e.target.code.value); toast('Admin access granted. Set up two-factor next.'); location.hash = '#/inbox'; } catch (ex) { toast(friendly(ex), 'bad'); } };
  el.onclick = async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'out') { await signOut(); toast('Signed out'); }
    if (a === 'leave') { const b = e.target.closest('[data-a]'); if (!(await confirm(`Leave ${b.dataset.name}`, 'You will lose access until a department admin invites you again.', 'Leave', 'danger'))) return; try { await removeMember(b.dataset.id, acct.user.id); toast('You left the department'); if (ctx.deptId === b.dataset.id) { location.hash = ''; location.reload(); } else renderAccount(el); } catch (ex) { toast(friendly(ex), 'bad'); } }
  };
}

