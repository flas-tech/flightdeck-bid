import { esc, D, T, csv, download, money, hrs, sum, round1 } from '../util.js';
import { S, can, save, audit, TODAY, crewName, acById, tripById } from '../store.js';
import { tripStart, routeText, manifest, tripFlight, tripBlock, tripCosts } from '../trips.js';
import { $, $$, empty, badge, statusBadge, tabs, toast, sel } from '../ui.js';
import { printDoc } from './common.js';

const INV = ['Not invoiced', 'Ready to invoice', 'Invoiced', 'Paid'];
const ui = { f: 'all', from: D.add(TODAY, -60), to: D.add(TODAY, 30) };
const invKind = s => ({ 'Not invoiced': 'muted', 'Ready to invoice': 'warn', Invoiced: 'info', Paid: 'ok' }[s]);

export function render(el, param) {
  if (param === 'reports') return reports(el);
  if (param) { const t = tripById(param); if (t) return detail(el, t); }
  const rows = S.trips.filter(t => t.status !== 'Draft').filter(t => ui.f === 'all' || (ui.f === 'flag' ? t.billingFlag : ui.f === 'open' ? t.status === 'Completed' && t.billing.invoiceStatus !== 'Paid' : t.billing.invoiceStatus === ui.f)).sort((a, b) => (tripStart(b) || '').localeCompare(tripStart(a) || ''));
  el.innerHTML = `<div class="page-head"><div><h1>Accounting records</h1><p>Every trip produces a record. Operational data is read-only here and frozen at completion; Accounting edits billing fields, costs and invoice status.</p></div><div class="actions"><a class="btn" href="#/accounting/reports">Period reports</a><button class="btn ghost" data-a="csv">Export CSV</button></div></div>
  ${tabs([['all', 'All'], ['flag', `Billing flags (${S.trips.filter(t => t.billingFlag).length})`], ['open', 'Completed, unpaid'], ...INV.map(s => [s, s])], ui.f)}
  ${rows.length ? `<div class="card flush"><div class="tbl-wrap"><table><thead><tr><th>Trip</th><th>Date</th><th>Route</th><th>Client / cost center</th><th>Status</th><th class="num">Flight h</th><th class="num">Costs</th><th>Invoice</th></tr></thead><tbody>${rows.map(t => `<tr><td><a href="#/accounting/${t.id}"><strong>${esc(t.number)}</strong></a> ${t.billingFlag ? badge('Billing flag', 'bad') : ''}</td><td>${esc(T.short(tripStart(t)))}</td><td>${esc(routeText(t))}</td><td>${esc(t.billing.client || '—')}<br><small>${esc(t.billing.costCenter)} ${esc(t.billing.code)}</small></td><td>${statusBadge(t.status)}</td><td class="num">${hrs(tripFlight(t, t.status === 'Completed'))}</td><td class="num">${money(tripCosts(t))}</td><td>${badge(t.billing.invoiceStatus, invKind(t.billing.invoiceStatus))}</td></tr>`).join('')}</tbody></table></div></div>` : empty('No records in this view.')}`;
  $$('[data-tab]', el).forEach(b => b.onclick = () => { ui.f = b.dataset.tab; render(el); });
  el.onclick = e => { if (e.target.closest('[data-a="csv"]')) exportCsv(rows, 'accounting-records.csv'); };
}

function exportCsv(rows, name) {
  download(name, csv([['Trip', 'Status', 'Start', 'Route', 'Aircraft', 'PIC', 'SIC', 'Pax', 'Flight h', 'Block h', 'Client', 'Cost center', 'Code', 'Fuel', 'Landing', 'Catering', 'Crew', 'Other', 'Total cost', 'Invoice status', 'Invoice #', 'Billing flag'],
    ...rows.map(t => { const c = t.billing.costs; const done = t.status === 'Completed'; return [t.number, t.status, tripStart(t), routeText(t), acById(t.tail)?.tail || '', crewName(t.crew.pic), crewName(t.crew.sic), t.paxCount, tripFlight(t, done), tripBlock(t, done), t.billing.client, t.billing.costCenter, t.billing.code, c.fuel, c.landing, c.catering, c.crew, c.other, tripCosts(t), t.billing.invoiceStatus, t.billing.invoiceNo, t.billingFlag ? 'yes' : '']; })]));
}

function detail(el, t) {
  const ed = can('acct.edit'); const b = t.billing; const done = t.status === 'Completed'; const ac = acById(t.tail); const mf = manifest(t);
  const f = (k, label, v, type = 'text') => `<label class="field"><span>${label}</span><input data-b="${k}" type="${type}" ${type === 'number' ? 'step="0.01" min="0"' : ''} value="${esc(v)}" ${ed ? '' : 'disabled'}></label>`;
  const itin = `<table><thead><tr><th>#</th><th>City pair</th><th>${done ? 'Actual out / in' : 'Planned'}</th><th class="num">Flight</th><th class="num">Block</th><th class="num">Pax</th></tr></thead><tbody>${t.legs.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.from)} → ${esc(l.to)}</td><td>${esc(T.short(done ? l.depAct : l.dep))} – ${esc(T.hm(done ? l.arrAct : l.arr))}</td><td class="num">${hrs(done ? l.flightAct : T.hours(l.dep, l.arr))}</td><td class="num">${hrs(done ? l.blockAct : T.hours(l.dep, l.arr) + 0.3)}</td><td class="num">${done ? l.paxAct : l.pax}</td></tr>`).join('')}<tr><td colspan="3"><strong>Total</strong></td><td class="num"><strong>${hrs(tripFlight(t, done))}</strong></td><td class="num"><strong>${hrs(tripBlock(t, done))}</strong></td><td></td></tr></tbody></table>`;
  el.innerHTML = `<div class="page-head"><div><a href="#/accounting" class="muted">← Accounting records</a><h1>${esc(t.number)} accounting record</h1><p>${statusBadge(t.status)} ${t.frozen ? badge('Operational record frozen', 'info') : badge('Live — may still change', 'warn')} ${t.billingFlag ? badge('Billing impact flagged', 'bad') : ''}</p></div>
    <div class="actions">${ed && t.billingFlag ? '<button class="btn" data-a="clear">Mark billing flag reviewed</button>' : ''}<button class="btn" data-a="print">Print invoice / record</button><button class="btn ghost" data-a="csv">CSV</button>${can('trips.view') && can('trips.edit') ? `<a class="btn ghost" href="#/trips/${t.id}">Open trip</a>` : ''}</div></div>
    ${!ed ? '<div class="alert info">Read-only. Only the Accounting role can edit billing fields.</div>' : ''}
    <div class="grid g2"><div class="card"><h2>Itinerary ${done ? '(final actuals)' : '(planned)'}</h2>${itin}<p><strong>Aircraft:</strong> ${esc(ac ? `${ac.tail} (${ac.type}, Part ${ac.part})` : '—')}<br><strong>Crew:</strong> PIC ${esc(crewName(t.crew.pic))} · SIC ${esc(crewName(t.crew.sic))}</p>
      <h3>Manifest</h3>${mf.length ? `<ul>${mf.map(p => `<li>${esc(p.name)} — ${esc(p.company)} (${esc(p.role)})</li>`).join('')}</ul>` : '<p class="muted">No named passengers.</p>'}<p class="muted">${t.paxCount} passenger(s) total.</p></div>
    <div class="card" id="bill"><h2>Billing</h2><div class="form-grid">${f('client', 'Client', b.client)}${f('costCenter', 'Cost center', b.costCenter)}${f('code', 'Billing code', b.code)}${f('invoiceNo', 'Invoice #', b.invoiceNo)}</div>
      <label class="field"><span>Invoice status</span>${sel('inv', INV, b.invoiceStatus, `data-b="invoiceStatus" ${ed ? '' : 'disabled'}`)}</label>
      <h3>Costs</h3><div class="form-grid">${['fuel', 'landing', 'catering', 'crew', 'other'].map(k => f('c_' + k, k[0].toUpperCase() + k.slice(1), b.costs[k], 'number')).join('')}</div><p><strong>Total costs: ${money(tripCosts(t))}</strong></p>
      <label class="field"><span>Billing notes</span><textarea data-b="notes" rows="2" ${ed ? '' : 'disabled'}>${esc(b.notes)}</textarea></label></div></div>
    <div class="grid g2"><div class="card"><h2>Status history</h2><ul class="notice-list">${t.history.map(h => `<li>${statusBadge(h.status)} ${esc(T.stamp(h.at))} · ${esc(h.by)}${h.note ? ` — ${esc(h.note)}` : ''}</li>`).join('')}</ul></div>
    <div class="card"><h2>Changes affecting billing</h2>${t.changes.length ? `<ul class="notice-list">${t.changes.map(c => `<li>${c.billingImpact ? badge('Billing', 'bad') : ''} <strong>${esc(c.type)}</strong> (${esc(c.reason)}) ${esc(c.detail)} <small>${esc(T.stamp(c.at))} · ${esc(c.by)}</small></li>`).join('')}</ul>` : '<p class="muted">No changes recorded.</p>'}</div></div>`;
  if (ed) $('#bill', el).onchange = e => {
    const k = e.target.dataset.b; if (!k) return; const v = e.target.value;
    if (k.startsWith('c_')) { const ck = k.slice(2); const old = b.costs[ck]; b.costs[ck] = Number(v) || 0; audit('Billing cost edited', `${t.number} ${ck}: ${old} → ${b.costs[ck]}`); }
    else { const old = b[k]; b[k] = v; audit('Billing field edited', `${t.number} ${k}: ${old || '—'} → ${v || '—'}`); if (k === 'invoiceStatus') t.history.push({ status: t.status, at: new Date().toISOString(), by: 'Accounting (demo)', note: `Invoice status → ${v}` }); }
    save(); toast('Saved');
  };
  el.onclick = e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'clear') { t.billingFlag = false; audit('Billing flag reviewed', t.number); save(); }
    if (a === 'csv') exportCsv([t], `${t.number}.csv`);
    if (a === 'print') printDoc(`${t.number} — trip record / invoice draft`, `<p><strong>Client:</strong> ${esc(b.client || '—')} · <strong>Cost center:</strong> ${esc(b.costCenter || '—')} · <strong>Code:</strong> ${esc(b.code || '—')} · <strong>Invoice:</strong> ${esc(b.invoiceNo || '—')} (${esc(b.invoiceStatus)})</p><p><strong>Aircraft:</strong> ${esc(ac?.tail || '—')} · <strong>PIC</strong> ${esc(crewName(t.crew.pic))} · <strong>SIC</strong> ${esc(crewName(t.crew.sic))}</p>${itin}<h3>Passengers</h3><p>${mf.map(p => esc(p.name)).join(', ') || '—'} (${t.paxCount} total)</p><h3>Costs</h3><table><tbody>${Object.entries(b.costs).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${money(v)}</td></tr>`).join('')}<tr><td><strong>Total</strong></td><td class="num"><strong>${money(tripCosts(t))}</strong></td></tr></tbody></table>`);
  };
}

function reports(el) {
  const inP = t => { const s = tripStart(t); return s && T.date(s) >= ui.from && T.date(s) <= ui.to; };
  const P = S.trips.filter(inP); const done = P.filter(t => t.status === 'Completed');
  const group = (key) => { const m = {}; for (const t of done) { const k = key(t) || '—'; (m[k] ||= { n: 0, h: 0, c: 0, pax: 0 }); m[k].n++; m[k].h += tripFlight(t, true); m[k].c += tripCosts(t); m[k].pax += sum(t.legs.map(l => l.paxAct ?? l.pax)); } return Object.entries(m).sort((a, b) => b[1].h - a[1].h); };
  const tbl = (title, rows, kl) => `<div class="card"><h2>${title}</h2>${rows.length ? `<table><thead><tr><th>${kl}</th><th class="num">Trips</th><th class="num">Flight h</th><th class="num">Pax (leg sum)</th><th class="num">Costs</th></tr></thead><tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.n}</td><td class="num">${hrs(v.h)}</td><td class="num">${v.pax}</td><td class="num">${money(v.c)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No completed trips in period.</p>'}</div>`;
  const cancelled = P.filter(t => t.status === 'Cancelled'); const drafts = S.trips.filter(t => t.status === 'Draft'); const outstanding = done.filter(t => t.billing.invoiceStatus !== 'Paid');
  el.innerHTML = `<div class="page-head"><div><a href="#/accounting" class="muted">← Accounting records</a><h1>Period reports</h1><p>Totals use final actuals for completed trips in the selected period.</p></div><div class="actions"><button class="btn ghost" data-a="csv">Export period CSV</button></div></div>
  <div class="row" style="margin-bottom:12px"><label class="field" style="margin:0"><span>From</span><input type="date" id="pf" value="${ui.from}"></label><label class="field" style="margin:0"><span>To</span><input type="date" id="pt" value="${ui.to}"></label></div>
  <div class="kpis">${[['Completed trips', done.length], ['Flight hours', hrs(sum(done.map(t => tripFlight(t, true))))], ['Block hours', hrs(sum(done.map(t => tripBlock(t, true))))], ['Costs', money(sum(done.map(tripCosts)))], ['Cancelled', cancelled.length], ['Unpaid completed', outstanding.length]].map(([l, v]) => `<div class="kpi"><div class="kpi-l">${l}</div><div class="kpi-v">${v}</div></div>`).join('')}</div>
  <div class="grid g2">${tbl('By client', group(t => t.billing.client), 'Client')}${tbl('By cost center', group(t => t.billing.costCenter), 'Cost center')}${tbl('Hours by aircraft', group(t => acById(t.tail)?.tail), 'Aircraft')}
  <div class="card"><h2>Exceptions</h2><h3>Cancelled (${cancelled.length})</h3>${cancelled.length ? `<ul>${cancelled.map(t => `<li><a href="#/accounting/${t.id}">${esc(t.number)}</a> ${esc(routeText(t))} — ${esc(t.history[t.history.length - 1]?.note || '')}</li>`).join('')}</ul>` : '<p class="muted">None.</p>'}<h3>Outstanding drafts (${drafts.length})</h3>${drafts.length ? `<ul>${drafts.map(t => `<li>${esc(t.number)} ${esc(routeText(t))}</li>`).join('')}</ul>` : '<p class="muted">None.</p>'}<h3>Billing flags (${S.trips.filter(t => t.billingFlag).length})</h3></div></div>`;
  $('#pf', el).onchange = e => { ui.from = e.target.value; reports(el); };
  $('#pt', el).onchange = e => { ui.to = e.target.value; reports(el); };
  el.onclick = e => { if (e.target.closest('[data-a="csv"]')) exportCsv(P, `period-${ui.from}-to-${ui.to}.csv`); };
}
