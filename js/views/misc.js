import { esc, T, csv, download } from '../util.js';
import { S, session, can, save, audit, myNotifications, ROLES } from '../store.js';
import { $, $$, empty, badge, statusBadge, tabs, justify, toast } from '../ui.js';

export const notifications = {
  render(el) {
    const list = myNotifications();
    el.innerHTML = `<div class="page-head"><div><h1>Notifications</h1><p>In-app notices for ${esc(session.role === 'crew' ? 'you' : ROLES[session.role].label)}. A production version would also send email or push.</p></div><div class="actions">${list.some(n => !n.read) ? '<button class="btn" data-a="all">Mark all read</button>' : ''}</div></div>
    ${list.length ? `<div class="list">${list.slice(0, 200).map(n => `<div class="item" style="${n.read ? 'opacity:.7' : 'border-left:3px solid var(--brand)'}"><div class="item-head"><div>${n.read ? '' : badge('New', 'info') + ' '}${esc(n.text)}</div><div class="row"><small class="muted">${esc(T.stamp(n.at))}</small>${n.link ? `<a class="btn sm" href="${esc(n.link)}" data-open="${n.id}">Open</a>` : ''}${n.read ? '' : `<button class="btn sm ghost" data-r="${n.id}">Mark read</button>`}</div></div></div>`).join('')}</div>` : empty('No notifications.')}`;
    el.onclick = e => {
      if (e.target.closest('[data-a="all"]')) { list.forEach(n => n.read = true); save(); }
      const r = e.target.closest('[data-r]') || e.target.closest('[data-open]'); if (r) { const n = list.find(x => x.id === (r.dataset.r || r.dataset.open)); if (n && !n.read) { n.read = true; if (r.dataset.r) save(); else setTimeout(save, 0); } }
    };
  },
};

const xui = { tab: 'pending' };
export const exceptions = {
  render(el) {
    const approve = can('exceptions.approve');
    const list = S.exceptions.filter(x => xui.tab === 'all' || x.status === xui.tab);
    el.innerHTML = `<div class="page-head"><div><h1>Exceptions</h1><p>Overrides of hard rules and less-stringent rule settings. Each carries a justification and needs management approval.${approve ? '' : ' You are viewing as scheduler — switch to Management to approve or reject.'}</p></div></div>
    ${tabs([['pending', `Pending (${S.exceptions.filter(x => x.status === 'pending').length})`], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']], xui.tab)}
    ${list.length ? `<div class="list">${list.map(x => `<div class="item"><div class="item-head"><div>${badge(x.kind)} <strong>${esc(x.detail)}</strong></div>${statusBadge(x.status)}</div><p style="margin:6px 0">Justification: “${esc(x.justification)}”</p><small class="muted">Raised by ${esc(x.by)} · ${esc(T.stamp(x.at))}${x.decidedBy ? ` · ${esc(x.status)} by ${esc(x.decidedBy)} ${esc(T.stamp(x.decidedAt))}${x.note ? ` — ${esc(x.note)}` : ''}` : ''}</small>${approve && x.status === 'pending' ? `<div class="row" style="margin-top:8px"><button class="btn sm primary" data-x="approved" data-id="${x.id}">Approve</button><button class="btn sm danger" data-x="rejected" data-id="${x.id}">Reject</button></div>` : ''}</div>`).join('')}</div>` : empty('Nothing here.')}`;
    $$('[data-tab]', el).forEach(b => b.onclick = () => { xui.tab = b.dataset.tab; exceptions.render(el); });
    el.onclick = async e => {
      const b = e.target.closest('[data-x]'); if (!b || !approve) return; const x = S.exceptions.find(y => y.id === b.dataset.id);
      const note = await justify(b.dataset.x === 'approved' ? 'Approve exception' : 'Reject exception', esc(x.detail), b.dataset.x === 'rejected'); if (note == null) return;
      x.status = b.dataset.x; x.decidedBy = 'Management (demo)'; x.decidedAt = new Date().toISOString(); x.note = note === '(none)' ? '' : note;
      audit(`Exception ${x.status}`, `${x.kind}: ${x.detail}`, null, x.note); save(); toast(`Exception ${x.status}`);
    };
  },
};

const aui = { q: '' };
export { auditTrail as audit };
const auditTrail = {
  render(el) {
    const q = aui.q.toLowerCase();
    const list = S.audit.filter(a => !q || `${a.actor} ${a.action} ${a.detail} ${a.justification}`.toLowerCase().includes(q));
    el.innerHTML = `<div class="page-head"><div><h1>Audit trail</h1><p>Every configuration change, approval, override, publish and disruption, with actor and justification. Append-only in this demo.</p></div><div class="actions"><button class="btn ghost" data-a="csv">Export CSV</button></div></div>
    <input id="aq" placeholder="Filter actor, action, detail" value="${esc(aui.q)}" style="max-width:340px;margin-bottom:10px" aria-label="Filter audit trail">
    <div class="card flush"><div class="tbl-wrap"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Detail</th><th>Justification</th></tr></thead><tbody>${list.slice(0, 400).map(a => `<tr><td><small>${esc(T.stamp(a.at))}</small></td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td><small>${esc(a.detail)}</small></td><td><small>${esc(a.justification)}</small></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No entries.</td></tr>'}</tbody></table></div></div>${list.length > 400 ? `<p class="muted">Showing 400 of ${list.length}; export CSV for all.</p>` : ''}`;
    $('#aq', el).oninput = e => { aui.q = e.target.value; auditTrail.render(el); const n = $('#aq', el); n.focus(); n.setSelectionRange(aui.q.length, aui.q.length); };
    el.onclick = e => { if (e.target.closest('[data-a="csv"]')) download('audit-trail.csv', csv([['At', 'Actor', 'Role', 'Action', 'Detail', 'Justification'], ...list.map(a => [a.at, a.actor, a.role, a.action, a.detail, a.justification])])); };
  },
};
