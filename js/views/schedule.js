import { esc, D, T, csv, download } from '../util.js';
import { S, session, can, save, audit, notify, TODAY, crewById, crewName, activeCrew, isLocked, lockEnd, tripsOn, exception, horizon, acById } from '../store.js';
import { generateRoster, rosterCode, setCell, coverage, shortText, requiredSlots, canWork, tripAssignedOn, tripsOn as tripsOnDate, isWork, match, tripStart } from '../engine.js';
import { matchTrips, applyMatch, confirmAssignment, publishTrip, routeText } from '../trips.js';
import { $, $$, modal, toast, justify, confirm, badge, sel, statusBadge } from '../ui.js';
import { codeStyle, legend, printDoc, codeLabel } from './common.js';

const ui = { layout: null, start: null, span: 21, group: 'all', month: null };
const PERIODS = ['draft', 'bidding', 'reviewed', 'locked', 'published'];

export function render(el) {
  if (!ui.layout) ui.layout = session.layout === 'calendar' ? 'calendar' : 'grid';
  if (!ui.start) ui.start = TODAY; if (!ui.month) ui.month = TODAY.slice(0, 7);
  const sched = can('schedule.edit'); const p = S.roster.period || 'draft';
  el.innerHTML = `<div class="page-head"><div><h1>Schedule</h1><p>${S.roster.generatedAt ? `Proposed roster generated ${esc(T.stamp(S.roster.generatedAt))}.` : 'No roster generated yet.'} Locked through <strong>${S.roster.lockedThrough ? esc(D.label(S.roster.lockedThrough)) : '—'}</strong>; published through <strong>${S.roster.publishedThrough ? esc(D.label(S.roster.publishedThrough)) : '—'}</strong>. Bidding stays open beyond the lock window.</p></div>
    <div class="actions">${sched ? `<button class="btn" data-a="gen">Generate proposed roster</button><button class="btn" data-a="lock">Lock near-term window</button><button class="btn primary" data-a="publish">Publish</button>` : ''}<button class="btn ghost" data-a="csv">Export CSV</button><button class="btn ghost" data-a="print">Print / PDF</button></div></div>
    ${sched ? `<div class="card" style="padding:10px 14px"><div class="row" style="justify-content:space-between"><div class="row" aria-label="Roster period status">${PERIODS.map((s, i) => `${i ? '<span class="muted">→</span>' : ''}<span class="badge ${s === p ? 'info' : PERIODS.indexOf(p) > i ? 'ok' : 'muted'}">${s}</span>`).join(' ')}</div><div class="row">${p === 'draft' ? '<button class="btn sm" data-a="bidding">Open bidding</button>' : ''}${p === 'bidding' ? '<button class="btn sm" data-a="reviewed">Mark reviewed</button>' : ''}</div></div></div>` : ''}
    <div class="row" style="justify-content:space-between;margin-bottom:10px">
      <div class="seg" role="group" aria-label="Layout"><button class="${ui.layout === 'grid' ? 'on' : ''}" data-l="grid">Staffing grid</button><button class="${ui.layout === 'calendar' ? 'on' : ''}" data-l="calendar">Calendar</button></div>
      <div class="row">${ui.layout === 'grid' ? `<button class="btn sm" data-a="prev">◀</button><input type="date" id="start" value="${ui.start}" style="width:auto" aria-label="Start date"><button class="btn sm" data-a="next">▶</button>${sel('span', [[14, '14 days'], [21, '21 days'], [31, '31 days'], [45, '45 days']], ui.span, 'id="span" style="width:auto" aria-label="Days shown"')}` : `<button class="btn sm" data-a="mprev">◀</button><strong>${esc(new Date(ui.month + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }))}</strong><button class="btn sm" data-a="mnext">▶</button>`}
      ${sel('group', [['all', 'All groups'], ...S.dept.groups.map(g => [g.name, g.name])], ui.group, 'id="grp" style="width:auto" aria-label="Group"')}</div></div>
    <div id="sched"></div>${legend()}`;
  const box = $('#sched', el);
  if (ui.layout === 'grid') grid(box); else calendar(box);
  $$('[data-l]', el).forEach(b => b.onclick = () => { ui.layout = b.dataset.l; render(el); });
  $('#start', el)?.addEventListener('change', e => { ui.start = e.target.value || TODAY; render(el); });
  $('#span', el)?.addEventListener('change', e => { ui.span = Number(e.target.value); render(el); });
  $('#grp', el).onchange = e => { ui.group = e.target.value; render(el); };
  el.onclick = async e => {
    const a = e.target.closest('[data-a]')?.dataset.a; const cell = e.target.closest('[data-cell]'); const day = e.target.closest('[data-day]');
    if (cell) return editCell(cell.dataset.cell, cell.dataset.crew);
    if (day) return dayDetail(day.dataset.day);
    if (!a) return;
    if (a === 'prev') { ui.start = D.add(ui.start, -7); render(el); }
    if (a === 'next') { ui.start = D.add(ui.start, 7); render(el); }
    if (a === 'mprev' || a === 'mnext') { const d = D.parse(ui.month + '-01'); const n = new Date(d); n.setUTCMonth(n.getUTCMonth() + (a === 'mnext' ? 1 : -1)); ui.month = D.fmt(n.getTime()).slice(0, 7); render(el); }
    if (a === 'gen') {
      if (!S.crew.length) return toast('Add crew first (Setup & rules).', 'bad');
      if (!(await confirm('Generate proposed roster', `Rebuilds every <strong>unlocked</strong> day in the ${S.dept.horizonDays}-day horizon from approved time off, qualifications, coverage model, open preference bids, work-day targets and fairness weights. Locked and published days are kept. Manual edits on unlocked days will be replaced.`, 'Generate'))) return;
      const n = generateRoster(); audit('Roster generated', `${n} unlocked day(s) regenerated`); save(); toast(`Generated ${n} day(s)`);
    }
    if (a === 'bidding') { S.roster.period = 'bidding'; notify('role:crew', 'Bidding is open: submit preference bids and swaps for the proposed roster', '#/bids'); audit('Bidding opened'); save(); }
    if (a === 'reviewed') { S.roster.period = 'reviewed'; audit('Roster marked reviewed'); save(); }
    if (a === 'lock') lockFlow();
    if (a === 'publish') publishFlow();
    if (a === 'csv') exportCsv();
    if (a === 'print') printRoster();
  };
}

function visibleCrew() { return activeCrew().filter(c => ui.group === 'all' || c.group === ui.group).sort((a, b) => a.group.localeCompare(b.group) || a.seniority - b.seniority); }

function grid(box) {
  const dates = D.range(ui.start, ui.span); const crew = visibleCrew(); const sched = can('schedule.edit'); const hol = new Set(S.dept.holidays);
  const covs = Object.fromEntries(dates.map(d => [d, coverage(d)]));
  let rows = ''; let g = '';
  for (const c of crew) {
    if (c.group !== g) {
      g = c.group; const grp = S.dept.groups.find(x => x.name === g);
      rows += `<tr><td class="grp who">${esc(g)}</td>${dates.map(d => { const cv = covs[d]; let ok, txt;
        if (grp?.kind === 'seat') { ok = !cv.short.length; txt = ok ? '✓' : `−${cv.short.length}`; } else { const x = cv.groups.find(y => y.group === g); ok = !x || x.have >= x.need; txt = x ? `${x.have}/${x.need}` : ''; }
        return `<td class="${ok ? 'cov-ok' : 'cov-bad'}" title="${ok ? 'Coverage met' : esc(shortText(cv))}">${txt}</td>`; }).join('')}</tr>`;
    }
    const me = session.userId === c.id;
    rows += `<tr class="${me ? 'me' : ''}"><td class="who"><strong>${esc(c.name)}</strong>${c.contract ? ' <small>(contract)</small>' : ''}<br><small>${esc(c.quals.map(q => `${q.type} ${q.seat}`).join(', ') || c.group)}</small></td>${dates.map(d => {
      const code = rosterCode(c.id, d); const s = codeStyle(code); const trip = tripAssignedOn(c.id, d);
      const title = `${c.name} · ${D.long(d)} · ${codeLabel(code)}${trip ? ` · ${trip.number}` : ''}`;
      const inner = esc(trip ? (code === 'W' ? '✈' : code) : (code || '·'));
      return `<td>${sched ? `<button class="cell ${s.cls} ${trip ? 'c-trip' : ''}" style="${s.style}" data-cell="${d}" data-crew="${c.id}" title="${esc(title)}" aria-label="${esc(title)}">${inner}</button>` : `<span class="cell ${s.cls} ${trip ? 'c-trip' : ''}" style="${s.style}" title="${esc(title)}">${inner}</span>`}</td>`;
    }).join('')}</tr>`;
  }
  box.innerHTML = `<div class="card flush"><div class="tbl-wrap" style="max-height:70vh"><table class="sgrid"><thead><tr><th class="who">Crew</th>${dates.map(d => { const st = S.roster.status[d]; return `<th class="${D.isWeekend(d) ? 'wk' : ''} ${hol.has(d) ? 'hol' : ''} ${st === 'locked' ? 'lk' : ''} ${st === 'published' ? 'pub' : ''}" title="${esc(D.long(d))}${st ? ' · ' + st : ''}${hol.has(d) ? ' · holiday' : ''}"><button class="cell" data-day="${d}" style="min-height:0;flex-direction:column;font-weight:600">${D.dowShort(d)}<span>${d.slice(8)}</span></button></th>`; }).join('')}</tr></thead><tbody>${rows || `<tr><td class="who">No crew</td></tr>`}</tbody></table></div></div>
  <p class="muted" style="margin-top:6px">Header underline: blue = locked, green = published. Top row per group shows coverage (✓ met, −n short seats, have/need for count groups). ${can('schedule.edit') ? 'Click any cell to edit; click a date for the day breakdown.' : 'Click a date for the day breakdown.'}</p>`;
}

function calendar(box) {
  const first = ui.month + '-01'; const start = D.weekStart(first); const dates = D.range(start, 42); const crew = visibleCrew(); const me = session.role === 'crew' ? crewById(session.userId) : null;
  const cells = dates.map(d => {
    const out = d.slice(0, 7) !== ui.month; const cv = coverage(d); const rostered = !!S.roster.cells[d];
    const codes = crew.map(c => [c, rosterCode(c.id, d)]);
    const working = codes.filter(([, x]) => x === 'W').length, sb = codes.filter(([, x]) => x === 'SB').length;
    const leave = codes.filter(([, x]) => x && !isWork(x) && x !== S.dept.offCode);
    const trips = tripsOnDate(d);
    let chips = '';
    if (me) { const code = rosterCode(me.id, d); const s = codeStyle(code); chips += code ? `<span class="chip ${s.cls}" style="${s.style}">Me: ${esc(codeLabel(code))}</span>` : ''; const t = tripAssignedOn(me.id, d); if (t) chips += `<span class="chip trip">${esc(t.number)} ${esc(routeText(t))}</span>`; }
    if (rostered) chips += `<span class="chip ${cv.ok ? 'light' : 'bad'}">${cv.ok ? `${working} on · ${sb} SB` : `Short ${esc(shortText(cv))}`}</span>`;
    if (cv.observers?.length || (cv.observers > 0)) { const n = Array.isArray(cv.observers) ? cv.observers.length : cv.observers; chips += `<span class="chip c-OBS" title="Line-check observer(s) — not in the coverage pool">${n} OBS</span>`; }
    if (!me) chips += trips.slice(0, 2).map(t => `<span class="chip trip" title="${esc(t.number)}">${esc(t.number)} ${esc(routeText(t))}</span>`).join('') + (trips.length > 2 ? `<span class="chip light">+${trips.length - 2} trips</span>` : '');
    chips += leave.slice(0, 3).map(([c, x]) => { const s = codeStyle(x); return `<span class="chip ${s.cls}" style="${s.style}">${esc(x)} ${esc(c.name.split(' ').slice(-1)[0])}</span>`; }).join('') + (leave.length > 3 ? `<span class="chip light">+${leave.length - 3} off</span>` : '');
    const st = S.roster.status[d];
    return `<div class="day ${out ? 'out' : ''} ${d === TODAY ? 'today' : ''}" data-day="${d}" role="button" tabindex="0" aria-label="${esc(D.long(d))}"><div class="dn"><span>${Number(d.slice(8))}</span>${st === 'published' ? badge('pub', 'ok') : st === 'locked' ? badge('lock', 'info') : ''}</div>${chips}</div>`;
  });
  box.innerHTML = `<div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dh">${d}</div>`).join('')}${cells.join('')}</div>`;
  box.onkeydown = e => { if (e.key === 'Enter' && e.target.dataset.day) dayDetail(e.target.dataset.day); };
}

function dayDetail(d) {
  const cv = coverage(d); const { duty, standby } = requiredSlots(d); const crew = activeCrew();
  const groups = {}; for (const c of crew) { const code = rosterCode(c.id, d) || '—'; (groups[code] ||= []).push(c); }
  const pil = crew.filter(c => c.group === 'Pilots' && isWork(rosterCode(c.id, d)));
  const m = match([...duty, ...standby], pil, d); const slots = [...duty, ...standby];
  const trips = tripsOnDate(d);
  modal(D.long(d), `<p>Roster status: ${statusBadge(S.roster.status[d] || 'not generated')} · Coverage ${cv.ok ? badge('met', 'ok') : badge('short ' + shortText(cv), 'bad')}</p>
    <h3>Required seats (${esc(S.dept.coverage.model)})</h3>${slots.length ? `<table><thead><tr><th>Seat</th><th>Reason</th><th>Filled by</th></tr></thead><tbody>${slots.map((s, i) => `<tr><td>${esc(s.type)} ${esc(s.seat)}</td><td><small>${esc(s.why)}</small></td><td>${m.assign.has(i) ? esc(crewName(m.assign.get(i))) : badge('unfilled', 'bad')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No seat requirement (no active aircraft or model yields zero).</p>'}
    ${cv.groups.map(g => `<p>${esc(g.group)}: ${g.have} on / ${g.need} required ${g.have >= g.need ? badge('ok', 'ok') : badge('short', 'bad')}</p>`).join('')}
    ${trips.length ? `<h3>Trips</h3><ul>${trips.map(t => `<li><a href="#/trips/${t.id}" data-close>${esc(t.number)}</a> ${esc(routeText(t))} · ${esc(acById(t.tail)?.tail || t.aircraftPref)} · ${statusBadge(t.status)}</li>`).join('')}</ul>` : ''}
    <h3>By code</h3>${Object.entries(groups).map(([code, list]) => `<p><strong>${esc(code)}</strong> <small>${esc(codeLabel(code))}</small>: ${list.map(c => esc(c.name)).join(', ')}</p>`).join('')}`, { wide: true });
}

async function editCell(date, crewId) {
  const c = crewById(crewId); const cur = rosterCode(crewId, date); const locked = isLocked(date); const trip = tripAssignedOn(crewId, date);
  const codes = [['W', 'W — work / available'], ['SB', 'SB — standby'], ['OBS', 'OBS — line-check observer'], [S.dept.offCode, `${S.dept.offCode} — day off`], ...S.categories.map(x => [x.code, `${x.code} — ${x.name}`])];
  const res = await modal(`${c.name} · ${D.long(date)}`, `<p>Current: <strong>${esc(codeLabel(cur))}</strong>${trip ? ` · assigned to ${esc(trip.number)}` : ''}</p>
    ${locked ? '<div class="alert warn">This date is inside the locked window. Changes are logged overrides and raised for management review.</div>' : ''}
    <label class="field"><span>New code</span>${sel('code', codes, cur, 'id="newCode"')}</label><div id="impact"></div>
    <label class="field"><span>Justification ${locked ? '(required)' : '(optional)'}</span><textarea id="why" rows="2"></textarea></label>
    <p class="muted">Leave codes set here are roster overrides; use Time off to record balances and approvals.</p>`, {
    actions: [{ label: 'Cancel', value: null, kind: 'ghost' }, { label: 'Apply', kind: 'primary', validate: x => locked && !$('#why', x).value.trim() ? 'Justification required inside the locked window.' : null, collect: x => ({ code: $('#newCode', x).value, why: $('#why', x).value.trim() }) }],
    onOpen: card => { const upd = () => { const code = $('#newCode', card).value; const cells = JSON.parse(JSON.stringify(S.roster.cells)); cells[date] ||= {}; cells[date][crewId] = code; const cv = coverage(date, { cells }); const cw = isWork(code) ? canWork({ ...cells, [date]: { ...cells[date], [crewId]: S.dept.offCode } }, c, date) : { ok: true };
      $('#impact', card).innerHTML = `<ul class="checks"><li class="ck ${cv.ok ? 'ok' : 'block'}"><span class="ck-i">${cv.ok ? '✓' : '✕'}</span><span>${cv.ok ? 'Coverage still met' : 'Coverage short: ' + esc(shortText(cv))}</span></li>${cw.ok ? '' : `<li class="ck warn"><span class="ck-i">!</span><span>Hard rule: ${esc(cw.why)}</span></li>`}${trip && !isWork(code) ? `<li class="ck warn"><span class="ck-i">!</span><span>Conflicts with ${esc(trip.number)} — record a disruption to recover the trip</span></li>` : ''}</ul>`; };
      $('#newCode', card).onchange = upd; upd(); },
  });
  if (!res || res.code === cur) return;
  setCell(date, crewId, res.code);
  audit(locked ? 'Locked-window override' : 'Roster edit', `${c.name} ${date}: ${cur || '—'} → ${res.code}`, null, res.why);
  if (locked) { exception('locked-override', `${c.name} ${D.label(date)} ${cur} → ${res.code}`, res.why); notify(crewId, `Your ${D.label(date)} schedule changed: ${cur} → ${res.code}`, '#/schedule'); }
  save(); toast('Roster updated');
}

async function lockFlow() {
  if (!S.roster.generatedAt) return toast('Generate a roster first.', 'bad');
  const end = lockEnd(); const dates = D.between(TODAY, end).filter(d => S.roster.cells[d]);
  const gaps = dates.map(d => coverage(d)).filter(c => !c.ok);
  let m = null; if (tripsOn()) m = matchTrips({ through: end });
  const res = await modal(`Lock ${D.label(TODAY)} – ${D.label(end)}`, `<p>Locks the near-term ${S.dept.lockDays}-day window (weekly cadence: ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][S.dept.lockWeekday]}). Later edits inside the window become logged overrides. Bidding remains open after ${D.label(end)}.</p>
    ${gaps.length ? `<div class="alert bad">${gaps.length} day(s) in the window are short: ${gaps.map(g => `${esc(D.label(g.date))} (${esc(shortText(g))})`).join('; ')}</div>` : '<div class="alert info">Every day in the window meets the coverage model.</div>'}
    ${m ? `<h3>Proposed crew-to-trip matches</h3>${m.results.length ? `<table><thead><tr><th>Trip</th><th>Proposal</th></tr></thead><tbody>${m.results.map(r => `<tr><td>${esc(r.number)}</td><td>${r.notes.map(n => `<div><small>${esc(n)}</small></div>`).join('')}</td></tr>`).join('')}</tbody></table><label class="check"><input type="checkbox" id="confirmAll" checked> Confirm these assignments now (otherwise they stay “proposed” for review on each trip)</label>` : '<p class="muted">No unassigned Tentative/Firm trips in the window.</p>'}` : ''}`, { wide: true, actions: [{ label: 'Cancel', value: null, kind: 'ghost' }, { label: 'Lock window', kind: 'primary', collect: c => ({ confirm: $('#confirmAll', c)?.checked }) }] });
  if (!res) return;
  for (const d of dates) if (S.roster.status[d] !== 'published') S.roster.status[d] = 'locked';
  S.roster.lockedThrough = end; S.roster.period = 'locked';
  if (m && m.results.length) { applyMatch(m); if (res.confirm) for (const r of m.results) { const t = S.trips.find(x => x.id === r.tripId); if (t.crew.pic || t.crew.sic) confirmAssignment(t); } }
  audit('Window locked', `${D.label(TODAY)}–${D.label(end)}; ${gaps.length} gap day(s)`);
  notify('role:crew', `Schedule locked through ${D.label(end)}`, '#/schedule');
  save(); toast('Window locked');
}

async function publishFlow() {
  const locked = Object.entries(S.roster.status).filter(([, s]) => s === 'locked').map(([d]) => d).sort();
  const toPub = S.trips.filter(t => t.assign === 'confirmed'); const proposed = S.trips.filter(t => t.assign === 'proposed');
  if (!locked.length && !toPub.length) return toast('Lock a window before publishing.', 'bad');
  if (!(await confirm('Publish schedule', `Publishes ${locked.length} locked day(s)${locked.length ? ` (${D.label(locked[0])}–${D.label(locked[locked.length - 1])})` : ''} and ${toPub.length} confirmed trip assignment(s). Crew are notified.${proposed.length ? `<br><br><strong>${proposed.length} trip(s) still have only proposed crew</strong> and will not be published until confirmed.` : ''}`, 'Publish'))) return;
  for (const d of locked) S.roster.status[d] = 'published';
  if (locked.length) S.roster.publishedThrough = locked[locked.length - 1];
  S.roster.period = 'published';
  for (const t of toPub) publishTrip(t);
  notify('role:crew', `Schedule published through ${D.label(S.roster.publishedThrough)}`, '#/schedule');
  audit('Schedule published', `${locked.length} day(s), ${toPub.length} trip(s)`); save(); toast('Published');
}

function exportCsv() {
  const dates = horizon(); const rows = [['Crew', 'Group', ...dates]];
  for (const c of activeCrew()) rows.push([c.name, c.group, ...dates.map(d => rosterCode(c.id, d))]);
  rows.push([]); rows.push(['Status', '', ...dates.map(d => S.roster.status[d] || '')]);
  download(`roster-${TODAY}.csv`, csv(rows)); audit('Roster exported', 'CSV');
}
function printRoster() {
  const dates = D.range(ui.start, Math.min(ui.span, 31)); const crew = visibleCrew();
  printDoc(`Roster ${D.label(dates[0])} – ${D.label(dates[dates.length - 1])}`, `<table><thead><tr><th>Crew</th>${dates.map(d => `<th>${D.dowShort(d)} ${d.slice(8)}</th>`).join('')}</tr></thead><tbody>${crew.map(c => `<tr><td>${esc(c.name)}</td>${dates.map(d => `<td>${esc(rosterCode(c.id, d))}${tripAssignedOn(c.id, d) ? '✈' : ''}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
}
