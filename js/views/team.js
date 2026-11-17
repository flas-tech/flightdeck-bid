// Department members & invites (department admins), and super-admin Departments / Users pages.
import { esc } from '../util.js';
import { S, session, setState, save } from '../store.js';
import { acct, ctx, isAdmin, signedIn, friendly, MEMBER_ROLES, deptMembers, deptInvites, inviteMember, revokeInvite, updateMember, removeMember, inviteLink, listDepartments, setDepartment, listUsers, fetchDept } from '../account.js';
import { PRODUCT } from '../config.js';
import { $, toast, badge, empty, confirm } from '../ui.js';
import { mfaGate } from './feedback.js';

const fmtDT = d => d ? new Date(d).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const onRoute = r => (location.hash.replace(/^#\/?/, '').split('/')[0] || 'dashboard') === r;
const roleOpts = v => Object.entries(MEMBER_ROLES).map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('');
const crewOpts = v => `<option value="">Not linked</option>${(S?.crew || []).filter(c => c.status !== 'inactive').map(c => `<option value="${esc(c.id)}" ${c.id === v ? 'selected' : ''}>${esc(c.name)} — ${esc(c.group)}</option>`).join('')}`;
const crewName = id => S?.crew.find(c => c.id === id)?.name || '';
export const canManageMembers = () => ctx.mode === 'dept' && (ctx.role === 'dept_admin' || isAdmin());

const CLASS_HELP = `<ul class="class-help">
  <li><strong>Department admin</strong> — invite and remove members, assign classes, full setup and scheduling.</li>
  <li><strong>Scheduler</strong> — setup, schedules, trips, time-off and bid approvals.</li>
  <li><strong>Management</strong> — scheduler rights plus exception approval.</li>
  <li><strong>Accounting</strong> — trip records, billing and invoices.</li>
  <li><strong>Crew member</strong> — own schedule, time-off requests, bids and swaps. Link each crew member to their crew profile.</li></ul>`;

// ---------------------------------------------------------------- Members (department admin)
export async function renderMembers(el) {
  if (!onRoute('members')) return;
  if (!canManageMembers()) { el.innerHTML = empty('Only department admins can manage members.'); return; }
  const id = ctx.deptId;
  el.innerHTML = `<div class="page-head"><div><h1>Members</h1><p>People who can sign in to ${esc(S.dept.name)}. Invite someone by email, choose their user class, and send them the link.</p></div><div class="actions"><button class="btn ghost" data-a="reload">Refresh</button></div></div>
    <div class="grid g2" style="align-items:start">
      <form class="card" id="invF"><h2>Invite someone</h2>
        <label class="field"><span>Email</span><input name="email" type="email" required maxlength="254" autocomplete="off"></label>
        <label class="field"><span>User class</span><select name="role">${roleOpts('crew')}</select></label>
        <label class="field"><span>Crew profile</span><select name="crew">${crewOpts('')}</select><small>Required for crew members so they see their own schedule. Optional for others who also fly.</small></label>
        <button class="btn primary" type="submit">Create invite link</button>
        <div id="invOut"></div></form>
      <div class="card"><h2>User classes</h2>${CLASS_HELP}</div>
    </div>
    <div id="memL"><p class="muted">Loading…</p></div>`;
  let members, invites;
  try { [members, invites] = await Promise.all([deptMembers(id), deptInvites(id)]); }
  catch (e) { if (onRoute('members')) $('#memL', el).innerHTML = `<div class="alert bad">${esc(friendly(e))}</div>`; return; }
  if (!onRoute('members')) return;
  $('#memL', el).innerHTML = `<div class="card"><h2>Members (${members.length})</h2><div class="tbl-wrap"><table><thead><tr><th>Name</th><th>User class</th><th>Crew profile</th><th></th></tr></thead><tbody>
    ${members.map(m => `<tr data-u="${m.user_id}"><td><strong>${esc(m.display_name || m.email)}</strong>${m.user_id === acct.user.id ? ' <span class="muted">(you)</span>' : ''}<br><small class="muted">${esc(m.email)}</small></td>
      <td><select data-role aria-label="User class for ${esc(m.email)}">${roleOpts(m.role)}</select></td>
      <td><select data-crew aria-label="Crew profile for ${esc(m.email)}">${crewOpts(m.crew_id)}</select>${m.crew_id && !crewName(m.crew_id) ? '<br><small class="muted">Linked profile no longer exists</small>' : ''}</td>
      <td class="row" style="flex-wrap:nowrap"><button class="btn sm primary" data-save>Save</button><button class="btn sm ghost" data-remove>${m.user_id === acct.user.id ? 'Leave' : 'Remove'}</button></td></tr>`).join('')}</tbody></table></div></div>
    <div class="card"><h2>Pending invites (${invites.length})</h2>${invites.length ? `<div class="tbl-wrap"><table><thead><tr><th>Email</th><th>User class</th><th>Crew profile</th><th>Expires</th><th></th></tr></thead><tbody>
    ${invites.map(i => `<tr data-i="${i.id}" data-email="${esc(i.email)}" data-role="${i.role}" data-crew="${esc(i.crew_id || '')}"><td>${esc(i.email)}</td><td>${esc(MEMBER_ROLES[i.role])}</td><td>${esc(crewName(i.crew_id) || '—')}</td><td><small>${esc(fmtDT(i.expires_at))}</small></td><td class="row" style="flex-wrap:nowrap"><button class="btn sm" data-resend>New link</button><button class="btn sm ghost" data-revoke>Revoke</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No pending invites.</p>'}<p class="muted">Invite links work once and expire after 14 days. For security, a link can't be shown again — create a new link if it was lost.</p></div>`;

  const showLink = (email, token) => {
    const link = inviteLink(token);
    const subj = encodeURIComponent(`You're invited to ${S.dept.name} on ${PRODUCT}`);
    const body = encodeURIComponent(`You've been invited to join ${S.dept.name} on ${PRODUCT}.\n\nOpen this link to create your account (use ${email}) and join:\n${link}\n\nThe link works once and expires in 14 days.`);
    $('#invOut', el).innerHTML = `<div class="alert ok" style="margin-top:12px"><p><strong>Invite ready for ${esc(email)}.</strong> Send them this link:</p><input class="secret" style="width:100%" readonly value="${esc(link)}" aria-label="Invite link"><div class="row" style="margin-top:8px"><button type="button" class="btn sm primary" data-copy>Copy link</button><a class="btn sm" href="mailto:${encodeURIComponent(email)}?subject=${subj}&body=${body}">Email it</a></div></div>`;
    $('[data-copy]', el).onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Invite link copied'); } catch { $('#invOut input', el).select(); toast('Select the link and copy it', 'bad'); } };
  };
  $('#invF', el).onsubmit = async e => {
    e.preventDefault(); const f = e.target; const b = f.querySelector('button[type=submit]'); b.disabled = true;
    try { const email = f.email.value.trim(); const tok = await inviteMember(id, email, f.role.value, f.crew.value); f.reset(); f.role.value = 'crew'; showLink(email, tok); toast('Invite created'); renderInviteListOnly(); }
    catch (ex) { toast(friendly(ex), 'bad'); } finally { b.disabled = false; }
  };
  const renderInviteListOnly = async () => { const out = $('#invOut', el)?.innerHTML; await renderMembers(el); if (out && $('#invOut', el)) { $('#invOut', el).innerHTML = out; const link = $('#invOut input', el)?.value; const c = $('[data-copy]', el); if (c && link) c.onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Invite link copied'); } catch { toast('Select the link and copy it', 'bad'); } }; } };
  $('#memL', el).onclick = async e => {
    const row = e.target.closest('tr');
    if (e.target.closest('[data-save]')) {
      try { await updateMember(id, row.dataset.u, $('[data-role]', row).value, $('[data-crew]', row).value); toast('Member updated'); renderMembers(el); } catch (ex) { toast(friendly(ex), 'bad'); }
    } else if (e.target.closest('[data-remove]')) {
      const self = row.dataset.u === acct.user.id;
      if (!await confirm(self ? 'Leave department' : 'Remove member', self ? `Leave ${S.dept.name}? You will lose access until someone invites you again.` : 'Remove this person from the department? They lose access immediately. Their crew profile stays.', self ? 'Leave' : 'Remove', 'danger')) return;
      try { await removeMember(id, row.dataset.u); toast(self ? 'You left the department' : 'Member removed'); if (self) { session.role = null; location.hash = ''; location.reload(); } else renderMembers(el); } catch (ex) { toast(friendly(ex), 'bad'); }
    } else if (e.target.closest('[data-revoke]')) {
      try { await revokeInvite(row.dataset.i); toast('Invite revoked'); renderMembers(el); } catch (ex) { toast(friendly(ex), 'bad'); }
    } else if (e.target.closest('[data-resend]')) {
      try { const tok = await inviteMember(id, row.dataset.email, row.dataset.role, row.dataset.crew); await renderMembers(el); showLink(row.dataset.email, tok); } catch (ex) { toast(friendly(ex), 'bad'); }
    }
  };
  el.onclick = e => { if (e.target.closest('[data-a="reload"]')) renderMembers(el); };
}

// ---------------------------------------------------------------- Super admin: support view
async function openSupport(id, label) {
  const d = await fetchDept(id);
  setState(d.state); Object.assign(ctx, { mode: 'support', deptId: d.id, version: d.version, role: 'dept_admin', crewId: null, name: d.name, supportOf: label || d.name });
  session.role = 'admin'; session.userId = null; save();
  toast(`Support view: ${d.name}`); location.hash = '#/dashboard';
}

// ---------------------------------------------------------------- Super admin: departments
export async function renderDepartments(el) {
  if (!onRoute('departments')) return;
  if (!signedIn() || !acct.listedAdmin) { el.innerHTML = empty('Super admin only.'); return; }
  if (!isAdmin()) return mfaGate(el, () => renderDepartments(el));
  el.innerHTML = `<div class="page-head"><div><h1>Departments</h1><p>Every department on ${PRODUCT}. Open a read-only support view, suspend access, or set the plan.</p></div><div class="actions"><button class="btn ghost" data-a="reload">Refresh</button></div></div><div id="dl"><p class="muted">Loading…</p></div>`;
  let list; try { list = await listDepartments(); } catch (e) { if (onRoute('departments')) $('#dl', el).innerHTML = `<div class="alert bad">${esc(friendly(e))}</div>`; return; }
  if (!onRoute('departments')) return;
  const PLANS = { beta: 'Beta', trial: 'Trial', active: 'Paid', comp: 'Complimentary' };
  $('#dl', el).innerHTML = list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Department</th><th>Department admins</th><th>Members</th><th>Crew profiles</th><th>Plan</th><th>Status</th><th>Last change</th><th></th></tr></thead><tbody>
    ${list.map(d => `<tr data-d="${d.id}" data-name="${esc(d.name)}"><td><strong>${esc(d.name)}</strong><br><small class="muted">Created ${esc(fmtDT(d.created_at))}${d.creator ? ' by ' + esc(d.creator) : ''}</small></td><td><small>${esc(d.admins || '—')}</small></td><td>${d.members}</td><td>${d.crew_count}</td>
      <td><select data-plan aria-label="Plan">${Object.entries(PLANS).map(([k, l]) => `<option value="${k}" ${k === d.plan ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td>${d.status === 'active' ? badge('Active', 'ok') : badge('Suspended', 'bad')}</td><td><small>${esc(fmtDT(d.updated_at))}</small></td>
      <td class="row" style="flex-wrap:nowrap"><button class="btn sm" data-open>Support view</button><button class="btn sm ghost" data-status="${d.status === 'active' ? 'suspended' : 'active'}">${d.status === 'active' ? 'Suspend' : 'Reactivate'}</button></td></tr>`).join('')}</tbody></table></div>` : empty('No departments yet.');
  el.onclick = async e => {
    if (e.target.closest('[data-a="reload"]')) return renderDepartments(el);
    const row = e.target.closest('tr[data-d]'); if (!row) return;
    if (e.target.closest('[data-open]')) { try { await openSupport(row.dataset.d, row.dataset.name); } catch (ex) { toast(friendly(ex), 'bad'); } }
    const st = e.target.closest('[data-status]');
    if (st) { const sus = st.dataset.status === 'suspended'; if (sus && !await confirm('Suspend department', `Suspend ${row.dataset.name}? Its members cannot open it until you reactivate it. Nothing is deleted.`, 'Suspend', 'danger')) return; try { await setDepartment(row.dataset.d, st.dataset.status, null); toast(sus ? 'Department suspended' : 'Department reactivated'); renderDepartments(el); } catch (ex) { toast(friendly(ex), 'bad'); } }
  };
  el.onchange = async e => { const p = e.target.closest('[data-plan]'); if (!p) return; const row = p.closest('tr'); try { await setDepartment(row.dataset.d, null, p.value); toast('Plan updated'); } catch (ex) { toast(friendly(ex), 'bad'); } };
}

// ---------------------------------------------------------------- Super admin: users
export async function renderUsers(el) {
  if (!onRoute('users')) return;
  if (!signedIn() || !acct.listedAdmin) { el.innerHTML = empty('Super admin only.'); return; }
  if (!isAdmin()) return mfaGate(el, () => renderUsers(el));
  el.innerHTML = `<div class="page-head"><div><h1>Users</h1><p>Everyone with a ${PRODUCT} account and the departments they belong to.</p></div><div class="actions"><button class="btn ghost" data-a="reload">Refresh</button></div></div><div id="ul"><p class="muted">Loading…</p></div>`;
  let list; try { list = await listUsers(); } catch (e) { if (onRoute('users')) $('#ul', el).innerHTML = `<div class="alert bad">${esc(friendly(e))}</div>`; return; }
  if (!onRoute('users')) return;
  $('#ul', el).innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:10px"><strong>${list.length} account${list.length === 1 ? '' : 's'}</strong><label class="field" style="margin:0;min-width:240px"><span class="sr-only">Search users</span><input type="search" id="uq" placeholder="Search name, email, department"></label></div><div id="ut"></div>`;
  const draw = term => {
    term = (term || '').toLowerCase();
    const shown = list.filter(u => !term || [u.email, u.display_name, u.organization, u.departments].some(v => (v || '').toLowerCase().includes(term)));
    $('#ut', el).innerHTML = shown.length ? `<div class="tbl-wrap"><table><thead><tr><th>User</th><th>Departments (class)</th><th>Feedback</th><th>Joined</th><th>Last sign-in</th></tr></thead><tbody>${shown.map(u => `<tr><td><strong>${esc(u.display_name || '—')}</strong>${u.is_admin ? ' ' + badge('Super admin', 'info') : ''}<br><small class="muted">${esc(u.email)}${u.organization ? ' · ' + esc(u.organization) : ''}</small></td><td><small>${esc((u.departments || '—').replace(/\((dept_admin|scheduler|management|accounting|crew)\)/g, (m, r) => '(' + MEMBER_ROLES[r] + ')'))}</small></td><td>${u.feedback_count ? `<a href="#/inbox/all">${u.feedback_count}</a>${u.open_feedback ? ` <small class="muted">(${u.open_feedback} open)</small>` : ''}` : '0'}</td><td><small>${esc(fmtDT(u.created_at))}</small></td><td><small>${esc(fmtDT(u.last_sign_in_at) || '—')}</small></td></tr>`).join('')}</tbody></table></div>` : empty('No users match.');
  };
  draw('');
  $('#uq', el).oninput = e => draw(e.target.value);
  el.onclick = e => { if (e.target.closest('[data-a="reload"]')) renderUsers(el); };
}
