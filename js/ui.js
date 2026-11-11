import { esc } from './util.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export function toast(msg, kind = 'ok') {
  const el = document.createElement('div'); el.className = `toast ${kind}`; el.setAttribute('role', 'status'); el.textContent = msg;
  $('#toasts').appendChild(el); setTimeout(() => el.classList.add('out'), 3200); setTimeout(() => el.remove(), 3700);
}

let modalResolve = null;
export function modal(title, body, { actions = [{ label: 'Close', value: null }], wide = false, onOpen } = {}) {
  const root = $('#modal');
  root.innerHTML = `<div class="modal-back" data-close></div><div class="modal-card ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="mtitle">
    <div class="modal-head"><h2 id="mtitle">${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">✕</button></div>
    <div class="modal-body">${body}</div>
    <div class="modal-foot">${actions.map((a, i) => `<button class="btn ${a.kind || (i === actions.length - 1 ? 'primary' : '')}" data-mval="${i}">${esc(a.label)}</button>`).join('')}</div></div>`;
  root.hidden = false; document.body.classList.add('modal-open');
  const card = $('.modal-card', root);
  setTimeout(() => ($('input,select,textarea', card) || $('[data-mval]', card))?.focus(), 30);
  if (onOpen) onOpen(card);
  return new Promise(res => {
    modalResolve = res;
    root.onclick = e => {
      if (e.target.closest('[data-close]')) return close(null);
      const b = e.target.closest('[data-mval]'); if (!b) return;
      const a = actions[Number(b.dataset.mval)];
      if (a.validate) { const err = a.validate(card); if (err) { const m = $('.modal-err', card) || card.querySelector('.modal-body').appendChild(Object.assign(document.createElement('p'), { className: 'modal-err' })); m.textContent = err; return; } }
      close(a.collect ? a.collect(card) : a.value);
    };
    root.onkeydown = e => { if (e.key === 'Escape') close(null); };
  });
}
export function close(v) { const root = $('#modal'); root.hidden = true; root.innerHTML = ''; document.body.classList.remove('modal-open'); if (modalResolve) { const r = modalResolve; modalResolve = null; r(v); } }

export async function justify(title, detail, required = true) {
  return modal(title, `<p>${detail}</p><label class="field"><span>Justification ${required ? '(required, logged)' : '(optional)'}</span><textarea id="jtext" rows="3"></textarea></label>`, {
    actions: [{ label: 'Cancel', value: null, kind: 'ghost' }, { label: 'Confirm', kind: 'primary', validate: c => required && !$('#jtext', c).value.trim() ? 'A justification is required.' : null, collect: c => $('#jtext', c).value.trim() || '(none)' }],
  });
}
export async function confirm(title, detail, label = 'Confirm', kind = 'primary') {
  return modal(title, `<p>${detail}</p>`, { actions: [{ label: 'Cancel', value: false, kind: 'ghost' }, { label, value: true, kind }] });
}

export const badge = (text, kind = '') => `<span class="badge ${kind}">${esc(text)}</span>`;
export const statusBadge = s => badge(s, { Draft: 'muted', Tentative: 'warn', Firm: 'ok', Cancelled: 'bad', Completed: 'info', pending: 'warn', approved: 'ok', denied: 'bad', cancelled: 'muted', open: 'warn', honored: 'ok', 'awaiting-partner': 'muted', proposed: 'warn', confirmed: 'ok', published: 'info', unassigned: 'muted', locked: 'info', draft: 'muted', rejected: 'bad' }[s] || '');
export function checksList(checks) {
  if (!checks?.length) return '';
  const icon = { ok: '✓', info: 'i', warn: '!', block: '✕' };
  return `<ul class="checks">${checks.map(c => `<li class="ck ${c.level}"><span class="ck-i" aria-hidden="true">${icon[c.level]}</span><span>${esc(c.text)}</span></li>`).join('')}</ul>`;
}
export function field(label, input, hint = '') { return `<label class="field"><span>${esc(label)}</span>${input}${hint ? `<small>${esc(hint)}</small>` : ''}</label>`; }
export function sel(name, options, value, attrs = '') {
  return `<select name="${name}" ${attrs}>${options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
}
export function inp(name, value = '', type = 'text', attrs = '') { return `<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}>`; }
export function formData(el) {
  const o = {};
  for (const f of $$('input,select,textarea', el)) { if (!f.name) continue; if (f.type === 'checkbox') o[f.name] = f.checked; else if (f.type === 'number') o[f.name] = f.value === '' ? null : Number(f.value); else o[f.name] = f.value; }
  return o;
}
export const empty = (text, cta = '') => `<div class="empty"><p>${esc(text)}</p>${cta}</div>`;
export function kpi(label, value, sub = '', kind = '') { return `<div class="kpi ${kind}"><div class="kpi-l">${esc(label)}</div><div class="kpi-v">${value}</div>${sub ? `<div class="kpi-s">${sub}</div>` : ''}</div>`; }
export function tabs(items, active, attr = 'data-tab') { return `<div class="tabs" role="tablist">${items.map(([k, l]) => `<button role="tab" class="tab ${k === active ? 'on' : ''}" ${attr}="${k}" aria-selected="${k === active}">${esc(l)}</button>`).join('')}</div>`; }
