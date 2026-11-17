// Accounts, cloud-saved demo data, product feedback and admin inbox (Supabase).
import { CONFIG } from './config.js';
import { APP_VERSION } from './releases.js';

const sb = window.supabase ? window.supabase.createClient(CONFIG.url, CONFIG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'sc-auth' } }) : null;
export const acct = { ready: false, user: null, profile: null, listedAdmin: false, aal: 'aal1', hasFactor: false, depts: [], offline: !sb };
// What the open workspace is: a shared department, a super-admin sample sandbox, or a read-only support view.
export const ctx = { mode: null, deptId: null, version: 0, role: null, crewId: null, name: '', supportOf: null };
export const MEMBER_ROLES = { dept_admin: 'Department admin', scheduler: 'Scheduler', management: 'Management', accounting: 'Accounting', crew: 'Crew member' };
export const APP_ROLE = { dept_admin: 'admin', scheduler: 'admin', management: 'management', accounting: 'accounting', crew: 'crew' };
const subs = new Set();
export const onAccount = f => subs.add(f);
const emit = () => subs.forEach(f => { try { f(); } catch (e) { console.error(e); } });
export const signedIn = () => !!acct.user;
export const isAdmin = () => acct.listedAdmin && acct.aal === 'aal2';
export const displayName = () => acct.profile?.display_name || acct.user?.email || '';

export function friendly(e) {
  const m = (e && (e.message || e.error_description || e.error)) || String(e);
  if (/invalid login credentials/i.test(m)) return 'Email or password is incorrect.';
  if (/conflict/i.test(m)) return 'Someone else saved changes at the same time.';
  if (/not authorized|permission denied|42501/i.test(m)) return 'You do not have permission for that action.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Could not reach the server. Check your connection and try again.';
  return m.replace(/^.*?ERROR:\s*/, '');
}

async function refresh() {
  if (!sb) { acct.ready = true; emit(); return; }
  const { data: { session } } = await sb.auth.getSession();
  acct.user = session?.user || null;
  if (!acct.user) { lastSig = ''; Object.assign(acct, { profile: null, listedAdmin: false, aal: 'aal1', hasFactor: false, depts: [], ready: true }); emit(); return; }
  const [{ data: prof }, { data: adm }, { data: aal }, { data: depts }] = await Promise.all([
    sb.from('profiles').select('*').eq('id', acct.user.id).maybeSingle(),
    sb.rpc('am_admin'),
    sb.auth.mfa.getAuthenticatorAssuranceLevel(),
    sb.rpc('my_departments'),
  ]);
  acct.profile = prof || null; acct.listedAdmin = !!adm; acct.aal = aal?.currentLevel || 'aal1'; acct.hasFactor = aal?.nextLevel === 'aal2' || acct.aal === 'aal2'; acct.depts = depts || []; acct.ready = true;
  // Only redraw when something actually changed (session refreshes on returning to the tab are common).
  const sig = JSON.stringify([acct.user.id, acct.profile, acct.listedAdmin, acct.aal, acct.hasFactor, acct.depts.map(d => [d.id, d.name, d.role, d.status, d.crew_id, d.members])]);
  if (sig === lastSig) return; lastSig = sig;
  emit();
}
let lastSig = '';
export async function initAccount() {
  if (!sb) { acct.ready = true; return; }
  sb.auth.onAuthStateChange((ev) => { if (['SIGNED_IN', 'SIGNED_OUT', 'MFA_CHALLENGE_VERIFIED', 'USER_UPDATED'].includes(ev)) setTimeout(refresh, 0); });
  try { await refresh(); } catch (e) { console.warn(e); acct.ready = true; }
}

export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error; await refresh();
}
export async function signUp({ email, password, display_name, organization }) {
  const r = await fetch(CONFIG.url + '/functions/v1/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CONFIG.key }, body: JSON.stringify({ email, password, display_name, organization }) });
  const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.error || 'Could not create the account.'); e.code = j.code; throw e; }
  await signIn(email, password);
}
export async function signOut() { await flushDept(); await sb.auth.signOut(); await refresh(); }
export async function updateProfile(p) { const { error } = await sb.from('profiles').update(p).eq('id', acct.user.id); if (error) throw error; await refresh(); }

// ---- shared departments
export const refreshAccount = () => refresh();
export async function fetchDept(id) { const { data, error } = await sb.from('departments').select('id, name, state, version, status').eq('id', id).maybeSingle(); if (error) throw error; if (!data) throw new Error('That department is not available.'); return data; }
export async function createDept(name, state) { const { data, error } = await sb.rpc('create_department', { p_name: name, p_state: state }); if (error) throw error; await refresh(); return data; }
let timer = null, pending = null, saving = null, conflictCb = null;
export const onDeptConflict = f => { conflictCb = f; };
export const hasPendingSave = () => !!pending || !!saving;
async function pushDept() {
  if (!pending || ctx.mode !== 'dept') return; const s = pending; pending = null;
  saving = (async () => {
    const { data, error } = await sb.rpc('save_department', { p_id: ctx.deptId, p_state: s, p_version: ctx.version });
    if (error) { if (/conflict/i.test(error.message)) conflictCb?.(); else { console.warn('Save failed', error); if (!pending) pending = s; saveErrCb?.(error); } return; }
    ctx.version = data;
  })();
  try { await saving; } finally { saving = null; }
}
let saveErrCb = null;
export const onDeptSaveError = cb => { saveErrCb = cb; };
export function queueDeptSave(state) { if (ctx.mode !== 'dept' || !state) return; pending = state; clearTimeout(timer); timer = setTimeout(pushDept, 700); }
export async function flushDept() { clearTimeout(timer); if (saving) await saving; await pushDept(); }
export async function deptVersion() { const { data, error } = await sb.rpc('dept_version', { p_id: ctx.deptId }); if (error) throw error; return data?.[0] || null; }
export async function deptMembers(id) { const { data, error } = await sb.rpc('dept_members', { p_dept: id }); if (error) throw error; return data || []; }
export async function deptInvites(id) { const { data, error } = await sb.from('department_invites').select('id, email, role, crew_id, created_at, expires_at').eq('department_id', id).is('accepted_at', null).order('created_at', { ascending: false }); if (error) throw error; return data || []; }
export async function inviteMember(id, email, role, crewId) { const { data, error } = await sb.rpc('invite_member', { p_dept: id, p_email: email, p_role: role, p_crew_id: crewId || '' }); if (error) throw error; return data; }
export async function revokeInvite(inviteId) { const { error } = await sb.rpc('revoke_invite', { p_id: inviteId }); if (error) throw error; }
export async function updateMember(id, userId, role, crewId) { const { error } = await sb.rpc('update_member', { p_dept: id, p_user: userId, p_role: role, p_crew_id: crewId || '' }); if (error) throw error; }
export async function removeMember(id, userId) { const { error } = await sb.rpc('remove_member', { p_dept: id, p_user: userId }); if (error) throw error; if (userId === acct.user.id) await refresh(); }
export async function inviteInfo(token) { const { data, error } = await sb.rpc('invite_info', { p_token: token }); if (error) throw error; return data?.[0] || null; }
export async function acceptInvite(token) { const { data, error } = await sb.rpc('accept_invite', { p_token: token }); if (error) throw error; await refresh(); return data; }
export const inviteLink = token => `${location.origin}${location.pathname}#/join/${token}`;

export async function changePassword(pw) { const { error } = await sb.auth.updateUser({ password: pw }); if (error) throw error; }

// ---- admin support
export async function listUsers() { const { data, error } = await sb.rpc('admin_list_users'); if (error) throw error; return data || []; }
export async function listDepartments() { const { data, error } = await sb.rpc('admin_list_departments'); if (error) throw error; return data || []; }
export async function setDepartment(id, status, plan) { const { error } = await sb.rpc('admin_set_department', { p_id: id, p_status: status || null, p_plan: plan || null }); if (error) throw error; }

// ---- product feedback
export async function sendFeedback({ kind, message, page, context }) {
  const { error } = await sb.from('feedback').insert({ kind, message, page, app_version: APP_VERSION, context });
  if (error) throw error;
}
export async function myFeedback() { const { data, error } = await sb.from('feedback').select('*').eq('user_id', acct.user.id).order('created_at', { ascending: false }); if (error) throw error; return data; }
export async function allFeedback() { const { data, error } = await sb.from('feedback').select('*, profiles(email, display_name, organization)').order('created_at', { ascending: false }).limit(500); if (error) throw error; return data; }
export async function updateFeedback(id, status, reply) { const { data, error } = await sb.rpc('admin_update_feedback', { p_id: id, p_status: status, p_reply: reply }); if (error) throw error; return data; }
export async function claimAdmin(code) { const { error } = await sb.rpc('claim_admin', { p_code: code }); if (error) throw error; await refresh(); }

// ---- two-factor for admins
// A pending (not yet verified) authenticator setup is kept in this browser, so leaving the page to open an
// authenticator app — or the page redrawing when the session refreshes — never replaces the key.
const MFA_KEY = 'sc-mfa-pending';
export function mfaPending() {
  try { const p = JSON.parse(localStorage.getItem(MFA_KEY) || 'null'); if (p && p.user === acct.user?.id && Date.now() - p.at < 24 * 3600e3) return p; } catch { /* ignore */ }
  return null;
}
export function mfaClearPending() { localStorage.removeItem(MFA_KEY); }
export async function mfaEnroll({ fresh = false } = {}) {
  const { data: lf } = await sb.auth.mfa.listFactors();
  const unverified = ((lf?.all) || []).filter(f => f.status !== 'verified');
  const keep = !fresh && mfaPending();
  if (keep && unverified.some(f => f.id === keep.id)) return keep;
  for (const f of unverified) await sb.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Schedule Captain ' + new Date().toISOString().slice(0, 19).replace('T', ' ') });
  if (error) throw error;
  const p = { user: acct.user.id, id: data.id, secret: data.totp.secret, qr: data.totp.qr_code, uri: data.totp.uri, at: Date.now() };
  localStorage.setItem(MFA_KEY, JSON.stringify(p)); return p;
}
export async function mfaVerify(code, factorId) {
  if (!factorId) { const { data: lf } = await sb.auth.mfa.listFactors(); factorId = lf?.totp?.find(f => f.status === 'verified')?.id; }
  if (!factorId) throw new Error('No authenticator is set up yet.');
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
  if (error) throw new Error('That code did not match. Check the time on your phone and try the next code.');
  mfaClearPending(); await refresh();
}
