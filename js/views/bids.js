import { esc, D, uid } from '../util.js';
import { S, session, can, save, audit, notify, TODAY, crewById, crewName, activeCrew, isLocked, lockEnd } from '../store.js';
import { awardBids, applyBidAward, compareMethods, METHODS, orderCrew, rosterCode, isWork } from '../engine.js';
import { $, $$, modal, toast, statusBadge, sel, tabs, empty, badge, confirm } from '../ui.js';
import { crewOpts } from './common.js';

const ui = { tab: null };
const typeLabel = b => b.type === 'off' ? 'Prefer off (no leave used)' : b.type === 'work' ? 'Prefer to work' : 'Swap';

export function render(el) {
  const sched = can('bids.approve'); ui.tab ||= sched ? 'award' : 'mine'; const me = session.userId;
  const mine = S.bids.filter(b => b.crewId === me); const incoming = S.bids.filter(b => b.type === 'swap' && b.withCrewId === me && b.status === 'awaiting-partner');
  const items = sched ? [['award', 'Award engine'], ['compare', 'Compare methods'], ['all', `All bids (${S.bids.length})`]] : [['mine', `My bids (${mine.length})`], ['incoming', `Swap requests (${incoming.length})`]];
  el.innerHTML = `<div class="page-head"><div><h1>Bids & swaps</h1><p>Preference bids and swaps for days beyond the lock window (after ${esc(D.label(lockEnd()))}). Matches keep coverage and hard rules intact. Each award needs scheduler approval before the roster changes.</p></div>
    <div class="actions">${!sched || session.role === 'management' || session.role === 'admin' ? '<button class="btn primary" data-a="new">New bid</button>' : ''}</div></div>
    ${tabs(items, ui.tab)}<div id="bb"></div>`;
  const box = $('#bb', el);
  if (ui.tab === 'mine') box.innerHTML = mine.length ? `<div class="list">${mine.map(b => bidCard(b)).join('')}</div>` : empty('No bids yet. A “prefer off” bid asks for a date off without using a leave balance.');
  if (ui.tab === 'incoming') box.innerHTML = incoming.length ? `<div class="list">${incoming.map(b => bidCard(b, true)).join('')}</div>` : empty('No swap requests waiting for you.');
  if (ui.tab === 'all') box.innerHTML = S.bids.length ? `<div class="list">${[...S.bids].sort((a, b) => a.date.localeCompare(b.date)).map(b => bidCard(b)).join('')}</div>` : empty('No bids.');
  if (ui.tab === 'award') {
    const order = orderCrew(S.dept.bidMethod, [...new Set(S.bids.filter(b => b.status === 'open').map(b => b.crewId))]);
    box.innerHTML = `<div class="card"><div class="form-grid"><label class="field"><span>Award method</span>${sel('m', Object.entries(METHODS), S.dept.bidMethod, 'id="meth"')}</label>
      <label class="field"><span>Lottery seed (reproducible)</span><input id="seed" value="${esc(S.dept.lotterySeed)}"></label>
      <label class="field"><span>Rotation index</span><input id="rot" type="number" value="${S.dept.rotationIndex}"></label></div>
      <p class="muted">Bids are awarded in rounds: each person's rank-1 bid in method order, then rank-2, and so on. Seniority ${S.dept.seniorityTieBreaker ? 'breaks ties' : 'is not used as a tie-breaker'}; contract crew go ${S.dept.contractLast ? 'last' : 'in normal order'}.</p>
      <p><strong>Current order:</strong> ${order.length ? order.map((id, i) => `${i + 1}. ${esc(crewName(id))}`).join(' · ') : '<span class="muted">no open bids</span>'}</p>
      <button class="btn primary" data-a="run">Run award (preview)</button></div><div id="res"></div>`;
    $('#meth', box).onchange = e => { S.dept.bidMethod = e.target.value; audit('Bid method changed', METHODS[e.target.value]); save(); };
    $('#seed', box).onchange = e => { S.dept.lotterySeed = e.target.value; audit('Lottery seed changed', e.target.value); save(); };
    $('#rot', box).onchange = e => { S.dept.rotationIndex = Number(e.target.value) || 0; save(); };
  }
  if (ui.tab === 'compare') {
    const cmp = compareMethods(); const crewIds = [...new Set(cmp.flatMap(c => Object.keys(c.per)))];
    box.innerHTML = cmp[0].total ? `<div class="card flush"><div class="tbl-wrap"><table><thead><tr><th>Crew</th>${cmp.map(c => `<th class="num">${esc(METHODS[c.method])}</th>`).join('')}</tr></thead><tbody>${crewIds.map(id => `<tr><td>${esc(crewName(id))} <small>#${crewById(id).seniority}</small></td>${cmp.map(c => { const p = c.per[id] || { h: 0, d: 0 }; return `<td class="num">${p.h} honored${p.d ? ` · <span style="color:var(--bad)">${p.d} denied</span>` : ''}</td>`; }).join('')}</tr>`).join('')}<tr><td><strong>Total honored</strong></td>${cmp.map(c => `<td class="num"><strong>${c.honored}/${c.total}</strong></td>`).join('')}</tr></tbody></table></div></div><p class="muted">Preview only. Each method runs on a copy of the current roster; nothing changes until a scheduler runs and accepts an award.</p>` : empty('No open bids to compare.');
  }
  $$('[data-tab]', el).forEach(b => b.onclick = () => { ui.tab = b.dataset.tab; render(el); });
  el.onclick = async e => {
    const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a; const bid = S.bids.find(x => x.id === b.dataset.id);
    if (a === 'new') return bidForm();
    if (a === 'run') return runAward(el);
    if (a === 'withdraw') { bid.status = 'withdrawn'; audit('Bid withdrawn', `${crewName(bid.crewId)} ${bid.type} ${bid.date}`); save(); }
    if (a === 'accept') { bid.status = 'open'; bid.partnerAccepted = true; notify(bid.crewId, `${crewName(bid.withCrewId)} accepted your swap; awaiting scheduler award`, '#/bids'); notify('role:admin', `Swap ready for award: ${crewName(bid.crewId)} ↔ ${crewName(bid.withCrewId)}`, '#/bids'); audit('Swap accepted by partner', `${crewName(bid.crewId)} ↔ ${crewName(bid.withCrewId)}`); save(); }
    if (a === 'decline') { bid.status = 'declined'; notify(bid.crewId, `${crewName(bid.withCrewId)} declined your swap`, '#/bids'); audit('Swap declined', `${crewName(bid.crewId)} ↔ ${crewName(bid.withCrewId)}`); save(); }
  };
}

function bidCard(b, incoming = false) {
  const own = b.crewId === session.userId || can('bids.approve');
  return `<div class="item"><div class="item-head"><div><strong>${esc(crewName(b.crewId))}</strong> · ${esc(typeLabel(b))} · ${esc(D.long(b.date))}${b.type === 'swap' ? ` ↔ ${esc(crewName(b.withCrewId))} takes it; ${esc(crewName(b.crewId))} works ${esc(D.long(b.takeDate))}` : ''} <small>rank ${b.rank || 1}</small></div>${statusBadge(b.status)}</div>
  ${b.note ? `<p class="muted">“${esc(b.note)}”</p>` : ''}${b.reason ? `<p><small>${esc(b.reason)}${b.method ? ` — ${esc(METHODS[b.method])}` : ''}</small></p>` : ''}
  <div class="row">${incoming ? `<button class="btn sm primary" data-a="accept" data-id="${b.id}">Accept swap</button><button class="btn sm danger" data-a="decline" data-id="${b.id}">Decline</button>` : ''}${own && ['open', 'awaiting-partner'].includes(b.status) && !incoming ? `<button class="btn sm ghost" data-a="withdraw" data-id="${b.id}">Withdraw</button>` : ''}</div></div>`;
}

async function bidForm() {
  const sched = can('bids.approve'); const me = session.userId || activeCrew()[0]?.id; const minDate = D.add(lockEnd(), 1);
  const res = await modal('New bid', `<div class="form-grid">${sched ? `<label class="field"><span>Crew member</span><select name="crewId">${crewOpts(activeCrew(), me)}</select></label>` : ''}
    <label class="field"><span>Bid type</span>${sel('type', [['off', 'Prefer off — no leave used'], ['work', 'Prefer to work'], ['swap', 'Swap with a colleague']], 'off', 'id="btype"')}</label>
    <label class="field"><span id="dlab">Date</span><input type="date" name="date" min="${minDate}" value="${D.add(minDate, 3)}"></label>
    <label class="field"><span>Rank (1 = most wanted)</span><input type="number" name="rank" min="1" max="9" value="1"></label></div>
    <div id="swapF" hidden class="form-grid"><label class="field"><span>Swap partner</span><select name="withCrewId">${crewOpts(activeCrew().filter(c => c.id !== me), '')}</select></label><label class="field"><span>Date you take (partner's work day)</span><input type="date" name="takeDate" min="${minDate}" value="${D.add(minDate, 5)}"></label></div>
    <label class="field"><span>Note</span><input name="note"></label><div id="hint" class="muted"></div>`, {
    actions: [{ label: 'Cancel', value: null, kind: 'ghost' }, { label: 'Submit bid', kind: 'primary', validate: c => { const f = Object.fromEntries($$('input,select', c).filter(x => x.name).map(x => [x.name, x.value])); if (f.date <= lockEnd()) return 'Bids must be after the lock window.'; if (f.type === 'swap' && (!f.withCrewId || !f.takeDate)) return 'Choose a partner and date.'; return null; }, collect: c => Object.fromEntries($$('input,select', c).filter(x => x.name).map(x => [x.name, x.value])) }],
    onOpen: card => { const upd = () => { const f = Object.fromEntries($$('input,select', card).filter(x => x.name).map(x => [x.name, x.value])); const cid = f.crewId || me; $('#swapF', card).hidden = f.type !== 'swap'; $('#dlab', card).textContent = f.type === 'swap' ? 'Date you give away (your work day)' : 'Date'; const code = rosterCode(cid, f.date); $('#hint', card).textContent = code ? `Currently rostered: ${code}${f.type === 'off' && !isWork(code) ? ' — already off' : ''}` : 'No roster for this date yet.'; }; card.oninput = upd; upd(); },
  });
  if (!res) return;
  const b = { id: uid('bd'), crewId: res.crewId || me, type: res.type, date: res.date, rank: Number(res.rank) || 1, note: res.note, status: res.type === 'swap' ? 'awaiting-partner' : 'open', created: new Date().toISOString() };
  if (res.type === 'swap') { b.withCrewId = res.withCrewId; b.takeDate = res.takeDate; notify(b.withCrewId, `${crewName(b.crewId)} proposes a swap: you work ${D.label(b.date)}, they work ${D.label(b.takeDate)}`, '#/bids'); }
  S.bids.push(b); audit('Bid submitted', `${crewName(b.crewId)} ${typeLabel(b)} ${b.date}`); save(); toast('Bid submitted');
}

async function runAward(el) {
  if (!S.roster.generatedAt) return toast('Generate a roster first.', 'bad');
  const res = awardBids(S.dept.bidMethod); const box = $('#res', el);
  if (!res.results.length) { box.innerHTML = empty('No open bids eligible (they must be beyond the lock window; swaps must be partner-accepted).'); return; }
  box.innerHTML = `<div class="card flush"><div class="card-head" style="padding:14px 16px 0"><h2>Proposed matches — ${esc(METHODS[res.method])}</h2><div class="row"><button class="btn primary" id="acc">Accept matches</button></div></div><div class="tbl-wrap"><table><thead><tr><th>Round</th><th>Crew</th><th>Bid</th><th>Outcome</th><th>Reason</th><th>Roster changes</th></tr></thead><tbody>${res.results.map(r => { const b = S.bids.find(x => x.id === r.bid); return `<tr><td>${r.round}</td><td>${esc(crewName(r.crewId))}</td><td>${esc(typeLabel(b))} ${esc(D.label(b.date))}</td><td>${badge(r.outcome, r.outcome === 'honored' ? 'ok' : 'bad')}</td><td><small>${esc(r.reason)}</small></td><td><small>${r.changes.map(c => `${esc(crewName(c.crewId))} ${esc(D.label(c.date))}: ${esc(c.from)}→${esc(c.to)}`).join('<br>') || '—'}</small></td></tr>`; }).join('')}</tbody></table></div></div>`;
  $('#acc', box).onclick = async () => { if (!(await confirm('Accept matches', `Apply ${res.results.filter(r => r.outcome === 'honored').length} honored bid(s) to the roster and notify everyone affected?`, 'Accept'))) return; applyBidAward(res); save(); toast('Award applied'); };
}
