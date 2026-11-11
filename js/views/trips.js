import { esc, D, T, uid, clone, hrs, round1 } from '../util.js';
import { S, session, can, save, audit, notify, TODAY, crewById, crewName, acById, paxById, tripById, types, isLocked, lockEnd, pilots } from '../store.js';
import { tripDates, tripStart, tripEnd, tripType, ruleSetFor, compliance, dutyPeriods, liveTrip, observers, tripCrewIds, OBS_KINDS, observerLabel } from '../engine.js';
import { STATUSES, REASONS, DISRUPTIONS, newTrip, validateTrip, candidates, matchTrips, applyMatch, confirmAssignment, publishTrip, routeText, buildSuggestions, applySuggestion, evaluateDisruption, applyDisruption, completeTrip, tripFlight, tripBlock, setStatus, logChange, manifest, setTripObserver } from '../trips.js';
import { $, $$, modal, toast, justify, confirm, checksList, statusBadge, sel, tabs, empty, badge, formData } from '../ui.js';
import { crewOpts } from './common.js';

const ui = { tab: 'list', status: 'active', q: '' };

export function render(el, param = '') {
  const [id, sub] = param.split('/');
  if (id === 'new') return builder(el, null);
  if (sub !== 'edit') ui.draft = null;
  if (['suggestions', 'match', 'disruptions', 'list'].includes(id)) ui.tab = id;
  else if (id) { const t = tripById(id); if (!t) { el.innerHTML = empty('Trip not found.'); return; } if (!canSee(t)) { el.innerHTML = empty('This trip is not assigned to you.'); return; } return sub === 'edit' && can('trips.edit') ? builder(el, t) : detail(el, t); }
  const edit = can('trips.edit');
  const items = edit ? [['list', 'Trips'], ['suggestions', 'Pre-lock suggestions'], ['match', 'Lock & match'], ['disruptions', 'Disruptions']] : [['list', session.role === 'crew' ? 'My trips' : 'Trips']];
  if (!edit) ui.tab = 'list';
  el.innerHTML = `<div class="page-head"><div><h1>Trip scheduling</h1><p>Trips can be entered any time in advance and are checked continuously against crew availability across the ${S.dept.horizonDays}-day horizon. Every suggestion and match needs explicit scheduler approval.</p></div>
    <div class="actions">${edit ? '<a class="btn primary" href="#/trips/new">New trip</a>' : ''}</div></div>${tabs(items, ui.tab)}<div id="tb"></div>`;
  const box = $('#tb', el);
  $$('[data-tab]', el).forEach(b => b.onclick = () => { location.hash = `#/trips/${b.dataset.tab}`; });
  if (ui.tab === 'list') list(box);
  if (ui.tab === 'suggestions') suggestions(box);
  if (ui.tab === 'match') matchTab(box);
  if (ui.tab === 'disruptions') disruptions(box);
}
const canSee = t => session.role !== 'crew' || (tripCrewIds(t).includes(session.userId) && (['confirmed', 'published'].includes(t.assign) || t.crew.obs === session.userId));
const obsBadge = t => t.crew.obs ? badge(`Observer: ${crewName(t.crew.obs)}`, 'info') : t.observer?.wanted ? badge('Observer requested', 'warn') : '';

function list(box) {
  const q = ui.q.toLowerCase();
  const trips = S.trips.filter(canSee).filter(t => ui.status === 'all' || (ui.status === 'active' ? ['Draft', 'Tentative', 'Firm'].includes(t.status) : t.status === ui.status))
    .filter(t => !q || [t.number, routeText(t), t.billing.client, t.notes, ...t.paxIds.map(p => paxById(p)?.name)].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (tripStart(a) || '9').localeCompare(tripStart(b) || '9'));
  box.innerHTML = `<div class="row" style="margin-bottom:10px">${sel('s', [['active', 'Active (Draft/Tentative/Firm)'], ['all', 'All statuses'], ...STATUSES.map(s => [s, s])], ui.status, 'id="ts" style="width:auto" aria-label="Status"')}<input id="tq" placeholder="Search trip, route, client, passenger" value="${esc(ui.q)}" style="max-width:320px" aria-label="Search trips"></div>
  ${trips.length ? `<div class="card flush"><div class="tbl-wrap"><table><thead><tr><th>Trip</th><th>Start</th><th>Route</th><th>Aircraft</th><th>Pax</th><th>Status</th><th>Flags</th><th>Crew</th></tr></thead><tbody>${trips.map(t => { const v = validateTrip(t).filter(x => x.level === 'block' || x.level === 'warn');
    return `<tr><td><a href="#/trips/${t.id}"><strong>${esc(t.number)}</strong></a>${t.priority !== 'Normal' ? ` ${badge(t.priority, 'warn')}` : ''}</td><td>${esc(T.short(tripStart(t)))}</td><td>${esc(routeText(t))}</td><td>${esc(acById(t.tail)?.tail || (t.aircraftPref ? t.aircraftPref + ' (pref)' : '—'))}</td><td>${t.paxCount}</td><td>${statusBadge(t.status)}</td><td>${t.flexible ? badge('Flexible', 'info') : badge('Firm time', 'muted')} ${t.hitchAllowed ? badge('Hitchhikers OK') : ''} ${v.length ? badge(`${v.length} check${v.length > 1 ? 's' : ''}`, v.some(x => x.level === 'block') ? 'bad' : 'warn') : ''}</td><td>${t.assign === 'unassigned' ? badge('Unassigned', 'muted') : `${esc(crewName(t.crew.pic))} / ${esc(crewName(t.crew.sic))} ${statusBadge(t.assign)}`} ${obsBadge(t)}</td></tr>`; }).join('')}</tbody></table></div></div>` : empty('No trips match.')}`;
  $('#ts', box).onchange = e => { ui.status = e.target.value; list(box); };
  $('#tq', box).oninput = e => { ui.q = e.target.value; const pos = e.target.selectionStart; list(box); const n = $('#tq', box); n.focus(); n.setSelectionRange(pos, pos); };
}

// ---------------------------------------------------------------- builder
function builder(el, existing) {
  const key = existing?.id || 'new';
  if (ui.draft?.key !== key) { const nt = existing ? clone(existing) : newTrip(); if (!existing) { S.tripSeq--; nt.number = `T-${S.tripSeq}`; } ui.draft = { key, t: nt }; }
  const t = ui.draft.t;
  if (!t.legs.length) t.legs.push({ id: uid('lg'), from: '', to: '', dep: `${D.add(TODAY, 7)}T09:00`, arr: `${D.add(TODAY, 7)}T11:00`, pax: 0 });
  const locked = existing && (existing.frozen || existing.assign === 'published');
  let pq = '';
  const draw = () => {
    el.innerHTML = `<div class="page-head"><div><h1>${existing ? `Edit ${esc(t.number)}` : `New trip ${esc(t.number)}`}</h1><p>Guided trip entry. You can save incomplete trips as drafts; basic validation runs as you type.</p></div><div class="actions"><a class="btn ghost" href="${existing ? `#/trips/${t.id}` : '#/trips'}">Cancel</a><button class="btn" data-a="draft">Save as draft</button><button class="btn primary" data-a="save">Save trip</button></div></div>
    ${locked ? '<div class="alert warn">This trip is published or completed. Operational changes must go through the disruption workflow. Only notes can be changed here.</div>' : ''}
    <div class="grid" style="grid-template-columns:minmax(0,1fr) 320px;align-items:start" id="bgrid"><div class="steps" id="bform">
      <section class="step"><h3><span class="step-n">1</span>Basics</h3><div class="form-grid">
        <label class="field"><span>Status</span>${sel('status', STATUSES.filter(s => s !== 'Completed'), t.status)}</label>
        <label class="field"><span>Priority</span>${sel('priority', ['Normal', 'High', 'VIP'], t.priority)}</label>
        ${S.dept.mode === 'mixed' ? `<label class="field"><span>Operating part</span>${sel('part', [['aircraft', 'Per aircraft'], ['91', 'Part 91'], ['135', 'Part 135']], t.part)}</label>` : ''}
        <label class="field"><span>Rule set override</span>${sel('ruleSetId', [['', 'Default for aircraft/part'], ...S.ruleSets.map(r => [r.id, r.name])], t.ruleSetId || '')}</label></div>
        <div class="row"><label class="check"><input type="checkbox" name="flexible" ${t.flexible ? 'checked' : ''}> Flexible times</label><label class="field" style="width:150px;margin:0"><span>Flex window (h)</span><input type="number" name="flexHours" min="0" value="${t.flexHours}"></label><label class="check"><input type="checkbox" name="hitchAllowed" ${t.hitchAllowed ? 'checked' : ''}> Hitchhikers allowed (otherwise specified passengers only)</label></div></section>
      <section class="step"><h3><span class="step-n">2</span>Legs and city pairs</h3><div class="tbl-wrap legs"><table><thead><tr><th>#</th><th>From</th><th>To</th><th>Departure</th><th>Arrival</th><th>Pax</th><th class="num">Hrs</th><th></th></tr></thead><tbody>${t.legs.map((l, i) => `<tr data-leg="${i}"><td>${i + 1}</td><td><input data-f="from" value="${esc(l.from)}" maxlength="4" style="width:80px;text-transform:uppercase" aria-label="Leg ${i + 1} from"></td><td><input data-f="to" value="${esc(l.to)}" maxlength="4" style="width:80px;text-transform:uppercase" aria-label="Leg ${i + 1} to"></td><td><input type="datetime-local" data-f="dep" value="${l.dep}" aria-label="Leg ${i + 1} departure"></td><td><input type="datetime-local" data-f="arr" value="${l.arr}" aria-label="Leg ${i + 1} arrival"></td><td><input type="number" data-f="pax" min="0" value="${l.pax}" style="width:70px" aria-label="Leg ${i + 1} passengers"></td><td class="num">${l.dep && l.arr ? round1(T.hours(l.dep, l.arr)) : ''}</td><td>${t.legs.length > 1 ? `<button class="btn sm ghost" data-rm="${i}" aria-label="Remove leg ${i + 1}">✕</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
        <div class="row"><button class="btn sm" data-a="addleg">Add leg</button><button class="btn sm" data-a="ret">Add return leg</button></div><small class="muted">Times use one reference clock for all legs. In production these would be stored in UTC with local display.</small></section>
      <section class="step"><h3><span class="step-n">3</span>Passengers</h3><div class="form-grid"><label class="field"><span>Number of passengers</span><input type="number" name="paxCount" min="0" value="${t.paxCount}"></label></div>
        <input id="pq" placeholder="Filter passenger database" value="${esc(pq)}" style="max-width:300px;margin-bottom:8px" aria-label="Filter passengers">
        <div class="list" style="max-height:220px;overflow:auto">${S.passengers.filter(p => !pq || (p.name + p.company).toLowerCase().includes(pq.toLowerCase())).sort((a, b) => (b.known - a.known) || a.name.localeCompare(b.name)).map(p => `<label class="check" style="margin:0"><input type="checkbox" data-pax="${p.id}" ${t.paxIds.includes(p.id) ? 'checked' : ''}> ${esc(p.name)} <small class="muted">${esc(p.company)}${p.known ? ' · known' : ''}${p.notes ? ' · ' + esc(p.notes) : ''}</small></label>`).join('') || '<p class="muted">No passengers.</p>'}</div>
        <button class="btn sm" data-a="newpax" style="margin-top:8px">Add new passenger</button></section>
      <section class="step"><h3><span class="step-n">4</span>Aircraft</h3><div class="form-grid"><label class="field"><span>Preferred type</span>${sel('aircraftPref', [['', '—'], ...types()], t.aircraftPref)}</label>
        <label class="field"><span>Assigned tail</span>${sel('tail', [['', 'Not yet assigned'], ...S.aircraft.filter(a => a.status !== 'inactive').map(a => [a.id, `${a.tail} — ${a.type}, ${a.seats} seats, Part ${a.part}${a.status === 'mx' ? ' (MX)' : ''}`])], t.tail)}</label></div></section>
      <section class="step"><h3><span class="step-n">5</span>Line-check observer (optional)</h3>
        <p class="muted" style="margin-top:0">A third crew member — Standards Captain / Check Airman or Peer Observer. The observer occupies a resource (removed from the coverage pool) and the observation counts as a flight work day.</p>
        <div class="row"><label class="check"><input type="checkbox" name="obsWanted" ${t.observer?.wanted || t.crew.obs ? 'checked' : ''} ${locked ? 'disabled' : ''}> Observer on this trip</label></div>
        <div class="form-grid"><label class="field"><span>Observer type</span>${sel('obsKind', Object.entries(OBS_KINDS), t.observer?.kind || 'any')}</label>
        <label class="field"><span>Observer</span><select name="obsId" ${locked ? 'disabled' : ''}><option value="">Propose at lock</option>${obsOptions(t)}</select></label></div>
        ${observers().length ? '' : '<small class="muted">No crew are flagged as Standards Captain or Peer Observer yet — set the flags in Setup & rules → Crew.</small>'}</section>
      <section class="step"><h3><span class="step-n">6</span>Requirements and notes</h3><label class="field"><span>Special requirements</span><input name="special" value="${esc(t.special)}"></label><label class="field"><span>Notes</span><textarea name="notes" rows="2">${esc(t.notes)}</textarea></label></section>
      <section class="step"><h3><span class="step-n">7</span>Billing (optional, Accounting can edit later)</h3><div class="form-grid"><label class="field"><span>Client</span><input name="b_client" value="${esc(t.billing.client)}" list="clients"></label><label class="field"><span>Cost center</span><input name="b_costCenter" value="${esc(t.billing.costCenter)}"></label><label class="field"><span>Billing code</span><input name="b_code" value="${esc(t.billing.code)}"></label></div><datalist id="clients">${[...new Set(S.passengers.map(p => p.company).concat(S.trips.map(x => x.billing.client)).filter(Boolean))].map(c => `<option value="${esc(c)}">`).join('')}</datalist></section>
    </div><aside class="card" style="position:sticky;top:96px"><h2>Entry validation</h2><div id="val"></div></aside></div>`;
    if (window.innerWidth < 900) $('#bgrid', el).style.gridTemplateColumns = '1fr';
    bind();
  };
  const read = () => {
    const f = formData($('#bform', el));
    for (const k of ['status', 'priority', 'part', 'aircraftPref', 'tail', 'special', 'notes']) if (k in f) t[k] = f[k];
    t.ruleSetId = f.ruleSetId || null; t.flexible = f.flexible; t.flexHours = Number(f.flexHours) || 0; t.hitchAllowed = f.hitchAllowed; t.paxCount = Number(f.paxCount) || 0;
    t.billing.client = f.b_client; t.billing.costCenter = f.b_costCenter; t.billing.code = f.b_code;
    if (!locked) { t.observer = { wanted: !!f.obsWanted || !!f.obsId, kind: f.obsKind || 'any' }; t.crew.obs = f.obsWanted || f.obsId ? (f.obsId || null) : null; }
    $$('[data-leg]', el).forEach(tr => { const l = t.legs[Number(tr.dataset.leg)]; $$('[data-f]', tr).forEach(i => { l[i.dataset.f] = i.dataset.f === 'pax' ? Number(i.value) || 0 : i.dataset.f === 'from' || i.dataset.f === 'to' ? i.value.toUpperCase().trim() : i.value; }); });
    t.paxIds = $$('[data-pax]', el).filter(i => i.checked).map(i => i.dataset.pax).concat(t.paxIds.filter(id => !$(`[data-pax="${id}"]`, el)));
  };
  const val = () => { read(); $('#val', el).innerHTML = checksList(validateTrip(t)); };
  function bind() {
    const form = $('#bform', el); form.oninput = e => { if (e.target.id === 'pq') { read(); pq = e.target.value; draw(); const n = $('#pq', el); n.focus(); n.setSelectionRange(pq.length, pq.length); return; } val(); };
    form.onchange = e => { if (['obsKind', 'obsWanted'].includes(e.target.name)) { read(); draw(); return; } val(); }; val();
    el.onclick = async e => {
      const rm = e.target.closest('[data-rm]'); if (rm) { read(); t.legs.splice(Number(rm.dataset.rm), 1); draw(); return; }
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
      if (a === 'addleg') { read(); const p = t.legs[t.legs.length - 1]; t.legs.push({ id: uid('lg'), from: p?.to || '', to: '', dep: p ? T.addH(p.arr, 1) : `${D.add(TODAY, 7)}T09:00`, arr: p ? T.addH(p.arr, 3) : `${D.add(TODAY, 7)}T11:00`, pax: p?.pax || 0 }); draw(); }
      if (a === 'ret') { read(); const f = t.legs[0], p = t.legs[t.legs.length - 1]; const dur = T.hours(f.dep, f.arr); t.legs.push({ id: uid('lg'), from: p.to, to: f.from, dep: T.addH(p.arr, 4), arr: T.addH(p.arr, 4 + dur), pax: f.pax }); draw(); }
      if (a === 'newpax') { read(); const p = await paxForm(); if (p) { t.paxIds.push(p.id); draw(); } }
      if (a === 'draft' || a === 'save') {
        read(); if (a === 'draft') t.status = 'Draft';
        const v = validateTrip(t); if (a === 'save' && v.some(x => x.level === 'block')) return toast('Resolve blocking checks or save as draft.', 'bad');
        if (locked) { const orig = tripById(t.id); orig.notes = t.notes; orig.special = t.special; audit('Trip notes edited', orig.number); ui.draft = null; location.hash = `#/trips/${t.id}`; save(); return; }
        if (existing) {
          const orig = tripById(t.id); const statusChanged = orig.status !== t.status;
          if (statusChanged) setStatus(orig, t.status, 'Edited by scheduler');
          const newObs = t.crew.obs; const keep = { history: orig.history, changes: orig.changes, crew: orig.crew, assign: orig.assign, billing: { ...orig.billing, client: t.billing.client, costCenter: t.billing.costCenter, code: t.billing.code } };
          Object.assign(orig, t, keep); if ((orig.crew.obs || null) !== (newObs || null)) setTripObserver(orig, newObs, 'Operational'); audit('Trip edited', `${orig.number} ${routeText(orig)}`);
        } else {
          S.tripSeq++; t.history = [{ status: t.status, at: new Date().toISOString(), by: 'Scheduler (demo)', note: 'Created' }]; S.trips.push(t); audit('Trip created', `${t.number} ${t.status} ${routeText(t)}`);
          if (t.crew.obs) { const o = t.crew.obs; t.crew.obs = null; setTripObserver(t, o, 'Operational'); }
          if (t.status !== 'Draft' && tripDates(t).some(isLocked)) { S.disruptions.unshift({ id: uid('ds'), type: 'popup', tripId: t.id, reason: 'Client request', detail: 'Pop-up trip inside the locked window', status: 'open', at: new Date().toISOString() }); notify('role:admin', `Pop-up trip ${t.number} entered inside the locked window`, '#/trips/disruptions'); toast('Pop-up inside locked window — disruption opened'); }
        }
        ui.draft = null; location.hash = `#/trips/${t.id}`; save();
      }
    };
  }
  draw();
}

function obsOptions(t) {
  return candidates({ ...t, crew: { ...t.crew } }, 'OBS', { exclude: [] }).map(x => `<option value="${x.c.id}" ${x.c.id === t.crew.obs ? 'selected' : ''}>${x.ok ? '✓' : '✕'} ${esc(x.c.name)} — ${esc(observerLabel(x.c))}${x.ok ? (x.offDays ? `, uses ${x.offDays} off day(s)` : '') : ': ' + esc(x.why[0])}</option>`).join('');
}

export async function paxForm(p = null) {
  const x = p ? { ...p } : { id: uid('px'), name: '', company: '', email: '', phone: '', notes: '', weight: '', known: false };
  const res = await modal(p ? 'Edit passenger' : 'New passenger', `<div class="form-grid"><label class="field"><span>Name</span><input name="name" value="${esc(x.name)}" required></label><label class="field"><span>Company / affiliation</span><input name="company" value="${esc(x.company)}"></label><label class="field"><span>Email</span><input name="email" type="email" value="${esc(x.email)}"></label><label class="field"><span>Phone</span><input name="phone" value="${esc(x.phone)}"></label><label class="field"><span>Weight (lb, optional)</span><input name="weight" type="number" value="${esc(x.weight)}"></label></div><label class="field"><span>Preferences / notes</span><input name="notes" value="${esc(x.notes)}"></label><label class="check"><input type="checkbox" name="known" ${x.known ? 'checked' : ''}> Known passenger (quick selection)</label>`, {
    actions: [{ label: 'Cancel', value: null, kind: 'ghost' }, { label: 'Save passenger', kind: 'primary', validate: c => !$('[name=name]', c).value.trim() ? 'Name is required.' : null, collect: c => formData(c) }],
  });
  if (!res) return null;
  Object.assign(x, res); if (!p) S.passengers.push(x); else Object.assign(p, x);
  audit(p ? 'Passenger edited' : 'Passenger added', x.name); save(); return x;
}

// ---------------------------------------------------------------- detail
function detail(el, t) {
  const edit = can('trips.edit') && !t.frozen; const ac = acById(t.tail); const rs = ruleSetFor(t); const v = validateTrip(t); const mf = manifest(t);
  const crewIds = tripCrewIds(t);
  const comp = crewIds.flatMap(id => compliance(id).filter(x => x.trips.includes(t.number)));
  const postLock = t.assign === 'published' || tripDates(t).some(isLocked);
  el.innerHTML = `<div class="page-head"><div><a href="#/trips" class="muted">← Trips</a><h1>${esc(t.number)} · ${esc(routeText(t))}</h1><p>${statusBadge(t.status)} ${statusBadge(t.assign)} ${t.frozen ? badge('Operational record frozen', 'info') : ''} ${t.billingFlag ? badge('Billing impact flagged', 'bad') : ''} · ${esc(rs?.name || '')}</p></div>
    <div class="actions">${edit && !postLock ? `<a class="btn" href="#/trips/${t.id}/edit">Edit</a>` : ''}${can('trips.edit') && liveTrip(t) && !t.frozen ? `<button class="btn" data-a="disrupt">Record change / disruption</button>` : ''}${can('trips.edit') && t.frozen ? `<button class="btn" data-a="correct">Record correction</button>` : ''}${edit && ['Tentative', 'Firm'].includes(t.status) && tripStart(t) <= `${TODAY}T23:59` ? '<button class="btn primary" data-a="complete">Complete trip</button>' : ''}${edit && t.status === 'Draft' ? '<button class="btn danger" data-a="del">Delete draft</button>' : ''}${can('acct.view') ? `<a class="btn ghost" href="#/accounting/${t.id}">Accounting record</a>` : ''}</div></div>
  <div class="grid g2">
    <div class="card"><h2>Itinerary</h2><div class="tbl-wrap"><table><thead><tr><th>#</th><th>City pair</th><th>Planned</th>${t.status === 'Completed' ? '<th>Actual</th><th class="num">Flt</th><th class="num">Blk</th>' : '<th class="num">Hrs</th>'}<th class="num">Pax</th></tr></thead><tbody>${t.legs.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.from)} → ${esc(l.to)}</td><td>${esc(T.short(l.dep))} – ${esc(T.hm(l.arr))}</td>${t.status === 'Completed' ? `<td>${esc(T.short(l.depAct))} – ${esc(T.hm(l.arrAct))}</td><td class="num">${hrs(l.flightAct)}</td><td class="num">${hrs(l.blockAct)}</td>` : `<td class="num">${hrs(T.hours(l.dep, l.arr))}</td>`}<td class="num">${l.paxAct ?? l.pax}</td></tr>`).join('')}</tbody></table></div>
      <p><strong>Aircraft:</strong> ${ac ? `${esc(ac.tail)} (${esc(ac.type)}, ${ac.seats} seats, Part ${esc(ac.part)})` : `not assigned${t.aircraftPref ? ` — prefers ${esc(t.aircraftPref)}` : ''}`}</p>
      <p><strong>Timing:</strong> ${t.flexible ? `Flexible ±${t.flexHours} h` : 'Firm times'} · <strong>Passengers:</strong> ${t.hitchAllowed ? 'hitchhikers allowed' : 'specified passengers only'} · <strong>Priority:</strong> ${esc(t.priority)}</p>
      ${t.special ? `<p><strong>Special:</strong> ${esc(t.special)}</p>` : ''}${t.notes ? `<p><strong>Notes:</strong> ${esc(t.notes)}</p>` : ''}
      <h3>Entry validation</h3>${checksList(v)}</div>
    <div class="card"><h2>Crew</h2><div id="crewbox"></div></div></div>
  <div class="grid g2">
    <div class="card"><h2>Manifest (${t.paxCount} pax)</h2>${mf.length ? `<table><thead><tr><th>Name</th><th>Company</th><th>Role</th><th>Notes</th></tr></thead><tbody>${mf.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.company)}</td><td>${esc(p.role)}</td><td><small>${esc(p.notes)}</small></td></tr>`).join('')}</tbody></table>` : '<p class="muted">No named passengers selected.</p>'}${t.paxCount > mf.length ? `<p class="muted">${t.paxCount - mf.length} unnamed passenger(s).</p>` : ''}</div>
    <div class="card"><h2>Duty / rest for this trip</h2>${crewIds.length ? crewIds.map(id => { const ds = dutyPeriods(id).filter(d => d.trips.includes(t.number)); return `<p><strong>${esc(crewName(id))}</strong>${id === t.crew.obs ? ' <small class="muted">(observer — same rule set)</small>' : ''}</p>${ds.map(d => `<p class="mono">${esc(T.short(d.start))} → ${esc(T.short(d.end))} · duty ${hrs(d.dutyHrs)} h / max ${d.rs.params.maxDuty} · flight ${hrs(d.flightHrs)} h / max ${d.minCrew >= 2 ? d.rs.params.flightPerDuty2p : d.rs.params.flightPerDuty1p}</p>`).join('')}`; }).join('') + (comp.length ? checksList(comp.map(c => ({ level: c.severity === 'violation' ? 'block' : 'warn', text: `${crewName(c.crewId)}: ${c.detail} — ${c.basis}` }))) : checksList([{ level: 'ok', text: 'No duty/rest flags under the configured rule set' }])) : '<p class="muted">Assign crew to evaluate duty and rest.</p>'}</div></div>
  <div class="grid g2">
    <div class="card"><h2>Status history</h2><ul class="notice-list">${t.history.map(h => `<li>${statusBadge(h.status)} ${esc(T.stamp(h.at))} · ${esc(h.by)}${h.note ? ` — ${esc(h.note)}` : ''}</li>`).join('')}</ul></div>
    <div class="card"><h2>Change log</h2>${t.changes.length ? `<ul class="notice-list">${t.changes.map(c => `<li><strong>${esc(c.type)}</strong> (${esc(c.reason)}) ${esc(c.detail)} <small>${esc(T.stamp(c.at))} · ${esc(c.by)}${c.postLock ? ' · post-lock' : ''}${c.billingImpact ? ' · billing impact' : ''}</small></li>`).join('')}</ul>` : '<p class="muted">No changes recorded.</p>'}</div></div>`;
  crewPanel($('#crewbox', el), t);
  el.onclick = async e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'del') { if (await confirm('Delete draft', `Delete ${t.number}? Drafts have no operational record.`, 'Delete', 'danger')) { S.trips = S.trips.filter(x => x.id !== t.id); audit('Draft trip deleted', t.number); save(); location.hash = '#/trips'; } }
    if (a === 'complete') completeFlow(t);
    if (a === 'disrupt') disruptionForm({ tripId: t.id });
    if (a === 'correct') disruptionForm({ tripId: t.id, type: 'correction' });
  };
}

function crewPanel(box, t) {
  const edit = can('trips.edit') && !t.frozen && liveTrip(t); const ac = acById(t.tail); const seats = ac && ac.minCrew < 2 ? ['PIC'] : ['PIC', 'SIC'];
  box.innerHTML = `${seats.map(seat => { const key = seat.toLowerCase(); const cands = edit ? candidates(t, seat, { exclude: [seat === 'PIC' ? t.crew.sic : t.crew.pic].filter(Boolean) }) : [];
    return `<div class="field"><span>${seat}</span>${edit ? `<select data-seat="${key}"><option value="">— unassigned —</option>${cands.map(x => `<option value="${x.c.id}" ${x.c.id === t.crew[key] ? 'selected' : ''}>${x.ok ? '✓' : '✕'} ${esc(x.c.name)} — ${x.ok ? `${x.tripDays} trip days${x.standby ? ', standby' : ''}` : esc(x.why[0])}</option>`).join('')}</select>` : `<strong>${esc(crewName(t.crew[key]))}</strong>`}</div>`; }).join('')}
    ${obsField(t, edit)}
    <p>Assignment: ${statusBadge(t.assign)}</p>
    ${edit ? `<div class="row"><button class="btn sm" data-c="best">Propose best match</button>${t.assign === 'proposed' ? '<button class="btn sm primary" data-c="confirm">Confirm crew</button>' : ''}${t.assign === 'confirmed' ? '<button class="btn sm primary" data-c="publish">Publish to crew</button>' : ''}</div><p class="muted" style="margin-top:8px">✓ = qualified, current, rostered available, no overlap and no new duty/rest violation. Choosing a ✕ option is an override and is logged.</p>` : ''}`;
  if (!edit) return;
  box.onchange = async e => {
    const s = e.target.closest('[data-seat]'); if (!s) return; const key = s.dataset.seat; const id = s.value || null;
    if (key === 'obs') return observerChange(box, t, id);
    const cand = candidates(t, key.toUpperCase()).find(x => x.c.id === id);
    let why = '';
    if (id && cand && !cand.ok) { why = await justify('Assign with override', `${crewName(id)} is not eligible: ${cand.why.join('; ')}.`); if (!why) { crewPanel(box, t); return; } }
    const old = t.crew[key]; t.crew[key] = id; t.assign = t.crew.pic || t.crew.sic ? (t.assign === 'unassigned' ? 'proposed' : t.assign) : 'unassigned';
    if (['confirmed', 'published'].includes(t.assign)) { logChange(t, 'Crew change', 'Operational', `${key.toUpperCase()} ${crewName(old)} → ${crewName(id)}`, false); notify([old, id].filter(Boolean), `${t.number} crew change: ${key.toUpperCase()} now ${crewName(id)}`, `#/trips/${t.id}`); }
    audit(why ? 'Crew assignment override' : 'Crew assigned', `${t.number} ${key.toUpperCase()}: ${crewName(old)} → ${crewName(id)}`, null, why);
    if (why) S.exceptions.unshift({ id: uid('ex'), kind: 'assignment-override', detail: `${t.number} ${key.toUpperCase()} ${crewName(id)}: ${cand.why.join('; ')}`, justification: why, by: 'Scheduler (demo)', at: new Date().toISOString(), status: 'pending' });
    save();
  };
  box.onclick = e => {
    const c = e.target.closest('[data-c]')?.dataset.c; if (!c) return;
    if (c === 'best') { for (const seat of (t.observer?.wanted && !t.crew.obs ? [...seats, 'OBS'] : seats)) { if (seat === 'OBS') { const b = candidates(t, 'OBS').find(x => x.ok); if (b) setTripObserver(t, b.c.id, 'Operational'); continue; } const key = seat.toLowerCase(); const best = candidates(t, seat, { exclude: [seat === 'PIC' ? t.crew.sic : t.crew.pic].filter(Boolean) }).find(x => x.ok); t.crew[key] = best?.c.id || null; } t.assign = t.crew.pic || t.crew.sic ? 'proposed' : 'unassigned'; audit('Crew proposed', `${t.number}: ${crewName(t.crew.pic)} / ${crewName(t.crew.sic)}`); save(); toast(t.crew.pic ? 'Best match proposed' : 'No eligible PIC found', t.crew.pic ? 'ok' : 'bad'); }
    if (c === 'confirm') { confirmAssignment(t); save(); toast('Crew confirmed'); }
    if (c === 'publish') { publishTrip(t); audit('Trip published', t.number); save(); toast('Published and crew notified'); }
  };
}

function obsField(t, edit) {
  if (!edit) return t.crew.obs || t.observer?.wanted ? `<div class="field"><span>Line-check observer</span><strong>${t.crew.obs ? `${esc(crewName(t.crew.obs))} <small class="muted">${esc(observerLabel(crewById(t.crew.obs)))}</small>` : 'Requested — not yet assigned'}</strong></div>` : '';
  const postLock = t.assign === 'published' || tripDates(t).some(isLocked);
  return `<div class="field"><span>Line-check observer <small class="muted">(${esc(OBS_KINDS[t.observer?.kind || 'any'])})</small></span><select data-seat="obs"><option value="">— none —</option>${obsOptions(t)}</select>${postLock ? '<small class="muted">Post-lock: changing the observer opens the disruption workflow.</small>' : '<small class="muted">Observer is removed from the coverage pool; the day counts as a work day.</small>'}</div>`;
}
async function observerChange(box, t, id) {
  const postLock = t.assign === 'published' || tripDates(t).some(isLocked);
  if (postLock) { crewPanel(box, t); return disruptionForm({ tripId: t.id, type: 'observer', obsAction: id ? 'add' : 'remove', crewId: id || '' }); }
  const cand = id ? candidates({ ...t, crew: { ...t.crew, obs: null } }, 'OBS').find(x => x.c.id === id) : null; let why = '';
  if (id && cand && !cand.ok) { why = await justify('Assign observer with override', `${crewName(id)} is not eligible: ${cand.why.join('; ')}.`); if (!why) { crewPanel(box, t); return; } }
  setTripObserver(t, id, 'Operational');
  if (why) { audit('Observer assignment override', `${t.number}: ${crewName(id)}`, null, why); S.exceptions.unshift({ id: uid('ex'), kind: 'assignment-override', detail: `${t.number} Observer ${crewName(id)}: ${cand.why.join('; ')}`, justification: why, by: 'Scheduler (demo)', at: new Date().toISOString(), status: 'pending' }); }
  save(); toast(id ? 'Observer assigned' : 'Observer removed');
}

async function completeFlow(t) {
  const res = await modal(`Complete ${t.number}`, `<p>Enter actuals. Once completed, the operational record is frozen; later changes go through the formal correction workflow.</p><div class="tbl-wrap"><table><thead><tr><th>Leg</th><th>Actual out</th><th>Actual in</th><th>Flight h</th><th>Block h</th><th>Pax</th></tr></thead><tbody>${t.legs.map(l => `<tr data-l="${l.id}"><td>${esc(l.from)}–${esc(l.to)}</td><td><input type="datetime-local" data-f="depAct" value="${l.dep}"></td><td><input type="datetime-local" data-f="arrAct" value="${l.arr}"></td><td><input type="number" step="0.1" data-f="flightAct" value="${round1(T.hours(l.dep, l.arr))}" style="width:80px"></td><td><input type="number" step="0.1" data-f="blockAct" value="${round1(T.hours(l.dep, l.arr) + 0.3)}" style="width:80px"></td><td><input type="number" data-f="paxAct" value="${l.pax}" style="width:70px"></td></tr>`).join('')}</tbody></table></div>`, {
    wide: true, actions: [{ label: 'Cancel', value: null, kind: 'ghost' }, { label: 'Complete and freeze record', kind: 'primary', collect: c => Object.fromEntries($$('[data-l]', c).map(tr => [tr.dataset.l, Object.fromEntries($$('[data-f]', tr).map(i => [i.dataset.f, i.value]))])) }],
  });
  if (!res) return; completeTrip(t, res); save(); toast('Trip completed');
}

// ---------------------------------------------------------------- suggestions
function suggestions(box) {
  const open = buildSuggestions();
  const done = (S.suggestions || []).filter(s => s.status !== 'open').slice(0, 12);
  box.innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:10px"><p class="muted" style="margin:0">Background optimization reran just now against current trips, roster, time off and aircraft status. ${open.length} open suggestion(s).</p><button class="btn sm" data-s="rerun">Re-run</button></div>
  ${open.length ? `<div class="list">${open.map(s => `<div class="item"><div class="item-head"><div>${badge(s.kind, s.kind.includes('warning') ? 'bad' : 'info')} <strong>${esc(s.text)}</strong></div><div class="row">${s.action ? `<button class="btn sm primary" data-s="apply" data-k="${esc(s.key)}">Approve</button>` : ''}<button class="btn sm ghost" data-s="dismiss" data-k="${esc(s.key)}">Dismiss</button></div></div><p class="muted" style="margin:6px 0 0">${esc(s.detail)}</p>${s.obsImpact ? `<small class="muted">Observer resource impact: ${esc(s.obsImpact)}</small><br>` : ''}${s.tripIds.length ? `<small>${s.tripIds.map(id => `<a href="#/trips/${id}">${esc(tripById(id)?.number)}</a>`).join(' · ')}</small>` : ''}</div>`).join('')}</div>` : empty('No suggestions right now.')}
  ${done.length ? `<h3 style="margin-top:16px">Recently decided</h3><ul class="notice-list">${done.map(s => `<li>${statusBadge(s.status === 'applied' ? 'approved' : 'cancelled')} ${esc(s.kind)}: ${esc(s.text)}</li>`).join('')}</ul>` : ''}`;
  box.onclick = async e => {
    const b = e.target.closest('[data-s]'); if (!b) return; const s = S.suggestions.find(x => x.key === b.dataset.k);
    if (b.dataset.s === 'rerun') { save(); return; }
    if (b.dataset.s === 'dismiss') { s.status = 'dismissed'; audit('Suggestion dismissed', s.text); save(); }
    if (b.dataset.s === 'apply') { if (!(await confirm('Approve suggestion', `${esc(s.text)}<br><br>${esc(s.detail)}`, 'Approve and apply'))) return; applySuggestion(s); save(); toast('Applied'); }
  };
}

// ---------------------------------------------------------------- lock & match
function matchTab(box) {
  const end = lockEnd(); const win = S.trips.filter(t => ['Tentative', 'Firm'].includes(t.status) && tripDates(t).some(d => d >= TODAY && d <= end)).sort((a, b) => tripStart(a).localeCompare(tripStart(b)));
  box.innerHTML = `<div class="card"><p>Lock window: <strong>${esc(D.label(TODAY))} – ${esc(D.label(end))}</strong> (${S.roster.lockedThrough ? `locked through ${esc(D.label(S.roster.lockedThrough))}` : 'not yet locked'}). Locking from Schedule runs matching automatically; you can also preview it here.</p><div class="row"><button class="btn primary" data-m="run">Propose matches for window</button><a class="btn" href="#/schedule">Go to lock / publish</a></div></div><div id="mres"></div>
  <div class="card flush"><div class="tbl-wrap"><table><thead><tr><th>Trip</th><th>Start</th><th>Type</th><th>PIC</th><th>SIC</th><th>Observer</th><th>State</th><th></th></tr></thead><tbody>${win.map(t => `<tr><td><a href="#/trips/${t.id}">${esc(t.number)}</a></td><td>${esc(T.short(tripStart(t)))}</td><td>${esc(tripType(t))}</td><td>${esc(crewName(t.crew.pic))}</td><td>${esc(crewName(t.crew.sic))}</td><td>${t.crew.obs ? esc(crewName(t.crew.obs)) : t.observer?.wanted ? badge('requested', 'warn') : '—'}</td><td>${statusBadge(t.assign)}</td><td>${t.assign === 'proposed' ? `<button class="btn sm" data-m="confirm" data-id="${t.id}">Confirm</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">No trips in the window.</td></tr>'}</tbody></table></div></div>
  ${win.some(t => t.assign === 'proposed') ? '<button class="btn" data-m="confirmall">Confirm all proposed</button>' : ''}`;
  box.onclick = async e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    if (b.dataset.m === 'run') { const m = matchTrips(); $('#mres', box).innerHTML = m.results.length ? `<div class="card"><h2>Proposals</h2>${m.results.map(r => `<p><strong>${esc(r.number)}</strong><br>${r.notes.map(n => `<small>${esc(n)}</small>`).join('<br>')}</p>`).join('')}<button class="btn primary" id="apm">Apply as proposed</button></div>` : '<div class="alert info">No unassigned Tentative/Firm trips in the window.</div>'; $('#apm', box)?.addEventListener('click', () => { applyMatch(m); save(); toast('Proposals applied — confirm before publishing'); }); }
    if (b.dataset.m === 'confirm') { confirmAssignment(tripById(b.dataset.id)); save(); }
    if (b.dataset.m === 'confirmall') { for (const t of win.filter(t => t.assign === 'proposed')) confirmAssignment(t); save(); toast('Confirmed'); }
  };
}

// ---------------------------------------------------------------- disruptions
function disruptions(box) {
  const list = S.disruptions || [];
  box.innerHTML = `<div class="row" style="margin-bottom:10px;justify-content:space-between"><p class="muted" style="margin:0">Post-lock changes are entered here. The system evaluates the impact and suggests recoveries; you approve them. Affected crew are notified, the audit trail is updated and billing flags are set when needed.</p><button class="btn primary" data-d="new">New disruption</button></div>
  ${list.length ? `<div class="list">${list.map(d => `<div class="item"><div class="item-head"><div><strong>${esc(DISRUPTIONS[d.type])}</strong>${d.tripId ? ` · <a href="#/trips/${d.tripId}">${esc(tripById(d.tripId)?.number)}</a>` : ''}${d.crewId ? ` · ${esc(crewName(d.crewId))}` : ''} <small>${esc(T.stamp(d.at))} · ${esc(d.reason || '')}</small></div><div class="row">${statusBadge(d.status === 'open' ? 'pending' : d.status)}${d.status === 'open' ? `<button class="btn sm primary" data-d="eval" data-id="${d.id}">Evaluate & recover</button><button class="btn sm ghost" data-d="close" data-id="${d.id}">Close without change</button>` : ''}</div></div>${d.detail ? `<p class="muted">${esc(d.detail)}</p>` : ''}${d.impact ? `<small>${esc(d.impact.items.join('; '))}</small>` : ''}</div>`).join('')}</div>` : empty('No disruptions recorded.')}`;
  box.onclick = async e => {
    const b = e.target.closest('[data-d]'); if (!b) return; const d = list.find(x => x.id === b.dataset.id);
    if (b.dataset.d === 'new') disruptionForm({});
    if (b.dataset.d === 'eval') evaluateFlow(d);
    if (b.dataset.d === 'close') { const why = await justify('Close disruption', 'Close without applying changes?'); if (!why) return; d.status = 'closed'; audit('Disruption closed', DISRUPTIONS[d.type], null, why); save(); }
  };
}

export async function disruptionForm(pre) {
  const live = S.trips.filter(t => liveTrip(t) && (pre.type === 'correction' || t.status !== 'Completed'));
  const d = { id: uid('ds'), type: pre.type || 'time', tripId: pre.tripId || live[0]?.id || '', reason: REASONS[0], status: 'open', at: new Date().toISOString(), ...pre };
  const fields = (type, t) => {
    const legOpts = (t?.legs || []).map((l, i) => [l.id, `Leg ${i + 1}: ${l.from}–${l.to} ${T.short(l.dep)}`]);
    if (type === 'time') return `<label class="field"><span>Leg</span>${sel('legId', legOpts, legOpts[0]?.[0])}</label><div class="form-grid"><label class="field"><span>New departure</span><input type="datetime-local" name="newDep" value="${t?.legs[0]?.dep || ''}"></label><label class="field"><span>New arrival</span><input type="datetime-local" name="newArr" value="${t?.legs[0]?.arr || ''}"></label><label class="field"><span>New destination (optional)</span><input name="newTo" maxlength="4"></label></div>`;
    if (type === 'wx') return `<label class="field"><span>From leg</span>${sel('legId', legOpts, legOpts[0]?.[0])}</label><label class="field"><span>Delay (hours)</span><input type="number" step="0.5" name="delayHrs" value="2"></label>`;
    if (type === 'pax') return `<label class="field"><span>New passenger count</span><input type="number" name="paxCount" value="${t?.paxCount || 0}"></label>`;
    if (type === 'mx') return `<label class="field"><span>Aircraft</span>${sel('aircraftId', S.aircraft.map(a => [a.id, `${a.tail} (${a.type})`]), t?.tail || S.aircraft[0]?.id)}</label><div class="form-grid"><label class="field"><span>Down from</span><input type="date" name="start" value="${TODAY}"></label><label class="field"><span>Through</span><input type="date" name="end" value="${D.add(TODAY, 1)}"></label></div>`;
    if (type === 'observer') return `<div class="form-grid"><label class="field"><span>Action</span>${sel('obsAction', [['add', t?.crew.obs ? 'Replace observer' : 'Add observer'], ['remove', 'Remove observer']], d.obsAction || (t?.crew.obs ? 'remove' : 'add'))}</label><label class="field"><span>Observer (for add / replace)</span><select name="crewId"><option value="">—</option>${t ? obsOptions(t) : crewOpts(observers(), d.crewId)}</select></label></div><small class="muted">Current: ${t?.crew.obs ? esc(crewName(t.crew.obs)) : 'none'}. Coverage and duty/rest are re-evaluated with the observer as a hard resource.</small>`;
    if (type === 'crew') return `<label class="field"><span>Crew member</span><select name="crewId">${crewOpts([...new Set([...pilots(), ...observers()])], t?.crew.pic)}</select></label><div class="form-grid"><label class="field"><span>Unavailable from</span><input type="date" name="start" value="${TODAY}"></label><label class="field"><span>Through</span><input type="date" name="end" value="${D.add(TODAY, 1)}"></label></div>`;
    return '';
  };
  const needsTrip = type => !['mx', 'crew'].includes(type);
  const draw = card => { const f = formData(card); const type = f.type || d.type; const t = tripById(f.tripId || d.tripId); $('#tripF', card).hidden = !needsTrip(type); $('#dyn', card).innerHTML = fields(type, t); if (type === 'observer' && d.crewId) { const s = $('[name=crewId]', card); if (s) s.value = d.crewId; } };
  const res = await modal('Record change / disruption', `<div class="form-grid"><label class="field"><span>Type</span>${sel('type', Object.entries(DISRUPTIONS).filter(([k]) => k !== 'popup'), d.type, 'id="dtype"')}</label><label class="field" id="tripF"><span>Trip</span>${sel('tripId', live.map(t => [t.id, `${t.number} ${routeText(t)} ${T.short(tripStart(t))}`]), d.tripId, 'id="dtrip"')}</label><label class="field"><span>Reason code</span>${sel('reason', REASONS, d.reason)}</label></div><div id="dyn"></div><label class="field"><span>Detail</span><input name="detail"></label>`, {
    wide: true, onOpen: card => { draw(card); $('#dtype', card).onchange = () => draw(card); $('#dtrip', card).onchange = () => draw(card); },
    actions: [{ label: 'Cancel', value: null, kind: 'ghost' }, { label: 'Evaluate impact', kind: 'primary', collect: c => formData(c) }],
  });
  if (!res) return;
  Object.assign(d, res); if (!needsTrip(d.type)) d.tripId = d.tripId || null;
  S.disruptions.unshift(d); audit('Disruption entered', `${DISRUPTIONS[d.type]}${d.tripId ? ' — ' + tripById(d.tripId)?.number : ''}`); save();
  evaluateFlow(d);
}

async function evaluateFlow(d) {
  if (!d.tripId && d.type === 'crew') { const hit = S.trips.find(x => liveTrip(x) && tripCrewIds(x).includes(d.crewId) && tripDates(x).some(dd => dd >= d.start && dd <= d.end)); d.tripId = hit?.id || null; }
  const imp = evaluateDisruption(d); d.impact = imp;
  const res = await modal(`Impact — ${DISRUPTIONS[d.type]}`, `<h3>Impact</h3><ul>${imp.items.map(i => `<li>${esc(i)}</li>`).join('') || '<li>No direct impact found</li>'}</ul>
    ${imp.violations.length ? `<div class="alert bad">Duty/rest after change:<ul>${imp.violations.map(v => `<li>${esc(v.name)}: ${esc(v.detail)} — ${esc(v.basis)}</li>`).join('')}</ul></div>` : ''}
    ${imp.billing ? '<div class="alert warn">This change affects billing. Accounting will be flagged.</div>' : ''}
    <p>Affected crew: ${imp.affectedCrew.map(id => esc(crewName(id))).join(', ') || 'none'}</p>
    <h3>Suggested recoveries</h3>${imp.recoveries.length ? imp.recoveries.map((r, i) => `<label class="check"><input type="checkbox" data-r="${r.id}" ${i === 0 || !imp.recoveries.slice(0, i).some(x => x.action.tripId === r.action.tripId && x.action.seat === r.action.seat) ? 'checked' : ''}> ${esc(r.text)}</label>`).join('') : '<p class="muted">None needed or none available.</p>'}`, {
    wide: true, actions: [{ label: 'Keep open', value: null, kind: 'ghost' }, { label: 'Approve change and selected recoveries', kind: 'primary', collect: c => $$('[data-r]', c).filter(i => i.checked).map(i => i.dataset.r) }],
  });
  if (!res) { save(); return; }
  applyDisruption(d, res); save(); toast('Disruption approved, crew notified');
}
