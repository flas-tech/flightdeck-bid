import { esc, D } from '../util.js';
import { S, catByCode, crewName } from '../store.js';
import { relaxations } from '../rules.js';
import { $ } from '../ui.js';

export function relaxBanner() {
  const items = S.ruleSets.flatMap(rs => relaxations(rs).map(r => `${rs.name}: ${r.label} set to ${r.value}${r.unit !== 'flag' && r.value !== 'disabled' ? ' ' + r.unit : ''} (regulatory ${r.base}, ${r.cite})`));
  if (!items.length) return '';
  return `<div class="alert bad" role="alert"><strong>Persistent compliance warning:</strong> ${items.length} rule parameter(s) are less stringent than the regulatory baseline. These remain flagged and audited until restored or approved by management.<ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`;
}
export function unresolvedBanner() {
  if (!S.dept.unresolved?.length) return '';
  return `<div class="alert warn"><strong>Needs department confirmation (${S.dept.unresolved.length}):</strong> these preset details are visible settings, not assumed policy.<ul>${S.dept.unresolved.map(u => `<li>${esc(u)}</li>`).join('')}</ul></div>`;
}
export function codeStyle(code) {
  if (code === 'W') return { cls: 'c-W', style: '' };
  if (code === 'SB') return { cls: 'c-SB', style: '' };
  if (code === 'OBS') return { cls: 'c-OBS', style: '' };
  if (!code || code === S.dept.offCode) return { cls: 'c-off', style: '' };
  const cat = catByCode(code); return { cls: '', style: cat ? `background:${cat.color};color:#fff` : '' };
}
export function codeLabel(code) {
  if (code === 'W') return 'On duty / available'; if (code === 'SB') return 'Standby'; if (code === 'OBS') return 'Line-check observer (work day)'; if (code === S.dept.offCode) return `Day off (${code})`;
  return catByCode(code)?.name || code || '—';
}
export function legend() {
  const items = [['W', 'Work / available'], ['SB', 'Standby'], ['OBS', 'Line-check observer (work day, not in coverage pool)'], [S.dept.offCode, `Day off (${S.dept.offCode})`], ...S.categories.map(c => [c.code, c.name])];
  return `<div class="legend">${items.map(([c, l]) => { const s = codeStyle(c); return `<span><i class="${s.cls}" style="${s.style}"></i>${esc(c)} — ${esc(l)}</span>`; }).join('')}<span><i style="box-shadow:inset 0 -4px 0 var(--accent);background:var(--W)"></i>Trip assigned</span></div>`;
}
export function crewOpts(list, value, blank = '') { return `${blank ? `<option value="">${esc(blank)}</option>` : ''}${list.map(c => `<option value="${c.id}" ${c.id === value ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`; }
export function printDoc(title, html) {
  const p = $('#printArea'); p.innerHTML = `<h1>${esc(title)}</h1><p style="font-size:11px">${esc(S.dept.name)} · Generated ${esc(new Date().toLocaleString())} · FlightDeck Bid demonstration (fictional data)</p>${html}`;
  window.print();
}
export const who = id => esc(crewName(id));
export const dl = s => esc(D.label(s));
