import { esc, D, csv, download } from '../util.js';
import { S, session, TODAY, crewName, activeCrew, tripsOn, can } from '../store.js';
import { fairnessSummary, rosterGaps, allCompliance, shortText, METHODS } from '../engine.js';
import { $, $$, tabs, empty, badge } from '../ui.js';
import { relaxBanner } from './common.js';

export function render(el, param) {
  const tab = param || 'fairness';
  const items = [['fairness', 'Fairness'], ['coverage', 'Coverage gaps'], ['currency', 'Currency'], ...(tripsOn() ? [['compliance', 'Duty / rest compliance']] : [])];
  el.innerHTML = `<div class="page-head"><div><h1>Reports & fairness</h1><p>Horizon ${esc(D.label(TODAY))} – ${esc(D.label(D.add(TODAY, S.dept.horizonDays - 1)))}. Award method: ${esc(METHODS[S.dept.bidMethod])}.</p></div><div class="actions"><button class="btn ghost" data-a="csv">Export CSV</button></div></div>${tabs(items, tab)}<div id="rb"></div>`;
  $$('[data-tab]', el).forEach(b => b.onclick = () => { location.hash = `#/reports/${b.dataset.tab}`; });
  const box = $('#rb', el); let rows = [];
  const mine = id => session.role === 'crew' && id === session.userId ? ' style="background:var(--info-bg)"' : '';
  if (tab === 'fairness') {
    const groups = S.dept.groups.map(g => g.name);
    box.innerHTML = groups.map(g => { const f = fairnessSummary(g); if (!f.rows.length) return '';
      rows.push(['Group', 'Crew', 'Seniority', 'Work', 'Standby', 'Off', 'Leave', 'Weekend work', 'Holiday work', 'Max streak', 'Trip days', 'Target', 'Delta', 'Bids honored', 'Bids total'], ...f.rows.map(r => [g, r.c.name, r.c.seniority, r.work, r.sb, r.off, r.leave, r.wk, r.hd, r.maxStreak, r.tripDays, r.target, r.delta, r.bidsHonored, r.bidsTotal]));
      return `<div class="card flush"><div class="card-head" style="padding:14px 16px 0"><h2>${esc(g)}</h2><div class="row"><span class="badge">Weekend σ ${f.wkSd}</span><span class="badge">Holiday σ ${f.hdSd}</span><span class="badge">Streak σ ${f.streakSd}</span><span class="badge">Target-delta σ ${f.deltaSd}</span></div></div><div class="tbl-wrap"><table><thead><tr><th>Crew</th><th class="num">Work</th><th class="num">SB</th><th class="num">Off</th><th class="num">Leave</th><th class="num">Wknd</th><th class="num">Hol</th><th class="num">Max streak</th><th class="num">Trip days</th><th class="num">Target Δ</th><th class="num">Bids</th></tr></thead><tbody>${f.rows.map(r => `<tr${mine(r.c.id)}><td>${esc(r.c.name)} <small>#${r.c.seniority}${r.c.contract ? ' · contract' : ''}</small></td><td class="num">${r.work}</td><td class="num">${r.sb}</td><td class="num">${r.off}</td><td class="num">${r.leave}</td><td class="num">${r.wk}</td><td class="num">${r.hd}</td><td class="num">${r.maxStreak}</td><td class="num">${r.tripDays}</td><td class="num" style="color:${Math.abs(r.delta) > 2 ? 'var(--warn)' : 'inherit'}">${r.delta > 0 ? '+' : ''}${r.delta}</td><td class="num">${r.bidsHonored}/${r.bidsTotal}</td></tr>`).join('')}</tbody></table></div></div>`; }).join('') + `<p class="muted">σ = standard deviation across the group (lower is more even). Fairness weights: target ${S.dept.fairness.target}, weekend ${S.dept.fairness.weekend}, holiday ${S.dept.fairness.holiday}, streak ${S.dept.fairness.streak}, preference ${S.dept.fairness.preference}.</p>`;
    if (!S.roster.generatedAt) box.innerHTML = empty('Generate a roster to see fairness.');
  }
  if (tab === 'coverage') {
    const gaps = rosterGaps(); rows = [['Date', 'Shortfall'], ...gaps.map(g => [g.date, shortText(g)])];
    box.innerHTML = gaps.length ? `<div class="card flush"><table><thead><tr><th>Date</th><th>Shortfall</th><th>Required slots</th></tr></thead><tbody>${gaps.map(g => `<tr><td>${esc(D.long(g.date))}</td><td>${badge(shortText(g), "bad")}</td><td>${g.slots}</td></tr>`).join('')}</tbody></table></div>` : `<div class="alert ok">${S.roster.generatedAt ? 'No coverage gaps across the horizon.' : 'No roster generated yet.'}</div>`;
  }
  if (tab === 'currency') {
    const list = activeCrew().flatMap(c => (c.currency || []).map(x => ({ c, ...x, days: D.diff(TODAY, x.expires) }))).sort((a, b) => a.days - b.days).filter(x => session.role !== 'crew' || x.c.id === session.userId);
    rows = [['Crew', 'Item', 'Type', 'Expires', 'Days'], ...list.map(x => [x.c.name, x.label, x.type || 'All', x.expires, x.days])];
    box.innerHTML = list.length ? `<div class="card flush"><table><thead><tr><th>Crew</th><th>Item</th><th>Applies to</th><th>Expires</th><th>Status</th></tr></thead><tbody>${list.map(x => `<tr${mine(x.c.id)}><td>${esc(x.c.name)}</td><td>${esc(x.label)}</td><td>${esc(x.type || 'All duty')}</td><td>${esc(D.label(x.expires))}</td><td>${x.days < 0 ? badge('Expired', 'bad') : x.days <= 30 ? badge(`${x.days} days`, 'warn') : badge(`${x.days} days`, 'ok')}</td></tr>`).join('')}</tbody></table></div><p class="muted">Expired items block assignment to the matching type (or all duty when no type is set).</p>` : empty('No currency items tracked.');
  }
  if (tab === 'compliance') {
    const list = allCompliance().filter(x => session.role !== 'crew' || x.crewId === session.userId);
    rows = [['Crew', 'Severity', 'Rule', 'Basis', 'Detail', 'Trips', 'Date', 'Rule set'], ...list.map(x => [crewName(x.crewId), x.severity, x.rule, x.basis, x.detail, x.trips.join(' '), x.date || '', x.ruleSet || ''])];
    box.innerHTML = `${can('configure') ? relaxBanner() : ''}<div class="alert info">Flags are computed from the configured rule sets against planned and actual trip times. Rule encodings are demonstrations, have not been independently validated, and are not legal advice.</div>${list.length ? `<div class="card flush"><div class="tbl-wrap"><table><thead><tr><th>Crew</th><th>Severity</th><th>Rule</th><th>Detail</th><th>Basis</th><th>Trips</th></tr></thead><tbody>${list.map(x => `<tr${mine(x.crewId)}><td>${esc(crewName(x.crewId))}</td><td>${badge(x.severity, x.severity === 'violation' ? 'bad' : 'warn')}</td><td>${esc(x.rule)}</td><td>${esc(x.detail)}</td><td><small>${esc(x.basis)}</small></td><td>${x.trips.map(n => { const t = S.trips.find(y => y.number === n); return t ? `<a href="#/trips/${t.id}">${esc(n)}</a>` : esc(n); }).join(' ')}</td></tr>`).join('')}</tbody></table></div></div>` : '<div class="alert ok">No duty/rest or currency flags.</div>'}`;
  }
  el.onclick = e => { if (e.target.closest('[data-a="csv"]')) { if (rows.length) download(`report-${tab}-${TODAY}.csv`, csv(rows)); } };
}
