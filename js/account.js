// Accounts, cloud-saved demo data, product feedback and admin inbox (Supabase).
import { CONFIG } from './config.js';
import { APP_VERSION } from './releases.js';

const sb = window.supabase ? window.supabase.createClient(CONFIG.url, CONFIG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'sc-auth' } }) : null;
export const acct = { ready: false, user: null, profile: null, listedAdmin: false, aal: 'aal1', hasFactor: false, cloud: null, offline: !sb };
const subs = new Set();
export const onAccount = f => subs.add(f);
const emit = () => subs.forEach(f => { try { f(); } catch (e) { console.error(e); } });
export const signedIn = () => !!acct.user;
export const isAdmin = () => acct.listedAdmin && acct.aal === 'aal2';
export const displayName = () => acct.profile?.display_name || acct.user?.email || '';

export function friendly(e) {
  const m = (e && (e.message || e.error_description || e.error)) || String(e);
  if (/invalid login credentials/i.test(m)) return 'Email or password is incorrect.';
  if (/not authorized|permission denied|42501/i.test(m)) return 'You do not have permission for that action.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Could not reach the server. Check your connection and try again.';
  return m.replace(/^.*?ERROR:\s*/, '');
}

async function refresh() {
  if (!sb) { acct.ready = true; emit(); return; }
  const { data: { session } } = await sb.auth.getSession();
  acct.user = session?.user || null;
  if (!acct.user) { Object.assign(acct, { profile: null, listedAdmin: false, aal: 'aal1', hasFactor: false, cloud: null, ready: true }); emit(); return; }
  const [{ data: prof }, { data: adm }, { data: aal }, { data: cloud }] = await Promise.all([
    sb.from('profiles').select('*').eq('id', acct.user.id).maybeSingle(),
    sb.rpc('am_admin'),
    sb.auth.mfa.getAuthenticatorAssuranceLevel(),
    sb.from('demo_states').select('department, updated_at').eq('user_id', acct.user.id).maybeSingle(),
  ]);
  acct.profile = prof || null; acct.listedAdmin = !!adm; acct.aal = aal?.currentLevel || 'aal1'; acct.hasFactor = aal?.nextLevel === 'aal2' || acct.aal === 'aal2'; acct.cloud = cloud || null; acct.ready = true;
  emit();
}
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
export async function signOut() { await sb.auth.signOut(); await refresh(); }
export async function updateProfile(p) { const { error } = await sb.from('profiles').update(p).eq('id', acct.user.id); if (error) throw error; await refresh(); }

// ---- cloud-saved demo department
let timer = null, pending = null;
export function queueCloudSave(state) {
  if (!signedIn() || !state) return; pending = state; clearTimeout(timer);
  timer = setTimeout(async () => { const s = pending; pending = null; try { const { error } = await sb.from('demo_states').upsert({ user_id: acct.user.id, state: s, department: s.dept?.name || '' }); if (error) throw error; acct.cloud = { department: s.dept?.name, updated_at: new Date().toISOString() }; } catch (e) { console.warn('Cloud save failed', e); } }, 2500);
}
export async function loadCloud() { const { data, error } = await sb.from('demo_states').select('state').eq('user_id', acct.user.id).maybeSingle(); if (error) throw error; return data?.state || null; }
export async function deleteCloud() { const { error } = await sb.from('demo_states').delete().eq('user_id', acct.user.id); if (error) throw error; acct.cloud = null; }

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
export async function mfaEnroll() {
  const { data: lf } = await sb.auth.mfa.listFactors();
  for (const f of (lf?.all) || []) if (f.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Schedule Captain ' + new Date().toISOString().slice(0, 10) });
  if (error) throw error; return data;
}
export async function mfaVerify(code, factorId) {
  if (!factorId) { const { data: lf } = await sb.auth.mfa.listFactors(); factorId = lf?.totp?.find(f => f.status === 'verified')?.id; }
  if (!factorId) throw new Error('No authenticator is set up yet.');
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
  if (error) throw new Error('That code did not match. Check the time on your phone and try the next code.');
  await refresh();
}
