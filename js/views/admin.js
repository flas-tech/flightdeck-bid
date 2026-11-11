import { esc, D, uid, clone, parseCsv, download, csv } from '../util.js';
import { S, session, can, save, audit, exception, TODAY, setState, resetAll, catByCode, crewName, types } from '../store.js';
import { PARAMS, BASELINES, makeRuleSet, relaxations, citeFor } from '../rules.js';
import { generateRoster, METHODS } from '../engine.js';
import { $, $$, modal, toast, justify, confirm, sel, tabs, empty, badge, formData } from '../ui.js';
import { relaxBanner, unresolvedBanner } from './common.js';

const TABS = [['dept', 'Department'], ['rules', 'Duty / rest rules'], ['aircraft', 'Aircraft'], ['crew', 'Crew'], ['categories', 'Time-off categories'], ['coverage', 'Groups & coverage'], ['bidding', 'Bidding & fairness'], ['policies', 'Policies'], ['data', 'Data']];
const WIZ = ['dept', 'aircraft', 'crew', 'categories', 'coverage', 'bidding'];
const ui = { step: 0 };

const get = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
const set = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); const t = ks.reduce((x, k) => (x[k] ||= {}), o); t[last] = v; };
const valOf = i => i.type === 'checkbox' ? i.checked : i.type === 'number' ? (i.value === '' ? null : Number(i.value)) : i.value;
// Generic dept input: data-k="path"
const dIn = (path, label, type = 'text', attrs = '', hint = '') => { const v = get(S.dept, path); return type === 'checkbox' ? `<label class="check"><input type="checkbox" data-k="${path}" ${v ? 'checked' : ''} ${attrs}> ${label}</label>` : `<label class="field"><span>${label}</span><input type="${type}" data-k="${path}" value="${esc(v ?? '')}" ${attrs}>${hint ? `<small>${esc(hint)}</small>` : ''}</label>`; };
const dSel = (path, label, opts, hint = '') => `<label class="field"><span>${label}</span>${sel('', opts, get(S.dept, path), `data-k="${path}"`)}${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
function bindDept(box) {
  box.addEventListener('change', async e => {
    const i = e.target.closest('[data-k]'); if (!i) return; const path = i.dataset.k; const old = get(S.dept, path); const v = valOf(i);
    if (path === 'modules.trips' && !v && S.trips.length && !(await confirm('Turn off trip scheduling', `The department has ${S.trips.length} trip(s). They are kept but hidden, and crew availability continues on its own. You can turn the module back on at any time.`, 'Turn off'))) { i.checked = true; return; }
    if (path === 'mode' && S.trips.length && !(await confirm('Change operating mode', 'Changing the operating mode changes which duty/rest rule set applies to existing trips. Review compliance afterwards.', 'Change mode'))) { i.value = old; return; }
    set(S.dept, path, v); audit('Setting changed', `${path}: ${JSON.stringify(old)} → ${JSON.stringify(v)}`); save();
  });
}

export function render(el, param = 'dept') {
  if (!can('configure')) { el.innerHTML = empty('Setup is available to schedulers and management.'); return; }
  if (param === 'setup') return wizard(el);
  const tab = TABS.some(t => t[0] === param) ? param : 'dept';
  el.innerHTML = `<div class="page-head"><div><h1>Setup & rules</h1><p>Each department configures its own operation. Every change is audited; rule parameters are versioned.</p></div><div class="actions"><a class="btn ghost" href="#/admin/setup">Setup wizard</a></div></div>${relaxBanner()}${tabs(TABS, tab)}<div id="ab"></div>`;
  $$('[data-tab]', el).forEach(b => b.onclick = () => { location.hash = `#/admin/${b.dataset.tab}`; });
  SECTIONS[tab]($('#ab', el));
}

function wizard(el) {
  const k = WIZ[ui.step]; const label = TABS.find(t => t[0] === k)[1];
  el.innerHTML = `<div class="page-head"><div><h1>Department setup</h1><p>Step ${ui.step + 1} of ${WIZ.length}: ${esc(label)}. You can change anything later under Setup & rules.</p></div></div>
  <div class="row" style="margin-bottom:12px">${WIZ.map((w, i) => `<span class="badge ${i === ui.step ? 'info' : i < ui.step ? 'ok' : 'muted'}">${i + 1}. ${esc(TABS.find(t => t[0] === w)[1])}</span>`).join('')}</div>
  <div id="ab"></div><div class="row" style="margin-top:16px"><button class="btn" data-w="back" ${ui.step ? '' : 'disabled'}>Back</button>${ui.step < WIZ.length - 1 ? '<button class="btn primary" data-w="next">Next</button>' : '<button class="btn primary" data-w="finish">Finish and generate roster</button>'}</div>`;
  SECTIONS[k]($('#ab', el));
  $$('[data-w]', el).forEach(b => b.onclick = () => {
    const w = b.dataset.w;
    if (w === 'back') { ui.step--; wizard(el); } if (w === 'next') { ui.step++; wizard(el); window.scrollTo(0, 0); }
    if (w === 'finish') {
      if (!S.crew.length) return toast('Add at least one crew member first.', 'bad');
      S.dept.setupComplete = true; generateRoster(); audit('Setup completed', `${S.crew.length} crew, ${S.aircraft.length} aircraft`); ui.step = 0; save(); location.hash = '#/schedule'; toast('Setup complete — roster generated');
    }
  });
}

// ---------------------------------------------------------------- sections
const SECTIONS = {
  dept(box) {
    box.innerHTML = `${unresolvedBanner()}<div class="card"><h2>Department</h2><div class="form-grid">${dIn('name', 'Department name')}${dSel('mode', 'Operating mode', [['91', 'Part 91 only'], ['135', 'Part 135 only'], ['mixed', 'Mixed — per aircraft / per trip']])}${dIn('horizonDays', 'Scheduling horizon (days)', 'number', 'min="14" max="120"')}${dIn('lockDays', 'Lock window (days)', 'number', 'min="1" max="60"')}</div>
      <h3>Modules</h3><p class="muted">Crew availability is always on. Trip scheduling adds trips, passengers, lock-time crew matching, disruptions and accounting.</p>${dIn('modules.trips', 'Trip scheduling module enabled', 'checkbox')}
      <h3>Default duty/rest rule set</h3><div class="form-grid">${dSel('defaultRuleSet.91', 'Part 91 trips', S.ruleSets.map(r => [r.id, r.name]))}${dSel('defaultRuleSet.135', 'Part 135 trips', S.ruleSets.map(r => [r.id, r.name]))}</div><small class="muted">Aircraft and individual trips can override this.</small></div>`;
    bindDept(box);
  },
  rules(box) {
    box.innerHTML = `<div class="alert info">Baselines are transcribed from <a href="https://www.ecfr.gov/current/title-14/chapter-I/subchapter-G/part-135/subpart-F" target="_blank" rel="noopener">14 CFR Part 135 Subpart F</a> (135.265 scheduled, 135.267 unscheduled). Part 91 has no crew duty limits encoded — that rule set is department policy. These encodings are demonstrations, not validated and not legal advice. Making a value less stringent than the regulatory baseline requires a justification, raises a management exception and keeps a persistent warning.</div>
      ${S.ruleSets.map(rs => { const rel = relaxations(rs).map(r => r.key); const B = BASELINES[rs.basis];
        return `<div class="card flush" data-rs="${rs.id}"><div class="card-head" style="padding:14px 16px 0"><div><h2 style="margin:0"><input data-rn value="${esc(rs.name)}" style="font-weight:700;width:min(620px,100%)" aria-label="Rule set name"></h2><small class="muted">Basis ${esc(rs.basis)} · version ${rs.version} · updated ${esc(new Date(rs.updatedAt).toLocaleString())} by ${esc(rs.updatedBy)}</small></div><div class="row"><button class="btn sm" data-h="${rs.id}">History (${rs.history.length})</button><button class="btn sm ghost" data-reset="${rs.id}">Restore baseline</button></div></div>
        <div class="tbl-wrap"><table><thead><tr><th>Parameter</th><th>Regulatory</th><th>Value</th><th>Basis</th></tr></thead><tbody>${PARAMS.map(p => { const reg = B.reg[p.key]; return `<tr${rel.includes(p.key) ? ' style="background:var(--bad-bg)"' : ''}><td>${esc(p.label)}</td><td>${reg != null ? `${reg} ${p.unit === 'flag' ? '' : esc(p.unit)}` : '<span class="muted">—</span>'}</td><td><input type="number" step="any" data-p="${p.key}" value="${rs.params[p.key] ?? ''}" placeholder="off" style="width:100px" aria-label="${esc(p.label)}"> <small>${p.unit === 'flag' ? '' : esc(p.unit)}</small></td><td><small>${esc(citeFor(rs, p.key))}</small></td></tr>`; }).join('')}</tbody></table></div></div>`; }).join('')}
      <div class="card"><h2>Add rule set</h2><div class="row"><select id="nb" style="width:auto" aria-label="Basis">${Object.entries(BASELINES).map(([k, b]) => `<option value="${k}">${esc(b.name)}</option>`).join('')}</select><button class="btn" data-a="addrs">Add</button></div><small class="muted">Use additional rule sets for stricter company limits on specific aircraft or trips.</small></div>`;
    box.onchange = async e => {
      const card = e.target.closest('[data-rs]'); if (!card) return; const rs = S.ruleSets.find(r => r.id === card.dataset.rs);
      if (e.target.dataset.rn != null) { rs.name = e.target.value; audit('Rule set renamed', rs.name); save(); return; }
      const key = e.target.dataset.p; if (!key) return; const p = PARAMS.find(x => x.key === key); const old = rs.params[key]; const v = e.target.value === '' ? null : Number(e.target.value);
      const trial = { ...rs, params: { ...rs.params, [key]: v } }; const relaxed = relaxations(trial).some(r => r.key === key) && !relaxations(rs).some(r => r.key === key);
      let why = '';
      if (relaxed) { why = await justify('Less stringent than regulation', `${p.label}: regulatory ${BASELINES[rs.basis].reg[key]} (${citeFor(rs, key)}); new value ${v ?? 'disabled'}. This raises a management exception and a persistent warning.`); if (!why) { e.target.value = old ?? ''; return; } }
      rs.history.unshift({ version: rs.version, at: rs.updatedAt, by: rs.updatedBy, key, from: old, to: v, justification: why });
      rs.params[key] = v; rs.version++; rs.updatedAt = new Date().toISOString(); rs.updatedBy = session.role === 'management' ? 'Management (demo)' : 'Scheduler (demo)';
      audit('Rule parameter changed', `${rs.name} v${rs.version}: ${p.label} ${old ?? 'off'} → ${v ?? 'off'}`, null, why);
      if (relaxed) exception('rule-relaxation', `${rs.name}: ${p.label} ${v ?? 'disabled'} (regulatory ${BASELINES[rs.basis].reg[key]})`, why, rs.id);
      save();
    };
    box.onclick = async e => {
      const h = e.target.closest('[data-h]'); const r = e.target.closest('[data-reset]');
      if (h) { const rs = S.ruleSets.find(x => x.id === h.dataset.h); modal(`${rs.name} — version history`, rs.history.length ? `<table><thead><tr><th>Ver</th><th>When</th><th>By</th><th>Change</th><th>Justification</th></tr></thead><tbody>${rs.history.map(x => `<tr><td>${x.version + 1}</td><td>${esc(new Date(x.at).toLocaleString())}</td><td>${esc(x.by)}</td><td>${esc(PARAMS.find(p => p.key === x.key)?.label || x.key)}: ${esc(x.from ?? 'off')} → ${esc(x.to ?? 'off')}</td><td>${esc(x.justification)}</td></tr>`).join('')}</tbody></table>` : '<p>No changes yet (version 1).</p>', { wide: true }); }
      if (r) { const rs = S.ruleSets.find(x => x.id === r.dataset.reset); if (!(await confirm('Restore baseline', `Restore all parameters of ${esc(rs.name)} to the ${esc(rs.basis)} baseline?`, 'Restore'))) return; const fresh = makeRuleSet(rs.id, rs.basis, rs.name); rs.history.unshift({ version: rs.version, at: rs.updatedAt, by: rs.updatedBy, key: 'all', from: 'custom', to: 'baseline', justification: 'Restored baseline' }); rs.params = fresh.params; rs.version++; rs.updatedAt = new Date().toISOString(); audit('Rule set restored to baseline', rs.name); save(); }
      if (e.target.closest('[data-a="addrs"]')) { const basis = $('#nb', box).value; const rs = makeRuleSet(uid('rs'), basis, `${BASELINES[basis].name} — company`); S.ruleSets.push(rs); audit('Rule set added', rs.name); save(); }
    };
  },
  aircraft(box) {
    const f = (a, k, type = 'text', w = 90) => `<input data-f="${k}" type="${type}" value="${esc(a[k] ?? '')}" style="width:${w}px" aria-label="${k}">`;
    box.innerHTML = `<div class="card flush"><div class="tbl-wrap"><table><thead><tr><th>Tail</th><th>Type</th><th>Part</th><th>Min crew</th><th>Seats</th><th>Base</th><th>Status</th><th>Rule set</th><th>Downtime</th><th></th></tr></thead><tbody>${S.aircraft.map(a => `<tr data-ac="${a.id}"><td>${f(a, 'tail')}</td><td>${f(a, 'type', 'text', 80)}</td><td>${sel('', [['91', '91'], ['135', '135']], a.part, 'data-f="part" style="width:70px"')}</td><td>${f(a, 'minCrew', 'number', 60)}</td><td>${f(a, 'seats', 'number', 60)}</td><td>${f(a, 'base', 'text', 70)}</td><td>${sel('', [['active', 'Active'], ['mx', 'In maintenance'], ['inactive', 'Inactive']], a.status, 'data-f="status" style="width:auto"')}</td><td>${sel('', [['', 'Default'], ...S.ruleSets.map(r => [r.id, r.name.slice(0, 32)])], a.ruleSetId || '', 'data-f="ruleSetId" style="width:150px"')}</td><td><button class="btn sm" data-dt="${a.id}">${(a.downtime || []).length} period(s)</button></td><td><button class="btn sm ghost" data-del="${a.id}" aria-label="Remove ${esc(a.tail)}">✕</button></td></tr>`).join('') || '<tr><td colspan="10" class="muted">No aircraft yet.</td></tr>'}</tbody></table></div></div>
    <div class="row" style="margin-top:10px"><button class="btn primary" data-a="add">Add aircraft</button></div><p class="muted">Pilots qualify by type and seat (for example G280 PIC and G550 SIC). Types are taken from the aircraft list: ${esc(types().join(', ') || 'none')}.</p>`;
    box.onchange = e => { const tr = e.target.closest('[data-ac]'); const k = e.target.dataset.f; if (!tr || !k) return; const a = S.aircraft.find(x => x.id === tr.dataset.ac); const old = a[k]; a[k] = k === 'ruleSetId' ? e.target.value || null : valOf(e.target); if (k === 'tail' || k === 'type') a[k] = String(a[k]).toUpperCase(); audit('Aircraft edited', `${a.tail} ${k}: ${old} → ${a[k]}`); save(); };
    box.onclick = async e => {
      if (e.target.closest('[data-a="add"]')) { S.aircraft.push({ id: uid('a'), tail: `N${100 + S.aircraft.length}NEW`, type: types()[0] || 'TYPE', part: S.dept.mode === '135' ? '135' : '91', minCrew: 2, seats: 8, base: '', status: 'active', notes: '', ruleSetId: null, downtime: [] }); audit('Aircraft added'); save(); }
      const del = e.target.closest('[data-del]'); if (del) { const a = S.aircraft.find(x => x.id === del.dataset.del); const used = S.trips.filter(t => t.tail === a.id).length; if (!(await confirm('Remove aircraft', `Remove ${esc(a.tail)}?${used ? ` ${used} trip(s) reference it and will become unassigned.` : ''}`, 'Remove', 'danger'))) return; S.trips.forEach(t => { if (t.tail === a.id) t.tail = ''; }); S.aircraft = S.aircraft.filter(x => x !== a); audit('Aircraft removed', a.tail); save(); }
      const dt = e.target.closest('[data-dt]'); if (dt) downtime(S.aircraft.find(x => x.id === dt.dataset.dt));
    };
  },
  crew(box) {
    box.innerHTML = `<div class="card flush"><div class="tbl-wrap"><table><thead><tr><th>#</th><th>Name</th><th>Group</th><th>Qualifications</th><th>Target days / 30</th><th>Currency</th><th>Status</th><th></th></tr></thead><tbody>${[...S.crew].sort((a, b) => a.seniority - b.seniority).map(c => `<tr><td>${c.seniority}</td><td><strong>${esc(c.name)}</strong> <small>${esc(c.empId)}</small>${c.contract ? ' ' + badge('Contract', 'info') : ''}</td><td>${esc(c.group)}</td><td><small>${esc(c.quals.map(q => `${q.type} ${q.seat}`).join(', ') || '—')}</small></td><td>${c.targetDays}</td><td><small>${(c.currency || []).map(x => `${esc(x.label)} ${esc(D.label(x.expires))}`).join('<br>') || '—'}</small></td><td>${badge(c.status, c.status === 'active' ? 'ok' : 'muted')}</td><td><button class="btn sm" data-e="${c.id}">Edit</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">No crew yet.</td></tr>'}</tbody></table></div></div>
    <div class="row" style="margin-top:10px"><button class="btn primary" data-a="add">Add crew member</button><button class="btn" data-a="import">Bulk import CSV</button><button class="btn ghost" data-a="export">Export CSV</button></div>`;
    box.onclick = e => {
      const ed = e.target.closest('[data-e]'); if (ed) return crewForm(S.crew.find(c => c.id === ed.dataset.e));
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'add') crewForm(null);
      if (a === 'import') bulkImport();
      if (a === 'export') download('crew.csv', csv([['name', 'empId', 'group', 'seniority', 'quals', 'targetDays', 'contract', 'status'], ...S.crew.map(c => [c.name, c.empId, c.group, c.seniority, c.quals.map(q => `${q.type}:${q.seat}`).join(' '), c.targetDays, c.contract ? 'yes' : 'no', c.status])]));
    };
  },
  categories(box) {
    box.innerHTML = `<div class="card flush"><div class="tbl-wrap"><table><thead><tr><th>Code</th><th>Name</th><th>Color</th><th>Unavailable</th><th>Counts toward cap</th><th>Balance</th><th>Approval</th><th>Award priority</th><th>Training</th><th>Meaning confirmed</th><th></th></tr></thead><tbody>${S.categories.map(c => `<tr data-cat="${esc(c.code)}"><td><strong>${esc(c.code)}</strong></td><td><input data-f="name" value="${esc(c.name)}" style="width:190px" aria-label="Name"></td><td><input type="color" data-f="color" value="${esc(c.color)}" aria-label="Color"></td><td><input type="checkbox" data-f="unavailable" ${c.unavailable ? 'checked' : ''} aria-label="Unavailable"></td><td><input type="checkbox" data-f="countsCap" ${c.countsCap ? 'checked' : ''} aria-label="Counts toward cap"></td><td><input type="number" data-f="balance.amount" value="${c.balance.amount}" style="width:60px" aria-label="Amount"> ${sel('', [['none', 'no balance'], ['month', 'per month'], ['year', 'per year']], c.balance.period, 'data-f="balance.period" style="width:auto"')}</td><td><input type="checkbox" data-f="requiresApproval" ${c.requiresApproval ? 'checked' : ''} aria-label="Requires approval"></td><td><input type="number" data-f="priority" value="${c.priority}" min="0" style="width:60px" aria-label="Priority"></td><td><input type="checkbox" data-f="training" ${c.training ? 'checked' : ''} aria-label="Training"></td><td><input type="checkbox" data-f="confirmed" ${c.confirmed ? 'checked' : ''} aria-label="Confirmed"></td><td><button class="btn sm ghost" data-del="${esc(c.code)}" aria-label="Remove ${esc(c.code)}">✕</button></td></tr>`).join('')}</tbody></table></div></div>
    <div class="row" style="margin-top:10px"><input id="nc" placeholder="New code, e.g. PDO" maxlength="5" style="width:150px" aria-label="New category code"><button class="btn" data-a="add">Add category</button></div>
    <p class="muted">Award priority: lower numbers are awarded first when requests compete (for example VAC 1, D/A 2, PWO/O 3). Categories marked “meaning unconfirmed” stay visible as open items until the department confirms them.</p>`;
    box.onchange = e => { const tr = e.target.closest('[data-cat]'); const k = e.target.dataset.f; if (!tr || !k) return; const c = catByCode(tr.dataset.cat); const old = get(c, k); set(c, k, valOf(e.target)); audit('Time-off category edited', `${c.code} ${k}: ${old} → ${get(c, k)}`); save(); };
    box.onclick = async e => {
      if (e.target.closest('[data-a="add"]')) { const code = $('#nc', box).value.trim().toUpperCase(); if (!code || catByCode(code) || ['W', 'SB', S.dept.offCode].includes(code)) return toast('Enter a new unique code.', 'bad'); S.categories.push({ code, name: code, color: '#607080', unavailable: true, countsCap: false, balance: { period: 'year', amount: 0 }, requiresApproval: true, priority: 2, protected: true, training: false, confirmed: true }); audit('Time-off category added', code); save(); }
      const d = e.target.closest('[data-del]'); if (d) { const code = d.dataset.del; const used = S.requests.filter(r => r.code === code).length; if (used) return toast(`${code} is used by ${used} request(s) and cannot be removed.`, 'bad'); if (!(await confirm('Remove category', `Remove ${esc(code)}?`, 'Remove', 'danger'))) return; S.categories = S.categories.filter(c => c.code !== code); audit('Time-off category removed', code); save(); }
    };
  },
  coverage(box) {
    box.innerHTML = `<div class="card"><h2>Coverage model</h2><div class="form-grid">${dSel('coverage.model', 'Model', [['hybrid', 'Hybrid — trips plus utilization buffer'], ['full', 'Full crews per aircraft every day'], ['utilization', 'Utilization percentage'], ['standby', 'Trips only plus standby crews']])}${dIn('coverage.utilizationPct', 'Expected utilization (%)', 'number', 'min="0" max="100"')}${dIn('coverage.bufferPct', 'Hybrid buffer (%)', 'number', 'min="0" max="100"')}${dIn('coverage.standbyCrewsPerType', 'Standby crews per type', 'number', 'min="0"')}</div>${dIn('coverage.picCanFillSic', 'A PIC-qualified pilot may fill an SIC seat on the same type', 'checkbox')}</div>
    <div class="card"><h2>Groups</h2><p class="muted">“Seat” groups (pilots) are matched by aircraft type and seat. “Count” groups (maintenance, dispatch, schedulers, line) need a minimum number on duty each day.</p><table><thead><tr><th>Group</th><th>Kind</th><th>Min on duty</th><th>Members</th><th></th></tr></thead><tbody>${S.dept.groups.map((g, i) => `<tr data-g="${i}"><td><input data-f="name" value="${esc(g.name)}" aria-label="Group name"></td><td>${sel('', [['seat', 'Seat (type/seat matching)'], ['count', 'Count (minimum on duty)']], g.kind, 'data-f="kind" style="width:auto"')}</td><td>${g.kind === 'count' ? `<input type="number" data-f="minOnDuty" value="${g.minOnDuty || 0}" min="0" style="width:70px" aria-label="Min on duty">` : '—'}</td><td>${S.crew.filter(c => c.group === g.name).length}</td><td>${S.crew.some(c => c.group === g.name) ? '' : `<button class="btn sm ghost" data-del="${i}" aria-label="Remove group">✕</button>`}</td></tr>`).join('')}</tbody></table><div class="row" style="margin-top:10px"><input id="ng" placeholder="New group, e.g. Maintenance" style="max-width:240px" aria-label="New group"><button class="btn" data-a="addg">Add group</button></div></div>`;
    bindDept(box);
    box.addEventListener('change', e => { const tr = e.target.closest('[data-g]'); const k = e.target.dataset.f; if (!tr || !k) return; const g = S.dept.groups[Number(tr.dataset.g)]; const old = g[k]; const v = valOf(e.target); if (k === 'name') S.crew.forEach(c => { if (c.group === old) c.group = v; }); g[k] = v; audit('Group edited', `${old} ${k} → ${v}`); save(); });
    box.onclick = e => {
      if (e.target.closest('[data-a="addg"]')) { const n = $('#ng', box).value.trim(); if (!n || S.dept.groups.some(g => g.name === n)) return toast('Enter a new group name.', 'bad'); S.dept.groups.push({ name: n, kind: 'count', minOnDuty: 1 }); audit('Group added', n); save(); }
      const d = e.target.closest('[data-del]'); if (d) { const g = S.dept.groups.splice(Number(d.dataset.del), 1)[0]; audit('Group removed', g.name); save(); }
    };
  },
  bidding(box) {
    box.innerHTML = `<div class="card"><h2>Award method</h2><div class="form-grid">${dSel('bidMethod', 'Method', Object.entries(METHODS))}${dIn('lotterySeed', 'Lottery seed', 'text', '', 'Same seed → same order; publish it for transparency.')}${dIn('rotationIndex', 'Rotation index', 'number', 'min="0"', 'Advance each period so first pick rotates.')}${dIn('bidRounds', 'Rounds (max ranked bids per person)', 'number', 'min="1" max="9"')}</div>${dIn('seniorityTieBreaker', 'Use seniority as tie-breaker', 'checkbox')}${dIn('contractLast', 'Contract crew award after staff', 'checkbox')}</div>
    <div class="card"><h2>Roster fairness weights</h2><p class="muted">Higher weight = the generator tries harder to even out that measure when filling work days.</p><div class="form-grid">${dIn('fairness.target', 'Target work days', 'number', 'step="0.5" min="0"')}${dIn('fairness.weekend', 'Weekend balance', 'number', 'step="0.5" min="0"')}${dIn('fairness.holiday', 'Holiday balance', 'number', 'step="0.5" min="0"')}${dIn('fairness.streak', 'Avoid long streaks', 'number', 'step="0.5" min="0"')}${dIn('fairness.preference', 'Honor preferences', 'number', 'step="0.5" min="0"')}</div></div>
    <div class="card"><h2>Roster codes</h2><div class="form-grid">${dIn('offCode', 'Day-off code', 'text', 'maxlength="4"', 'PDK preset uses U.')}${dIn('maxConsecutiveWork', 'Max consecutive work days', 'number', 'min="1" max="14"')}</div><button class="btn" data-a="regen">Regenerate proposed roster</button></div>`;
    bindDept(box);
    box.onclick = async e => { if (e.target.closest('[data-a="regen"]')) { if (!(await confirm('Regenerate roster', 'Rebuild the proposed roster for unlocked days with current settings? Locked and published days are kept.', 'Regenerate'))) return; generateRoster(); audit('Roster regenerated', 'From settings'); save(); toast('Roster regenerated'); } };
  },
  policies(box) {
    const cap = S.dept.absenceCap;
    box.innerHTML = `${unresolvedBanner()}<div class="card"><h2>Absence cap</h2>${dIn('absenceCap.enabled', 'Limit how many people can be off at once', 'checkbox')}<div class="form-grid">${dIn('absenceCap.max', 'Maximum off simultaneously', 'number', 'min="1"')}${dSel('absenceCap.group', 'Group', S.dept.groups.map(g => [g.name, g.name]))}</div><div class="row">Counts: ${S.categories.map(c => `<label class="check"><input type="checkbox" data-cap="${esc(c.code)}" ${cap.codes.includes(c.code) ? 'checked' : ''}> ${esc(c.code)}</label>`).join('')}</div></div>
    <div class="card"><h2>Weekly days off</h2><div class="form-grid">${dIn('weeklyOff.min', 'Minimum per week (hard)', 'number', 'min="0" max="7"')}${dIn('weeklyOff.target', 'Target per week (preference)', 'number', 'min="0" max="7"')}${dSel('weeklyOff.definition', 'Week definition', [['calendar', 'Calendar week (Mon–Sun)'], ['rolling', 'Any rolling 7 days']])}</div>${dIn('weeklyOff.countsLeave', 'Leave days count toward the weekly day-off minimum', 'checkbox')}</div>
    <div class="card"><h2>Training buffer</h2>${dIn('trainingBuffer.enabled', 'Schedule a day off next to training when possible', 'checkbox')}<div class="form-grid">${dSel('trainingBuffer.placement', 'Placement', [['both', 'Before and after'], ['before', 'Day before'], ['after', 'Day after']])}${dSel('trainingBuffer.strength', 'Strength', [['preference', 'Preference (if schedule permits)'], ['hard', 'Hard rule']])}</div></div>
    <div class="card"><h2>Mutual exclusions</h2><p class="muted">Two categories that cannot be used in the same month by the same person.</p><ul>${(S.dept.exclusions || []).map((x, i) => `<li>${esc(x.a)} and ${esc(x.b)} — same ${esc(x.scope)} <button class="btn sm ghost" data-ex="${i}">Remove</button></li>`).join('') || '<li class="muted">None</li>'}</ul><div class="row">${sel('', S.categories.map(c => [c.code, c.code]), '', 'id="exa" style="width:auto" aria-label="First category"')}${sel('', S.categories.map(c => [c.code, c.code]), S.categories[1]?.code, 'id="exb" style="width:auto" aria-label="Second category"')}<button class="btn sm" data-a="addex">Add exclusion</button></div></div>
    <div class="card"><h2>Holidays</h2><p class="muted">One date per line (YYYY-MM-DD). Used for holiday fairness.</p><textarea id="hol" rows="4">${esc(S.dept.holidays.join('\n'))}</textarea></div>
    <div class="card"><h2>Blackout periods</h2><ul>${(S.dept.blackouts || []).map((b, i) => `<li>${esc(b.label)}: ${esc(D.label(b.start))} – ${esc(D.label(b.end))} <button class="btn sm ghost" data-bo="${i}">Remove</button></li>`).join('') || '<li class="muted">None</li>'}</ul><div class="row"><input id="bol" placeholder="Label" style="max-width:200px" aria-label="Blackout label"><input type="date" id="bos" value="${D.add(TODAY, 30)}" style="width:auto" aria-label="Start"><input type="date" id="boe" value="${D.add(TODAY, 32)}" style="width:auto" aria-label="End"><button class="btn sm" data-a="addbo">Add blackout</button></div></div>
    <div class="card"><h2>Open items needing department confirmation</h2><p class="muted">One per line. Shown as a banner until cleared.</p><textarea id="unr" rows="4">${esc((S.dept.unresolved || []).join('\n'))}</textarea></div>`;
    bindDept(box);
    box.addEventListener('change', e => {
      if (e.target.dataset.cap) { const code = e.target.dataset.cap; cap.codes = e.target.checked ? [...new Set([...cap.codes, code])] : cap.codes.filter(c => c !== code); audit('Absence cap codes', cap.codes.join('/')); save(); }
      if (e.target.id === 'hol') { S.dept.holidays = e.target.value.split(/\s+/).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort(); audit('Holidays edited', `${S.dept.holidays.length} dates`); save(); }
      if (e.target.id === 'unr') { S.dept.unresolved = e.target.value.split('\n').map(s => s.trim()).filter(Boolean); audit('Open items edited', `${S.dept.unresolved.length} item(s)`); save(); }
    });
    box.onclick = e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'addex') { const x = { a: $('#exa', box).value, b: $('#exb', box).value, scope: 'month' }; if (x.a === x.b) return toast('Choose two different categories.', 'bad'); (S.dept.exclusions ||= []).push(x); audit('Exclusion added', `${x.a}/${x.b}`); save(); }
      if (a === 'addbo') { const b = { label: $('#bol', box).value.trim() || 'Blackout', start: $('#bos', box).value, end: $('#boe', box).value }; if (b.end < b.start) return toast('End must be after start.', 'bad'); (S.dept.blackouts ||= []).push(b); audit('Blackout added', `${b.label} ${b.start}–${b.end}`); save(); }
      const ex = e.target.closest('[data-ex]'); if (ex) { const x = S.dept.exclusions.splice(Number(ex.dataset.ex), 1)[0]; audit('Exclusion removed', `${x.a}/${x.b}`); save(); }
      const bo = e.target.closest('[data-bo]'); if (bo) { const x = S.dept.blackouts.splice(Number(bo.dataset.bo), 1)[0]; audit('Blackout removed', x.label); save(); }
    };
  },
  data(box) {
    box.innerHTML = `<div class="card"><h2>Demo data</h2><p>All data lives in this browser's local storage. Nothing is sent anywhere.</p><div class="row"><button class="btn" data-a="exp">Export department JSON</button><label class="btn">Import JSON<input type="file" id="imp" accept="application/json,.json" hidden></label><button class="btn danger" data-a="reset">Reset demo</button></div></div>
    <div class="card"><h2>Storage</h2><p class="muted">${S.crew.length} crew · ${S.aircraft.length} aircraft · ${S.requests.length} requests · ${S.bids.length} bids · ${S.trips.length} trips · ${S.passengers.length} passengers · ${S.audit.length} audit entries · ~${Math.round(JSON.stringify(S).length / 1024)} KB</p></div>`;
    box.onclick = async e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'exp') download(`flightdeck-bid-${TODAY}.json`, JSON.stringify(S, null, 2), 'application/json');
      if (a === 'reset' && await confirm('Reset demo', 'Erase all demo data in this browser and return to the start screen?', 'Reset', 'danger')) { resetAll(); location.hash = ''; location.reload(); }
    };
    $('#imp', box).onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { const s = JSON.parse(await f.text()); if (s.schema !== 3 || !s.dept || !Array.isArray(s.crew)) throw new Error('Not a FlightDeck Bid v3 export'); setState(s); audit('Department imported', f.name); save(); toast('Imported'); }
      catch (err) { toast(`Import failed: ${err.message}`, 'bad'); }
    };
  },
};

// ---------------------------------------------------------------- helpers
const qStr = c => c.quals.map(q => `${q.type}:${q.seat}`).join(', ');
const parseQ = s => s.split(/[,\s]+/).filter(Boolean).map(x => { const [type, seat = 'PIC'] = x.split(':'); return { type: type.toUpperCase(), seat: seat.toUpperCase() === 'SIC' ? 'SIC' : 'PIC' }; });

async function crewForm(c) {
  const x = c ? clone(c) : { id: uid('c'), name: '', empId: '', group: S.dept.groups[0]?.name || 'Pilots', seniority: S.crew.length + 1, hireDate: TODAY, quals: [], currency: [], targetDays: 16, allot: {}, prefs: { weekendsOff: false, note: '' }, status: 'active', contract: false, priorQuarterHrs: 0, priorYearHrs: 0 };
  const res = await modal(c ? `Edit ${c.name}` : 'Add crew member', `<div class="form-grid"><label class="field"><span>Name</span><input name="name" value="${esc(x.name)}"></label><label class="field"><span>Employee ID</span><input name="empId" value="${esc(x.empId)}"></label><label class="field"><span>Group</span>${sel('group', S.dept.groups.map(g => [g.name, g.name]), x.group)}</label><label class="field"><span>Seniority # (1 = most senior)</span><input type="number" name="seniority" min="1" value="${x.seniority}"></label><label class="field"><span>Hire date</span><input type="date" name="hireDate" value="${x.hireDate}"></label><label class="field"><span>Target work days per 30</span><input type="number" name="targetDays" min="0" max="30" value="${x.targetDays}"></label><label class="field"><span>Status</span>${sel('status', [['active', 'Active'], ['inactive', 'Inactive']], x.status)}</label><label class="field"><span>Prior flight hours this quarter</span><input type="number" name="priorQuarterHrs" min="0" value="${x.priorQuarterHrs || 0}"></label></div>
    <label class="field"><span>Qualifications (TYPE:SEAT, comma separated)</span><input name="quals" value="${esc(qStr(x))}" placeholder="G280:PIC, G550:SIC, AW139:PIC"><small>Known types: ${esc(types().join(', ') || 'add aircraft first')}. A pilot can hold different seats on different types.</small></label>
    <label class="field"><span>Currency items (one per line: label | type or blank for all duty | expiry YYYY-MM-DD)</span><textarea name="currency" rows="3">${esc((x.currency || []).map(y => `${y.label} | ${y.type || ''} | ${y.expires}`).join('\n'))}</textarea></label>
    <label class="field"><span>Individual allotments (CODE=days, comma separated; blank uses category default)</span><input name="allot" value="${esc(Object.entries(x.allot || {}).map(([k, v]) => `${k}=${v}`).join(', '))}"></label>
    <label class="field"><span>Preference note</span><input name="note" value="${esc(x.prefs?.note || '')}"></label>
    <div class="row"><label class="check"><input type="checkbox" name="contract" ${x.contract ? 'checked' : ''}> Contract crew</label><label class="check"><input type="checkbox" name="weekendsOff" ${x.prefs?.weekendsOff ? 'checked' : ''}> Prefers weekends off</label></div>`, {
    wide: true, actions: [...(c ? [{ label: 'Delete', value: 'delete', kind: 'danger' }] : []), { label: 'Cancel', value: null, kind: 'ghost' }, { label: 'Save', kind: 'primary', validate: el => !$('[name=name]', el).value.trim() ? 'Name is required.' : null, collect: el => formData(el) }],
  });
  if (!res) return;
  if (res === 'delete') { const used = S.trips.some(t => t.crew.pic === c.id || t.crew.sic === c.id) || S.requests.some(r => r.crewId === c.id); if (used) { c.status = 'inactive'; audit('Crew deactivated', c.name); toast('Has history — marked inactive instead of deleted'); } else { S.crew = S.crew.filter(y => y.id !== c.id); audit('Crew removed', c.name); } save(); return; }
  Object.assign(x, { name: res.name.trim(), empId: res.empId, group: res.group, seniority: Number(res.seniority) || 1, hireDate: res.hireDate, targetDays: Number(res.targetDays) || 0, status: res.status, priorQuarterHrs: Number(res.priorQuarterHrs) || 0, contract: res.contract, quals: parseQ(res.quals), prefs: { weekendsOff: res.weekendsOff, note: res.note } });
  x.currency = res.currency.split('\n').map(l => l.split('|').map(s => s.trim())).filter(p => p[0] && /^\d{4}-\d{2}-\d{2}$/.test(p[2] || '')).map(([label, type, expires]) => ({ label, type: type ? type.toUpperCase() : null, expires }));
  x.allot = Object.fromEntries(res.allot.split(',').map(s => s.split('=').map(y => y.trim())).filter(([k, v]) => k && v !== undefined && v !== '').map(([k, v]) => [k.toUpperCase(), Number(v)]));
  if (c) Object.assign(c, x); else S.crew.push(x);
  audit(c ? 'Crew edited' : 'Crew added', `${x.name} (${x.group}) ${qStr(x)}`); save();
}

async function bulkImport() {
  const sample = 'name,group,seniority,quals,targetDays,contract\nSam Ortiz,Pilots,15,G280:PIC G550:SIC,16,no\nLee Park,Maintenance,16,,20,no';
  const res = await modal('Bulk import crew', `<p>Paste CSV with a header row. Columns: <code>name, group, seniority, quals, targetDays, contract</code>. Quals are TYPE:SEAT separated by spaces. Unknown groups are created as count groups.</p><textarea id="csvIn" rows="8" style="width:100%;font-family:var(--mono)">${esc(sample)}</textarea><div id="prev" class="muted"></div>`, {
    wide: true, onOpen: card => { const p = () => { const rows = parseCsv($('#csvIn', card).value); $('#prev', card).textContent = `${Math.max(0, rows.length - 1)} row(s) detected`; }; card.oninput = p; p(); },
    actions: [{ label: 'Cancel', value: null, kind: 'ghost' }, { label: 'Import', kind: 'primary', collect: card => $('#csvIn', card).value }],
  });
  if (!res) return;
  const rows = parseCsv(res); const head = rows.shift()?.map(h => h.trim().toLowerCase()) || []; const ix = k => head.indexOf(k); let n = 0;
  for (const r of rows) {
    const name = r[ix('name')]?.trim(); if (!name) continue; const group = r[ix('group')]?.trim() || 'Pilots';
    if (!S.dept.groups.some(g => g.name === group)) S.dept.groups.push({ name: group, kind: 'count', minOnDuty: 1 });
    S.crew.push({ id: uid('c'), name, empId: '', group, seniority: Number(r[ix('seniority')]) || S.crew.length + 1, hireDate: TODAY, quals: parseQ(r[ix('quals')] || ''), currency: [], targetDays: Number(r[ix('targetdays')]) || 16, allot: {}, prefs: { weekendsOff: false, note: '' }, status: 'active', contract: /^y/i.test(r[ix('contract')] || ''), priorQuarterHrs: 0, priorYearHrs: 0 }); n++;
  }
  audit('Crew bulk import', `${n} row(s)`); save(); toast(`Imported ${n} crew`);
}

async function downtime(a) {
  const res = await modal(`${a.tail} downtime`, `<ul>${(a.downtime || []).map((d, i) => `<li><label class="check"><input type="checkbox" data-keep="${i}" checked> ${esc(D.label(d.start))} – ${esc(D.label(d.end))}: ${esc(d.reason)}</label></li>`).join('') || '<li class="muted">None</li>'}</ul><h3>Add period</h3><div class="form-grid"><label class="field"><span>Start</span><input type="date" name="start" value="${D.add(TODAY, 7)}"></label><label class="field"><span>End</span><input type="date" name="end" value="${D.add(TODAY, 8)}"></label><label class="field"><span>Reason</span><input name="reason" placeholder="Scheduled inspection"></label></div><small class="muted">Uncheck to remove a period. Use the disruption workflow for unscheduled maintenance inside the locked window.</small>`, {
    actions: [{ label: 'Cancel', value: null, kind: 'ghost' }, { label: 'Save', kind: 'primary', collect: c => ({ keep: $$('[data-keep]', c).filter(i => i.checked).map(i => Number(i.dataset.keep)), add: formData(c) }) }],
  });
  if (!res) return;
  a.downtime = (a.downtime || []).filter((_, i) => res.keep.includes(i));
  if (res.add.reason || res.add.start !== D.add(TODAY, 7)) a.downtime.push({ start: res.add.start, end: res.add.end < res.add.start ? res.add.start : res.add.end, reason: res.add.reason || 'Downtime' });
  audit('Aircraft downtime edited', `${a.tail}: ${a.downtime.length} period(s)`); save();
}
