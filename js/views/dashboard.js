import { esc, D, T, money, hrs } from '../util.js';
import { S, session, can, tripsOn, TODAY, crewById, crewName, lockEnd, myNotifications, acById, horizon } from '../store.js';
import { rosterGaps, shortText, allCompliance, crewStats, balanceRows, rosterCode, tripDates, tripStart, fairnessSummary } from '../engine.js';
import { routeText, tripFlight, tripCosts } from '../trips.js';
import { kpi, statusBadge, empty, badge } from '../ui.js';
import { relaxBanner, unresolvedBanner, codeStyle, legend } from './common.js';

export function render(el) {
  if (session.role === 'crew') return crewDash(el);
  if (session.role === 'accounting') return acctDash(el);
  const gaps = rosterGaps(); const comp = allCompliance(); const viol = comp.filter(c => c.severity === 'violation');
  const pend = S.requests.filter(r => r.status === 'pending'); const openBids = S.bids.filter(b => b.status === 'open');
  const upcoming = tripsOn() ? S.trips.filter(t => ['Tentative', 'Firm'].includes(t.status) && tripStart(t) && T.date(tripStart(t)) >= TODAY).sort((a, b) => tripStart(a).localeCompare(tripStart(b))) : [];
  const lockedThrough = S.roster.lockedThrough; const exc = S.exceptions.filter(e => e.status === 'pending');
  const daysToLock = ((S.dept.lockWeekday - D.dow(TODAY)) + 7) % 7;
  const nextSteps = [];
  if (!S.crew.length) nextSteps.push(['Add aircraft and crew to begin', '#/admin/setup']);
  else if (!S.roster.generatedAt) nextSteps.push(['Generate the first proposed roster', '#/schedule']);
  if (pend.length) nextSteps.push([`Review ${pend.length} pending time-off request(s)`, '#/timeoff']);
  if (openBids.length) nextSteps.push([`Run the bid award for ${openBids.length} open bid(s)`, '#/bids']);
  if (!lockedThrough || lockedThrough < lockEnd()) nextSteps.push([`Lock the near-term window through ${D.label(lockEnd())}`, '#/schedule']);
  if (tripsOn() && S.trips.some(t => t.assign === 'proposed')) nextSteps.push(['Confirm proposed trip crew assignments', '#/trips']);
  if (exc.length && can('exceptions.approve')) nextSteps.push([`Decide ${exc.length} exception(s)`, '#/exceptions']);
  el.innerHTML = `
  <div class="page-head"><div><h1>${session.role === 'management' ? 'Management' : 'Scheduler'} dashboard</h1><p>${esc(S.dept.presetName || '')} · ${S.dept.horizonDays}-day rolling horizon · coverage model: ${esc(S.dept.coverage.model)}</p></div>
  <div class="actions"><a class="btn" href="#/schedule">Open schedule</a>${tripsOn() ? '<a class="btn primary" href="#/trips/new">New trip</a>' : ''}</div></div>
  ${relaxBanner()}${unresolvedBanner()}
  <div class="kpis">
    ${kpi('Coverage gaps (horizon)', gaps.length, S.roster.generatedAt ? 'days below coverage model' : 'roster not generated', gaps.length ? 'bad' : 'ok')}
    ${kpi('Pending time off', pend.length, 'awaiting approval', pend.length ? 'warn' : '')}
    ${kpi('Open bids', openBids.length, 'preference / swap')}
    ${kpi('Compliance flags', viol.length, `${comp.length - viol.length} warning(s)`, viol.length ? 'bad' : 'ok')}
    ${kpi('Locked through', lockedThrough ? esc(D.label(lockedThrough)) : '—', `next lock day in ${daysToLock} day(s)`)}
    ${tripsOn() ? kpi('Upcoming trips', upcoming.length, `${upcoming.filter(t => t.assign === 'unassigned').length} without crew`) : ''}
    ${kpi('Exceptions', exc.length, 'pending management', exc.length ? 'warn' : '')}
  </div>
  <div class="grid g2">
    <div class="card"><h2>Next actions</h2>${nextSteps.length ? `<ol class="notice-list">${nextSteps.map(([t, h]) => `<li><a href="${h}">${esc(t)}</a></li>`).join('')}</ol>` : '<p class="muted">Nothing outstanding.</p>'}</div>
    <div class="card"><h2>Coverage gaps</h2>${gaps.length ? `<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Short</th></tr></thead><tbody>${gaps.slice(0, 10).map(g => `<tr><td>${esc(D.long(g.date))}</td><td><span class="badge bad">${esc(shortText(g))}</span></td></tr>`).join('')}</tbody></table></div>` : `<p class="muted">${S.roster.generatedAt ? 'Every rostered day meets the coverage model.' : 'Generate a roster to evaluate coverage.'}</p>`}</div>
  </div>
  ${tripsOn() ? `<div class="card flush"><div class="card-head" style="padding:14px 16px 0"><h2>Upcoming trips</h2><a href="#/trips" class="btn sm">All trips</a></div>${upcoming.length ? `<div class="tbl-wrap"><table><thead><tr><th>Trip</th><th>Date</th><th>Route</th><th>Aircraft</th><th>Status</th><th>Crew</th></tr></thead><tbody>${upcoming.slice(0, 8).map(t => `<tr><td><a href="#/trips/${t.id}">${esc(t.number)}</a></td><td>${esc(T.short(tripStart(t)))}</td><td>${esc(routeText(t))}</td><td>${esc(acById(t.tail)?.tail || t.aircraftPref || '—')}</td><td>${statusBadge(t.status)}</td><td>${t.assign === 'unassigned' ? badge('Unassigned', 'muted') : `${esc(crewName(t.crew.pic))} / ${esc(crewName(t.crew.sic))} ${statusBadge(t.assign)}`}${t.crew.obs ? ` ${badge('Obs: ' + crewName(t.crew.obs), 'info')}` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('No upcoming trips.')}</div>` : ''}
  <div class="card"><h2>Compliance and currency</h2>${comp.length ? `<div class="tbl-wrap"><table><thead><tr><th>Crew</th><th>Rule</th><th>Detail</th><th>Basis</th><th>Severity</th></tr></thead><tbody>${comp.slice(0, 12).map(v => `<tr><td>${esc(crewName(v.crewId))}</td><td>${esc(v.rule)}</td><td>${esc(v.detail)}${v.trips?.length ? ` <small>(${esc(v.trips.join(', '))})</small>` : ''}</td><td><small>${esc(v.basis)}</small></td><td>${badge(v.severity, v.severity === 'violation' ? 'bad' : 'warn')}</td></tr>`).join('')}</tbody></table></div>${comp.length > 12 ? `<p><a href="#/reports/compliance">View all ${comp.length}</a></p>` : ''}` : '<p class="muted">No flags.</p>'}<p class="muted" style="margin-top:8px">Evaluated against the department's configured rule encodings. A clear result is not a regulatory determination.</p></div>`;
}

function crewDash(el) {
  const c = crewById(session.userId); const days = D.range(TODAY, 14); const st = crewStats(c); const fs = fairnessSummary(c.group);
  const avg = k => (fs.rows.reduce((s, r) => s + r[k], 0) / Math.max(1, fs.rows.length)).toFixed(1);
  const myTrips = S.trips.filter(t => (((t.crew.pic === c.id || t.crew.sic === c.id) && ['published', 'confirmed'].includes(t.assign)) || t.crew.obs === c.id) && t.status !== 'Cancelled' && tripStart(t) && T.date(tripStart(t)) >= D.add(TODAY, -1));
  const notes = myNotifications().slice(0, 6);
  el.innerHTML = `<div class="page-head"><div><h1>Hi, ${esc(c.name.split(' ')[0])}</h1><p>${esc(c.group)} · ${esc(c.quals.map(q => `${q.type} ${q.seat}`).join(', ') || 'no type qualifications')} · seniority #${c.seniority}</p></div><div class="actions"><a class="btn primary" href="#/timeoff/new">Request time off</a><a class="btn" href="#/bids">Bid or swap</a></div></div>
  <div class="card"><h2>Next 14 days</h2><div class="tbl-wrap"><table class="sgrid"><thead><tr>${days.map(d => `<th class="${D.isWeekend(d) ? 'wk' : ''}">${D.dowShort(d)}<br>${d.slice(8)}</th>`).join('')}</tr></thead><tbody><tr>${days.map(d => { const code = rosterCode(c.id, d); const s = codeStyle(code); const pub = S.roster.status[d] === 'published'; return `<td><span class="cell ${s.cls}" style="${s.style}" title="${pub ? 'Published' : 'Proposed — may change'}">${esc(code || '·')}${pub ? '' : '<sup>*</sup>'}</span></td>`; }).join('')}</tr></tbody></table></div><small class="muted">* proposed, not yet published</small>${legend()}</div>
  <div class="grid g2">
    <div class="card"><h2>My balances</h2>${balanceRows(c).length ? `<table><thead><tr><th>Category</th><th>Period</th><th class="num">Allotted</th><th class="num">Approved</th><th class="num">Pending</th><th class="num">Remaining</th></tr></thead><tbody>${balanceRows(c).map(b => `<tr><td>${esc(b.cat.code)} <small>${esc(b.cat.name)}</small></td><td>${esc(b.key)}</td><td class="num">${b.allot}</td><td class="num">${b.approved}</td><td class="num">${b.pending}</td><td class="num"><strong>${b.remaining}</strong></td></tr>`).join('')}</tbody></table>` : '<p class="muted">No tracked balances.</p>'}</div>
    <div class="card"><h2>My fairness snapshot (${S.dept.horizonDays} days)</h2><table><thead><tr><th></th><th class="num">Me</th><th class="num">Group avg</th></tr></thead><tbody>
      <tr><td>Work + standby days vs target ${st.target}</td><td class="num">${st.work + st.sb}</td><td class="num">${avg('work')}</td></tr>
      <tr><td>Weekend days worked</td><td class="num">${st.wk}</td><td class="num">${avg('wk')}</td></tr><tr><td>Holidays worked</td><td class="num">${st.hd}</td><td class="num">${avg('hd')}</td></tr>
      <tr><td>Longest streak</td><td class="num">${st.maxStreak}</td><td class="num">${avg('maxStreak')}</td></tr><tr><td>Bids honored</td><td class="num">${st.bidsHonored}/${st.bidsTotal}</td><td class="num">—</td></tr></tbody></table></div>
  </div>
  <div class="grid g2">
    <div class="card"><h2>My trips</h2>${myTrips.length ? `<div class="list">${myTrips.map(t => `<div class="item"><div class="item-head"><a href="#/trips/${t.id}"><strong>${esc(t.number)}</strong></a>${statusBadge(t.assign)}</div><div>${esc(routeText(t))} · ${esc(T.short(tripStart(t)))} · ${t.crew.pic === c.id ? 'PIC' : t.crew.sic === c.id ? 'SIC' : 'Line-check observer'} on ${esc(acById(t.tail)?.tail || '—')}</div></div>`).join('')}</div>` : '<p class="muted">No published trip assignments.</p>'}</div>
    <div class="card"><h2>Notifications</h2>${notes.length ? `<ul class="notice-list">${notes.map(n => `<li>${n.read ? '' : '<strong>'}${esc(n.text)}${n.read ? '' : '</strong>'} <small>${esc(T.stamp(n.at))}</small></li>`).join('')}</ul>` : '<p class="muted">None.</p>'}<a href="#/notifications">All notifications</a></div>
  </div>`;
}

function acctDash(el) {
  const done = S.trips.filter(t => t.status === 'Completed'); const toInv = done.filter(t => !['Invoiced', 'Paid'].includes(t.billing.invoiceStatus));
  const flagged = S.trips.filter(t => t.billingFlag); const canc = S.trips.filter(t => t.status === 'Cancelled'); const drafts = S.trips.filter(t => t.status === 'Draft');
  el.innerHTML = `<div class="page-head"><div><h1>Accounting dashboard</h1><p>Read-only operational records with editable billing fields.</p></div><div class="actions"><a class="btn primary" href="#/accounting">Trip records</a><a class="btn" href="#/accounting/reports">Period reports</a></div></div>
  <div class="kpis">${kpi('Completed trips', done.length)}${kpi('Awaiting invoice', toInv.length, '', toInv.length ? 'warn' : '')}${kpi('Billing-impact flags', flagged.length, 'post-lock changes', flagged.length ? 'bad' : '')}${kpi('Cancelled', canc.length)}${kpi('Outstanding drafts', drafts.length)}${kpi('Recorded costs', money(done.reduce((s, t) => s + tripCosts(t), 0)))}</div>
  <div class="card flush"><div class="card-head" style="padding:14px 16px 0"><h2>Needs attention</h2></div>${[...new Set([...flagged, ...toInv])].length ? `<div class="tbl-wrap"><table><thead><tr><th>Trip</th><th>Status</th><th>Client / cost center</th><th>Flight h</th><th>Invoice</th><th>Flag</th></tr></thead><tbody>${[...new Set([...flagged, ...toInv])].map(t => `<tr><td><a href="#/accounting/${t.id}">${esc(t.number)}</a></td><td>${statusBadge(t.status)}</td><td>${esc(t.billing.client || '—')} <small>${esc(t.billing.costCenter)}</small></td><td>${hrs(tripFlight(t, t.status === 'Completed'))}</td><td>${badge(t.billing.invoiceStatus)}</td><td>${t.billingFlag ? badge('Billing impact', 'bad') : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('Nothing waiting.')}</div>`;
}
