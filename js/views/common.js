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
  const p = $('#printArea'); p.innerHTML = `<h1>${esc(title)}</h1><p style="font-size:11px">${esc(S.dept.name)} · Generated ${esc(new Date().toLocaleString())} · Schedule Captain demonstration (fictional data)</p>${html}`;
  window.print();
}
export const who = id => esc(crewName(id));
export const dl = s => esc(D.label(s));

// ---------------------------------------------------------------- award method fields (shared by Setup and Bids)
const METHOD_HELP = {
  seniority: 'Most senior first. Familiar and easy to audit; junior crew rarely get the popular dates.',
  lottery: 'Random order each bid period. Everyone has the same chance.',
  rotating: 'First pick moves down the seniority list by one each period, so everyone gets a turn.',
  points: 'Whoever has had the fewest requests honored goes first. Corrects itself over time.',
};
export function awardMethodFields(METHODS, firstPick) {
  const m = S.dept.bidMethod;
  return `<div class="am"><label class="field"><span>Award method</span><select id="am-meth">${Object.entries(METHODS).map(([k, l]) => `<option value="${k}" ${k === m ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select><small>${esc(METHOD_HELP[m] || '')} <a href="#/guide">Compare methods</a></small></label>
  ${m === 'lottery' ? `<div class="field"><label for="am-seed"><span>Lottery draw code</span></label><div class="row nowrap"><input id="am-seed" value="${esc(S.dept.lotterySeed || '')}" maxlength="40"><button type="button" class="btn" data-am="draw">New draw</button></div><small>The draw code shuffles the crew list into a random order. The same code always gives the same order, so post it with the results and anyone can check the draw. Use a new code each bid period, for example the month. <a href="#/guide">More about the lottery</a></small></div>` : ''}
  ${m === 'rotating' ? `<div class="field"><span class="lbl">This period’s first pick</span><div class="row nowrap"><strong>${esc(firstPick || '—')}</strong><button type="button" class="btn sm" data-am="next">Advance to next period</button></div><small>Press Advance once at the start of each bid period so first pick moves to the next person. Position ${Number(S.dept.rotationIndex) || 0} in seniority order (0 = most senior).</small></div>` : ''}</div>`;
}
export function bindAwardMethod(box, { save, audit, METHODS, rerender }) {
  box.querySelector('#am-meth')?.addEventListener('change', e => { S.dept.bidMethod = e.target.value; audit('Bid method changed', METHODS[e.target.value]); save(); rerender?.(); });
  box.querySelector('#am-seed')?.addEventListener('change', e => { S.dept.lotterySeed = e.target.value.trim(); audit('Lottery draw code changed', S.dept.lotterySeed); save(); rerender?.(); });
  box.querySelectorAll('[data-am]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.am === 'draw') { const code = `${new Date().toISOString().slice(0, 7)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; S.dept.lotterySeed = code; audit('New lottery draw', code); }
    if (b.dataset.am === 'next') { S.dept.rotationIndex = (Number(S.dept.rotationIndex) || 0) + 1; audit('Rotation advanced', `Position ${S.dept.rotationIndex}`); }
    save(); rerender?.();
  }));
}
