// Line checks: Standards Captain / Peer Observer assignments on calendar days and trips.
import { esc, D, T } from '../util.js';
import { S, session, can, save, TODAY, crewName, crewById, horizon, pilots, isLocked, tripsOn, tripById } from '../store.js';
import { observers, observationsOn, observerLabel, OBS_KINDS, coverage, shortText, canObserve } from '../engine.js';
import { routeText } from '../trips.js';
import { checkObservation, addObservation, cancelObservation } from '../observers.js';
import { $, $$, modal, toast, justify, checksList, badge, empty, formData, sel } from '../ui.js';

export function render(el) {
  const edit = can('schedule.edit'); const me = session.role === 'crew' ? session.userId : null;
  const days = horizon();
  const rows = days.flatMap(d => observationsOn(d).map(o => ({ ...o, date: d })))
    .filter(o => !me || o.crewId === me || o.observed.includes(me));
  // collapse multi-day entries into one row per assignment
  const grouped = [...rows.reduce((m, o) => { const k = (o.tripId || o.obsId) + ':' + o.crewId; const g = m.get(k); if (g) g.end = o.date; else m.set(k, { ...o, start: o.date, end: o.date }); return m; }, new Map()).values()];
  const flagged = observers();
  el.innerHTML = `<div class="page-head"><div><h1>Line checks</h1><p>A line-check observer (Standards Captain / Check Airman or Peer Observer) occupies a resource: they are removed from the available pool for coverage, and each observation day counts as a flight work day. ${tripsOn() ? 'Assign observers on a trip record, or on a calendar day here for planning.' : 'The Trip module is off, so observers are planned on calendar days.'}</p></div>
    <div class="actions">${edit ? '<button class="btn primary" data-a="new">Schedule observer</button>' : ''}</div></div>
    <div class="grid g2" style="align-items:start">
      <div class="card flush"><div class="card-head" style="padding:14px 16px 0"><h2>${me ? 'My line checks' : 'Scheduled in the horizon'}</h2></div>${grouped.length ? `<div class="tbl-wrap"><table><thead><tr><th>Dates</th><th>Observer</th><th>Source</th><th>Observing</th><th>Coverage</th><th></th></tr></thead><tbody>${grouped.map(o => {
        const cov = coverage(o.start, { leaveOnly: !S.roster.cells[o.start] }); const t = o.tripId ? tripById(o.tripId) : null;
        return `<tr><td>${esc(D.label(o.start))}${o.end !== o.start ? ' – ' + esc(D.label(o.end)) : ''}${isLocked(o.start) ? ' ' + badge('locked', 'muted') : ''}</td><td><strong>${esc(crewName(o.crewId))}</strong><br><small class="muted">${esc(observerLabel(crewById(o.crewId)))}</small></td><td>${t ? `<a href="#/trips/${t.id}">${esc(t.number)}</a> <small>${esc(routeText(t))}</small>` : `Calendar day${o.note ? `<br><small class="muted">${esc(o.note)}</small>` : ''}`}</td><td><small>${esc(o.observed.map(crewName).join(', ') || '—')}</small></td><td>${cov.ok ? badge('Met', 'ok') : badge(`Short ${shortText(cov)}`, 'bad')}</td><td>${edit && o.obsId ? `<button class="btn sm ghost" data-x="${o.obsId}">Cancel</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>` : empty(me ? 'You have no line checks in the horizon.' : 'No observers scheduled in the horizon.')}</div>
      <div class="card"><h2>Qualified observers</h2>${flagged.length ? `<ul class="notice-list">${flagged.map(c => { const n = rows.filter(o => o.crewId === c.id).length; return `<li><strong>${esc(c.name)}</strong> ${badge(observerLabel(c), c.checkAirman ? 'ok' : 'info')} <small class="muted">${n} observation day(s) in horizon</small></li>`; }).join('')}</ul>` : '<p class="muted">No crew are flagged yet. Set Standards Captain / Peer Observer flags in Setup & rules → Crew.</p>'}
      <p class="muted" style="margin-bottom:0">Only flagged crew can be assigned. Observer changes inside the locked window are post-lock changes: they require a reason and are audited${tripsOn() ? '; on trips they go through the disruption workflow' : ''}.</p></div>
    </div>`;
  el.onclick = async e => {
    if (e.target.closest('[data-a="new"]')) return obsForm();
    const x = e.target.closest('[data-x]'); if (x) {
      const o = S.observations.find(y => y.id === x.dataset.x); const post = D.between(o.start, o.end).some(isLocked);
      const why = await justify('Cancel observer assignment', `Cancel ${esc(crewName(o.crewId))} on ${esc(D.label(o.start))}? They return to the available pool${post ? '. This is a post-lock change.' : '.'}`, post);
      if (!why) return; cancelObservation(o.id, why === '(none)' ? '' : why); save(); toast('Observer assignment cancelled');
    }
  };
}

export async function obsForm(pre = {}) {
  const list = observers();
  if (!list.length) return toast('Flag a Standards Captain or Peer Observer under Setup & rules → Crew first.', 'bad');
  const o = { crewId: list[0].id, kind: 'any', start: D.add(TODAY, 3), end: D.add(TODAY, 3), observedIds: [], note: '', ...pre };
  const body = () => `<div class="form-grid"><label class="field"><span>Observer type</span>${sel('kind', Object.entries(OBS_KINDS), o.kind)}</label>
    <label class="field"><span>Observer</span><select name="crewId">${list.map(c => `<option value="${c.id}" ${c.id === o.crewId ? 'selected' : ''} ${canObserve(c, o.kind) ? '' : 'disabled'}>${esc(c.name)} — ${esc(observerLabel(c))}</option>`).join('')}</select></label>
    <label class="field"><span>From</span><input type="date" name="start" value="${o.start}"></label><label class="field"><span>Through</span><input type="date" name="end" value="${o.end}"></label></div>
    <div class="field"><span>Crew being observed (optional)</span><div class="row" style="flex-wrap:wrap">${pilots().filter(c => c.id !== o.crewId).map(c => `<label class="check"><input type="checkbox" data-ob="${c.id}" ${o.observedIds.includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}</div></div>
    <label class="field"><span>Note</span><input name="note" value="${esc(o.note)}" placeholder="e.g. Annual line check, G280"></label>
    <label class="field"><span>Reason (required inside the locked window)</span><input name="reason"></label>
    <h3>Checks</h3><div id="ochk"></div>`;
  const read = card => { const f = formData(card); Object.assign(o, { kind: f.kind, crewId: f.crewId, start: f.start, end: f.end < f.start ? f.start : f.end, note: f.note }); o.observedIds = $$('[data-ob]', card).filter(i => i.checked).map(i => i.dataset.ob); return f; };
  const refresh = card => { $('#ochk', card).innerHTML = checksList(checkObservation(o)); };
  const res = await modal('Schedule line-check observer', `<div id="obody">${body()}</div>`, {
    wide: true,
    onOpen: card => { refresh(card); card.oninput = card.onchange = e => { read(card); if (['kind', 'crewId'].includes(e.target.name)) { $('#obody', card).innerHTML = body(); } refresh(card); }; },
    actions: [{ label: 'Cancel', value: null, kind: 'ghost' }, { label: 'Schedule observer', kind: 'primary',
      validate: card => { const f = read(card); const ch = checkObservation(o); if (ch.some(c => c.level === 'block')) return 'Resolve the blocking checks first.'; if (D.between(o.start, o.end).some(isLocked) && !f.reason?.trim()) return 'A reason is required for post-lock observer changes.'; return null; },
      collect: card => read(card).reason || '' }],
  });
  if (res === null || res === undefined) return;
  addObservation({ ...o }, res); save(); toast('Observer scheduled — counted as a work day and removed from the coverage pool');
}
