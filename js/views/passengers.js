import { esc, T, csv, download } from '../util.js';
import { S, save, audit, can } from '../store.js';
import { paxHistory, routeText, tripStart } from '../trips.js';
import { $, $$, empty, badge, statusBadge, confirm } from '../ui.js';
import { paxForm } from './trips.js';

const ui = { q: '', known: 'all' };

export function render(el, param) {
  const edit = can('trips.edit');
  if (param) { const p = S.passengers.find(x => x.id === param); if (p) return detail(el, p, edit); }
  const q = ui.q.toLowerCase();
  const list = S.passengers.filter(p => (ui.known === 'all' || (ui.known === 'known') === !!p.known) && (!q || `${p.name} ${p.company} ${p.email} ${p.notes}`.toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name));
  el.innerHTML = `<div class="page-head"><div><h1>Passengers</h1><p>Passenger database with known-passenger quick selection, preferences and trip history. Fictional records.</p></div><div class="actions">${edit ? '<button class="btn primary" data-a="new">New passenger</button>' : ''}<button class="btn ghost" data-a="csv">Export CSV</button></div></div>
  <div class="row" style="margin-bottom:10px"><input id="pq" placeholder="Search name, company, notes" value="${esc(ui.q)}" style="max-width:300px" aria-label="Search passengers"><select id="pk" style="width:auto" aria-label="Known filter"><option value="all">All</option><option value="known" ${ui.known === 'known' ? 'selected' : ''}>Known only</option><option value="other" ${ui.known === 'other' ? 'selected' : ''}>Not known</option></select></div>
  ${list.length ? `<div class="card flush"><div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Company</th><th>Contact</th><th>Notes</th><th class="num">Trips</th><th></th></tr></thead><tbody>${list.map(p => `<tr><td><a href="#/passengers/${p.id}"><strong>${esc(p.name)}</strong></a> ${p.known ? badge('Known', 'ok') : ''}</td><td>${esc(p.company)}</td><td><small>${esc(p.email)}<br>${esc(p.phone)}</small></td><td><small>${esc(p.notes)}</small></td><td class="num">${paxHistory(p.id).length}</td><td>${edit ? `<button class="btn sm ghost" data-a="edit" data-id="${p.id}">Edit</button>` : ''}</td></tr>`).join('')}</tbody></table></div></div>` : empty('No passengers match.')}`;
  $('#pq', el).oninput = e => { ui.q = e.target.value; render(el); const n = $('#pq', el); n.focus(); n.setSelectionRange(ui.q.length, ui.q.length); };
  $('#pk', el).onchange = e => { ui.known = e.target.value; render(el); };
  el.onclick = async e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'new') paxForm();
    if (b.dataset.a === 'edit') paxForm(S.passengers.find(p => p.id === b.dataset.id));
    if (b.dataset.a === 'csv') download('passengers.csv', csv([['Name', 'Company', 'Email', 'Phone', 'Known', 'Notes', 'Trips'], ...S.passengers.map(p => [p.name, p.company, p.email, p.phone, p.known ? 'yes' : 'no', p.notes, paxHistory(p.id).length])]));
  };
}

function detail(el, p, edit) {
  const hist = paxHistory(p.id).sort((a, b) => (tripStart(b) || '').localeCompare(tripStart(a) || ''));
  el.innerHTML = `<div class="page-head"><div><a href="#/passengers" class="muted">← Passengers</a><h1>${esc(p.name)} ${p.known ? badge('Known', 'ok') : ''}</h1><p>${esc(p.company)}</p></div><div class="actions">${edit ? `<button class="btn" data-a="edit">Edit</button>${hist.length ? '' : '<button class="btn danger" data-a="del">Delete</button>'}` : ''}</div></div>
  <div class="grid g2"><div class="card"><h2>Details</h2><p><strong>Email:</strong> ${esc(p.email) || '—'}<br><strong>Phone:</strong> ${esc(p.phone) || '—'}<br><strong>Weight:</strong> ${p.weight ? esc(p.weight) + ' lb' : '—'}</p><p><strong>Preferences / notes:</strong> ${esc(p.notes) || '—'}</p></div>
  <div class="card"><h2>Trip history (${hist.length})</h2>${hist.length ? `<table><thead><tr><th>Trip</th><th>Date</th><th>Route</th><th>Status</th><th>Role</th></tr></thead><tbody>${hist.map(t => `<tr><td><a href="#/trips/${t.id}">${esc(t.number)}</a></td><td>${esc(T.short(tripStart(t)))}</td><td>${esc(routeText(t))}</td><td>${statusBadge(t.status)}</td><td>${t.hitchhikers.includes(p.id) ? 'Hitchhiker' : 'Passenger'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No trips yet.</p>'}</div></div>`;
  el.onclick = async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'edit') paxForm(p);
    if (a === 'del' && await confirm('Delete passenger', `Delete ${esc(p.name)}?`, 'Delete', 'danger')) { S.passengers = S.passengers.filter(x => x.id !== p.id); audit('Passenger deleted', p.name); save(); location.hash = '#/passengers'; }
  };
}
