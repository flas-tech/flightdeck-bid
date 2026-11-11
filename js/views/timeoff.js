import { esc, D, uid, csv, download } from '../util.js';
import { S, session, can, save, audit, notify, TODAY, crewById, crewName, activeCrew, catByCode, isLocked, exception } from '../store.js';
import { checkRequest, worst, applyLeaveToRoster, removeLeaveFromRoster, reqDates, awardLeave, METHODS, balanceRows, tripAssignedOn } from '../engine.js';
import { $, $$, modal, toast, justify, checksList, statusBadge, sel, tabs, empty, badge } from '../ui.js';
import { crewOpts } from './common.js';

const ui = { tab: 'queue', filter: 'all' };

export function render(el, param) {
  const sched = can('timeoff.approve'); const me = session.userId;
  if (!sched) ui.tab = ui.tab === 'balances' ? 'balances' : 'mine';
  const list = S.requests.filter(r => sched || r.crewId === me).filter(r => ui.filter === 'all' || r.status === ui.filter).sort((a, b) => b.created.localeCompare(a.created));
  const pend = S.requests.filter(r => r.status === 'pending').sort((a, b) => (catByCode(a.code)?.priority ?? 9) - (catByCode(b.code)?.priority ?? 9) || a.start.localeCompare(b.start));
  const tabItems = sched ? [['queue', `Approval queue (${pend.length})`], ['all', 'All requests'], ['balances', 'Balances']] : [['mine', 'My requests'], ['balances', 'My balances']];
  el.innerHTML = `<div class="page-head"><div><h1>Time off</h1><p>Requests use department categories. Each one is checked right away for balance, absence cap, same-month exclusions, blackouts, coverage and trip conflicts. Requests can be edited until their dates are locked.</p></div>
    <div class="actions"><button class="btn primary" data-a="new">${sched ? 'Enter request' : 'Request time off'}</button>${sched ? '<button class="btn" data-a="award">Process pending by priority</button>' : ''}</div></div>
    ${tabs(tabItems, ui.tab)}<div id="tbody"></div>`;
  const body = $('#tbody', el);
  if (ui.tab === 'queue') body.innerHTML = pend.length ? `<div class="list">${pend.map(r => reqCard(r, true)).join('')}</div>` : empty('No pending requests.');
  if (ui.tab === 'all' || ui.tab === 'mine') body.innerHTML = `<div class="row" style="margin-bottom:10px">${sel('f', [['all', 'All statuses'], 'pending', 'approved', 'denied', 'cancelled'], ui.filter, 'id="flt" style="width:auto" aria-label="Status filter"')}${sched ? '<button class="btn sm ghost" data-a="csv">Export CSV</button>' : ''}</div>${list.length ? `<div class="list">${list.map(r => reqCard(r, false)).join('')}</div>` : empty('No requests.')}`;
  if (ui.tab === 'balances') body.innerHTML = balances(sched ? activeCrew() : [crewById(me)]);
  $$('[data-tab]', el).forEach(b => b.onclick = () => { ui.tab = b.dataset.tab; render(el); });
  $('#flt', el)?.addEventListener('change', e => { ui.filter = e.target.value; render(el); });
  el.onclick = async e => {
    const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a; const r = S.requests.find(x => x.id === b.dataset.id);
    if (a === 'new') return requestForm();
    if (a === 'approve') return approve(r);
    if (a === 'deny') return deny(r);
    if (a === 'cancel') return cancel(r);
    if (a === 'edit') return requestForm(r);
    if (a === 'award') return award();
    if (a === 'csv') { download(`time-off-${TODAY}.csv`, csv([['Crew', 'Code', 'Start', 'End', 'Days', 'Status', 'Note', 'Decided by', 'Reason'], ...S.requests.map(r => [crewName(r.crewId), r.code, r.start, r.end, reqDates(r).length, r.status, r.note, r.decidedBy || '', r.reason || ''])])); }
  };
  if (param === 'new') { history.replaceState(null, '', '#/timeoff'); requestForm(); }
}

function reqCard(r, actions) {
  const cat = catByCode(r.code); const checks = r.status === 'pending' ? checkRequest(r) : []; const w = worst(checks); const sched = can('timeoff.approve');
  const lockedAny = reqDates(r).some(isLocked); const mine = r.crewId === session.userId;
  return `<div class="item"><div class="item-head"><div><strong>${esc(crewName(r.crewId))}</strong> · <span class="badge" style="background:${cat?.color};color:#fff">${esc(r.code)}</span> ${esc(cat?.name || '')} · ${esc(D.label(r.start))}${r.end !== r.start ? ` – ${esc(D.label(r.end))}` : ''} <small>(${reqDates(r).length} day${reqDates(r).length > 1 ? 's' : ''}, tier ${cat?.priority ?? '—'})</small></div><div class="row">${statusBadge(r.status)}${r.status === 'pending' ? badge(w === 'block' ? 'fails checks' : w === 'warn' ? 'review' : 'passes checks', w === 'block' ? 'bad' : w === 'warn' ? 'warn' : 'ok') : ''}</div></div>
    ${r.note ? `<p class="muted">“${esc(r.note)}”</p>` : ''}${r.reason ? `<p><small>Decision: ${esc(r.reason)} — ${esc(r.decidedBy || '')}</small></p>` : ''}
    ${checksList(checks)}
    <div class="row">${sched && r.status === 'pending' ? `<button class="btn sm primary" data-a="approve" data-id="${r.id}">${w === 'block' ? 'Approve with override' : 'Approve'}</button><button class="btn sm danger" data-a="deny" data-id="${r.id}">Deny</button>` : ''}
    ${(mine || sched) && r.status === 'pending' ? `<button class="btn sm" data-a="edit" data-id="${r.id}">Edit</button>` : ''}
    ${(mine || sched) && ['pending', 'approved'].includes(r.status) && (!lockedAny || sched) ? `<button class="btn sm ghost" data-a="cancel" data-id="${r.id}">Cancel request</button>` : ''}
    ${mine && r.status === 'approved' && lockedAny ? '<small class="muted">Inside locked window — contact scheduling to change.</small>' : ''}</div></div>`;
}

function balances(crew) {
  const cats = S.categories.filter(c => c.balance.period !== 'none');
  if (!cats.length) return empty('No categories track balances.');
  return `<div class="card flush"><div class="tbl-wrap"><table><thead><tr><th>Crew</th>${cats.map(c => `<th class="num">${esc(c.code)}<br><small>${esc(c.balance.period)}</small></th>`).join('')}</tr></thead><tbody>${crew.map(c => { const b = balanceRows(c); return `<tr><td>${esc(c.name)}</td>${cats.map(cat => { const x = b.find(y => y.cat.code === cat.code); return `<td class="num" title="${x.allot} allotted · ${x.approved} approved · ${x.pending} pending"><strong>${x.remaining}</strong>/${x.allot}${x.pending ? ` <small>(${x.pending} pend)</small>` : ''}</td>`; }).join('')}</tr>`; }).join('')}</tbody></table></div></div><p class="muted">Remaining / allotted for the current year or month. Per-person allotment overrides are set on the crew profile.</p>`;
}

async function requestForm(existing = null) {
  const sched = can('timeoff.approve'); const me = session.userId;
  const r = existing ? { ...existing } : { id: uid('rq'), crewId: sched ? activeCrew()[0]?.id : me, code: S.categories[0]?.code, start: D.add(TODAY, 14), end: D.add(TODAY, 14), note: '', status: 'pending', created: new Date().toISOString() };
  const res = await modal(existing ? 'Edit request' : 'Time-off request', `<div class="form-grid">
    ${sched ? `<label class="field"><span>Crew member</span><select name="crewId">${crewOpts(activeCrew(), r.crewId)}</select></label>` : ''}
    <label class="field"><span>Category</span>${sel('code', S.categories.map(c => [c.code, `${c.code} — ${c.name}`]), r.code)}</label>
    <label class="field"><span>Start</span><input type="date" name="start" value="${r.start}"></label><label class="field"><span>End</span><input type="date" name="end" value="${r.end}"></label></div>
    <label class="field"><span>Note</span><input name="note" value="${esc(r.note)}"></label>
    <h3>Immediate rules check</h3><div id="chk"></div>`, {
    wide: true, actions: [{ label: 'Cancel', value: null, kind: 'ghost' }, { label: existing ? 'Save changes' : 'Submit request', kind: 'primary', collect: c => read(c) }],
    onOpen: card => { const upd = () => { const x = read(card); const cat = catByCode(x.code); $('#chk', card).innerHTML = checksList(checkRequest(x)) + (cat && !cat.requiresApproval ? '<p class="muted">This category does not require approval and will be recorded as approved if checks pass.</p>' : ''); }; card.oninput = upd; upd(); },
  });
  function read(card) { const o = { ...r }; for (const f of $$('input,select', card)) if (f.name) o[f.name] = f.value; if (o.end < o.start) o.end = o.start; return o; }
  if (!res) return;
  const checks = checkRequest(res); const cat = catByCode(res.code);
  if (existing) { Object.assign(existing, res); audit('Time-off request edited', `${crewName(res.crewId)} ${res.code} ${res.start}–${res.end}`); }
  else {
    S.requests.push(res);
    if (!cat.requiresApproval && worst(checks) !== 'block') { res.status = 'approved'; res.decidedBy = 'Auto (no approval required)'; applyLeaveToRoster(res); notify('role:admin', `${crewName(res.crewId)} recorded ${res.code} ${D.label(res.start)}–${D.label(res.end)} (no approval required)`, '#/timeoff'); }
    else notify('role:admin', `New ${res.code} request from ${crewName(res.crewId)} for ${D.label(res.start)}–${D.label(res.end)}`, '#/timeoff');
    audit('Time-off request submitted', `${crewName(res.crewId)} ${res.code} ${res.start}–${res.end}; checks: ${worst(checks)}`);
  }
  save(); toast(res.status === 'approved' ? 'Recorded' : 'Request submitted');
}

async function approve(r) {
  const checks = checkRequest(r); const w = worst(checks); const locked = reqDates(r).some(isLocked); let why = '';
  if (w === 'block' || locked) { why = await justify('Approve with override', `${w === 'block' ? 'This request fails one or more checks:' : 'This request is inside the locked window.'}${checksList(checks.filter(c => c.level !== 'ok'))}The override is logged${locked || w === 'block' ? ' and raised for management review' : ''}.`); if (!why) return; }
  r.status = 'approved'; r.decidedBy = crewName(session.userId) !== '—' ? crewName(session.userId) : 'Scheduler (demo)'; r.reason = why || 'Approved'; r.decidedAt = new Date().toISOString();
  applyLeaveToRoster(r);
  if (why) exception(locked ? 'locked-override' : 'policy-override', `Approved ${r.code} for ${crewName(r.crewId)} ${D.label(r.start)}–${D.label(r.end)} despite: ${checks.filter(c => c.level === 'block' || c.level === 'warn').map(c => c.text).join('; ')}`, why, r.id);
  const trips = [...new Set(reqDates(r).map(d => tripAssignedOn(r.crewId, d)).filter(Boolean))];
  if (trips.length) { S.disruptions.unshift({ id: uid('ds'), type: 'crew', crewId: r.crewId, start: r.start, end: r.end, tripId: trips[0].id, reason: 'Crew unavailable', detail: `Approved ${r.code}`, status: 'open', at: new Date().toISOString() }); notify('role:admin', `Approved leave conflicts with ${trips.map(t => t.number).join(', ')} — disruption opened`, '#/trips/disruptions'); }
  notify(r.crewId, `${r.code} ${D.label(r.start)}–${D.label(r.end)} approved`, '#/timeoff');
  audit('Time-off approved', `${crewName(r.crewId)} ${r.code} ${r.start}–${r.end}`, null, why);
  save(); toast('Approved');
}
async function deny(r) {
  const why = await justify('Deny request', `Deny ${crewName(r.crewId)}'s ${r.code} for ${D.label(r.start)}–${D.label(r.end)}? The reason is shared with the crew member.`); if (!why) return;
  r.status = 'denied'; r.reason = why; r.decidedBy = 'Scheduler (demo)'; r.decidedAt = new Date().toISOString();
  notify(r.crewId, `${r.code} ${D.label(r.start)}–${D.label(r.end)} denied: ${why}`, '#/timeoff'); audit('Time-off denied', `${crewName(r.crewId)} ${r.code} ${r.start}–${r.end}`, null, why); save();
}
async function cancel(r) {
  const locked = reqDates(r).some(isLocked); let why = 'Cancelled by requester';
  if (r.status === 'approved' || locked) { why = await justify('Cancel request', `Cancel ${r.status} ${r.code} for ${D.label(r.start)}–${D.label(r.end)}? Roster days revert to ${S.dept.offCode}${locked ? '; this is inside the locked window and is logged' : ''}.`, locked); if (!why) return; }
  if (r.status === 'approved') removeLeaveFromRoster(r);
  r.status = 'cancelled'; r.reason = why; audit('Time-off cancelled', `${crewName(r.crewId)} ${r.code} ${r.start}–${r.end}`, null, why);
  notify(session.role === 'crew' ? 'role:admin' : r.crewId, `${crewName(r.crewId)} ${r.code} ${D.label(r.start)} cancelled`, '#/timeoff'); save();
}

async function award() {
  const pend = S.requests.filter(r => r.status === 'pending'); if (!pend.length) return toast('No pending requests.');
  let method = S.dept.bidMethod;
  const draw = card => { const res = awardLeave(method); $('#aw', card).innerHTML = `<p class="muted">Order: category priority tier first (${[...new Set(S.categories.map(c => c.priority))].sort().map(p => `tier ${p}: ${S.categories.filter(c => c.priority === p).map(c => c.code).join('/')}`).join(' → ')}), then ${esc(METHODS[method])} within a tier. Each approval is simulated before the next is evaluated.</p><table><thead><tr><th>#</th><th>Request</th><th>Tier</th><th>Recommendation</th><th>Why</th></tr></thead><tbody>${res.results.map((x, i) => { const r = S.requests.find(y => y.id === x.id); return `<tr><td>${i + 1}</td><td>${esc(crewName(r.crewId))} ${esc(r.code)} ${esc(D.label(r.start))}${r.end !== r.start ? '–' + esc(D.label(r.end)) : ''}</td><td>${x.tier}</td><td>${badge(x.decision, x.decision === 'approve' ? 'ok' : x.decision === 'deny' ? 'bad' : 'warn')}</td><td><small>${esc(x.checks.filter(c => c.level === 'block' || c.level === 'warn').map(c => c.text).join('; ') || 'All checks pass')}</small></td></tr>`; }).join('')}</tbody></table>`; card._res = res; };
  const ok = await modal('Process pending requests by priority', `<label class="field" style="max-width:320px"><span>Within-tier method</span>${sel('m', Object.entries(METHODS), method, 'id="awm"')}</label><div id="aw"></div><p class="muted">Applying approves the “approve” rows and denies the “deny” rows. “Review” rows stay pending for a manual decision.</p>`, {
    wide: true, onOpen: card => { draw(card); $('#awm', card).onchange = e => { method = e.target.value; draw(card); }; },
    actions: [{ label: 'Cancel', value: null, kind: 'ghost' }, { label: 'Apply recommendations', kind: 'primary', collect: c => c._res }],
  });
  if (!ok) return;
  let a = 0, d = 0;
  for (const x of ok.results) {
    const r = S.requests.find(y => y.id === x.id);
    if (x.decision === 'approve') { r.status = 'approved'; r.decidedBy = `Priority award (${METHODS[ok.method]})`; r.reason = 'All checks passed in priority order'; applyLeaveToRoster(r); notify(r.crewId, `${r.code} ${D.label(r.start)} approved`, '#/timeoff'); a++; }
    if (x.decision === 'deny') { r.status = 'denied'; r.decidedBy = `Priority award (${METHODS[ok.method]})`; r.reason = x.checks.filter(c => c.level === 'block').map(c => c.text).join('; '); notify(r.crewId, `${r.code} ${D.label(r.start)} denied: ${r.reason}`, '#/timeoff'); d++; }
  }
  audit('Priority award applied', `${a} approved, ${d} denied, method ${METHODS[ok.method]}`); save(); toast(`${a} approved · ${d} denied`);
}
