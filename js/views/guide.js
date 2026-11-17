// Staffing & bidding guide: how each coverage model and award method works, with pros and cons.
import { esc } from '../util.js';
import { S, can } from '../store.js';
import { METHODS } from '../engine.js';

const COVERAGE = [
  { id: 'full', name: 'Full crews per aircraft', how: 'Every available aircraft gets a complete crew (for example a PIC and an SIC) on duty every day, whether or not a trip is booked.',
    pros: ['Always ready to launch', 'Simple to explain and check', 'No forecasting needed'],
    cons: ['Needs the most people', 'Crew sit on duty with nothing to fly', 'Hard to give generous time off'],
    best: 'Emergency medical, utility or helicopter operations, and owners who expect same-day lift on any day.' },
  { id: 'utilization', name: 'Utilization percentage', how: 'You set how busy the fleet usually is (for example 60%). Each day the app staffs that share of each aircraft type, rounded up, or the booked trips if that is more.',
    pros: ['Matches staffing to real demand', 'Frees more days off than full crews', 'Easy to tune as the fleet gets busier or quieter'],
    cons: ['Busy days above the average can run short', 'Depends on an honest utilization number'],
    best: 'Corporate departments with a steady, predictable flying pattern.' },
  { id: 'standby', name: 'Trips only plus standby', how: 'Crew are scheduled for booked trips only, plus a set number of standby crews per aircraft type to cover short-notice requests and sick calls.',
    pros: ['Leanest staffing', 'Most predictable days off', 'Clear standby rotation that crews can trade'],
    cons: ['Relies on trips being booked ahead', 'Two short-notice trips on one day can exhaust standby'],
    best: 'Charter (Part 135) operators, and one- or two-aircraft departments where trips are known days ahead.' },
  { id: 'hybrid', name: 'Hybrid — trips plus buffer', how: 'Takes the larger of booked trips or expected utilization, adds a buffer percentage on top, then adds standby crews.',
    pros: ['Covers booked trips and typical short-notice demand', 'Buffer is one number to adjust', 'Good default for mixed operations'],
    cons: ['Uses more crew days than standby alone', 'Two settings to tune instead of one'],
    best: 'Mixed Part 91 and 135 departments, and anyone not sure where to start.' },
];

const AWARD = [
  { id: 'seniority', how: 'Crew are ranked by seniority number. The most senior person’s first choice is awarded first, then the next person’s, and so on.',
    pros: ['Familiar and expected in many departments', 'Rewards years of service', 'Easy to audit — the order never surprises anyone'],
    cons: ['Junior crew rarely get holidays or popular weeks', 'Can feel unfair in a small team', 'New hires may leave over it'],
    best: 'Established departments and anyone with a seniority list in an employment agreement or union contract.' },
  { id: 'lottery', how: 'Crew are put in a random order for each bid period, and choices are awarded in that order. The order comes from a draw code (see below), so the same code always gives the same order and anyone can check it.',
    pros: ['Everyone has the same chance', 'Good for teams where seniority is close or not tracked', 'Transparent when the draw code is published'],
    cons: ['Someone can lose the draw several periods in a row', 'Feels arbitrary to senior crew', 'Must change the draw code each period'],
    best: 'New or small departments, contract-heavy pools, and teams that want equal odds.' },
  { id: 'rotating', how: 'Crew start in seniority order, and the first pick moves down the list by one place each bid period. Over a full cycle everyone gets a turn at first pick.',
    pros: ['Guaranteed fair over time', 'Predictable — crew know when their turn is coming', 'No randomness to explain'],
    cons: ['Fairness only shows over a full cycle', 'Someone must advance the rotation each period', 'Joiners and leavers shift the order'],
    best: 'Small teams of 2–15 who want turns at the best picks, such as holiday rotation.' },
  { id: 'points', how: 'The person whose requests have been honored least goes first. Each time a request is honored, that person moves back; each denial moves them forward. Seniority can break ties.',
    pros: ['Corrects itself — people who lost out recently go first', 'Rewards flexibility over time', 'Works with any team size'],
    cons: ['Harder to explain at first', 'Needs a few periods of history to settle', 'Crew may bid strategically'],
    best: 'Mid-size departments (10–50 pilots) that want fairness without strict seniority.' },
];

const PROFILES = [
  ['One aircraft, two pilots (Part 91)', 'Trips only plus standby, or utilization', 'Rotating priority', 'With two pilots, take turns at first pick; trades between the two matter more than the award order.'],
  ['Small corporate department (3–10 pilots)', 'Utilization or hybrid', 'Rotating priority or lottery', 'Equal turns keep a small team happy; add seniority as a tie-breaker if you have a list.'],
  ['Mid-size department (10–50 pilots, 4–20 aircraft)', 'Hybrid', 'Seniority or fairness points', 'Use priority tiers (for example vacation before personal days) and an absence cap so no week is left short.'],
  ['Charter / Part 135', 'Trips only plus standby, or hybrid', 'Seniority or fairness points', 'Duty and rest limits come first; standby crews per type cover short-notice charters.'],
  ['Helicopter, EMS or utility', 'Full crews per aircraft', 'Rotating priority or seniority', 'Readiness every day matters more than lean staffing.'],
  ['Mixed fixed-wing and helicopter', 'Hybrid', 'Any — set per department', 'Pilots qualified on several types are shared automatically; groups keep maintenance and dispatch coverage separate.'],
];

const list = (arr, cls) => `<ul class="pc ${cls}">${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
const method = (title, m, current) => `<div class="card guide-card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">${esc(title)}</h3>${current ? '<span class="badge ok">Your department</span>' : ''}</div><p>${esc(m.how)}</p>
  <div class="pc-grid"><div><strong>Pros</strong>${list(m.pros, 'pro')}</div><div><strong>Cons</strong>${list(m.cons, 'con')}</div></div><p class="muted" style="margin-bottom:0"><strong>Best for:</strong> ${esc(m.best)}</p></div>`;

export function render(el) {
  const cov = S.dept?.coverage?.model; const bm = S.dept?.bidMethod;
  el.innerHTML = `<div class="page-head"><div><h1>Staffing & bidding guide</h1><p>How Schedule Captain decides how many crew are needed each day, and who gets their time off or bid first. Every department picks its own combination${can('configure') ? ' under <a href="#/admin/coverage">Setup → Groups & coverage</a> and <a href="#/admin/bidding">Setup → Bidding & fairness</a>' : ''}.</p></div></div>
  <nav class="row guide-toc" aria-label="On this page"><a class="btn sm ghost" href="#g-cov">Coverage models</a><a class="btn sm ghost" href="#g-award">Award methods</a><a class="btn sm ghost" href="#g-lottery">Lottery draw code</a><a class="btn sm ghost" href="#g-extra">Rules that apply to every method</a><a class="btn sm ghost" href="#g-pick">Which fits you</a></nav>

  <h2 id="g-cov">1. Coverage models — how many crew are needed</h2>
  <p class="muted">The coverage model sets the minimum crew on duty for each aircraft type each day. The roster generator fills those seats first, then hands out days off. Maintenance, dispatch, scheduling and line groups use their own “minimum on duty” number instead.</p>
  <div class="guide-grid">${COVERAGE.map(m => method(m.name, m, m.id === cov)).join('')}</div>

  <h2 id="g-award">2. Award methods — who gets their request first</h2>
  <p class="muted">When more people ask for the same days than coverage allows, the award method decides the order. Requests are awarded in rounds: everyone’s first choice in method order, then everyone’s second choice, and so on.</p>
  <div class="guide-grid">${AWARD.map(m => method(METHODS[m.id], m, m.id === bm)).join('')}</div>

  <div class="card" id="g-lottery"><h2>The lottery draw code, explained</h2>
    <p>A computer can’t pull names from a hat, so it uses a <strong>draw code</strong> — any word or number, such as <code>2027-JAN</code> — to shuffle the crew list. The same code always produces the same order. That has two benefits:</p>
    <ul><li><strong>Anyone can check the draw.</strong> Post the code with the results, and any crew member can confirm the order wasn’t changed after the fact.</li><li><strong>Re-running the award is safe.</strong> If a scheduler previews the award twice, the order stays the same.</li></ul>
    <p>Use a new code for each bid period (for example the month, <code>2027-FEB</code>), or press <strong>New draw</strong> to generate one. Changing the code is the only way to get a new random order.</p></div>

  <div class="card" id="g-extra"><h2>Rules that apply to every method</h2>
    <ul>
      <li><strong>Priority tiers come first.</strong> Each time-off category has an award priority. For example, vacation (1) is awarded before personal days (2), whatever the crew order.</li>
      <li><strong>Coverage and hard rules are never broken.</strong> A request that would leave a seat or group short, exceed the absence cap, or break a duty/rest rule is held for review or denied.</li>
      <li><strong>Seniority tie-breaker (optional).</strong> Settles ties in fairness points.</li>
      <li><strong>Contract crew last (optional).</strong> Staff pilots are awarded before contract pilots.</li>
      <li><strong>Scheduler approval.</strong> Every award is a preview until a scheduler accepts it. You can compare all four methods on the same bids under Bids & swaps → Compare methods.</li>
      <li><strong>Prefer-off bids.</strong> Crew can ask for a specific day off without using a leave balance. These bids are awarded in rounds, in method order, only where coverage still holds after approved leave.</li>
    </ul></div>

  <div class="card flush" id="g-pick"><div style="padding:16px 16px 0"><h2 style="margin:0 0 4px">Which fits your operation</h2><p class="muted">Starting points only — every setting can be changed later, and you can compare methods on real bids before switching.</p></div>
    <div class="tbl-wrap"><table class="stack"><thead><tr><th>Operation</th><th>Coverage model</th><th>Award method</th><th>Why</th></tr></thead><tbody>${PROFILES.map(p => `<tr><td data-l="Operation"><strong>${esc(p[0])}</strong></td><td data-l="Coverage">${esc(p[1])}</td><td data-l="Award">${esc(p[2])}</td><td data-l="Why">${esc(p[3])}</td></tr>`).join('')}</tbody></table></div></div>
  <p class="muted">Guidance only. Schedule Captain is early-access software and not an approved scheduling or compliance system; confirm duty and rest limits with your operations specifications and principal operations inspector.</p>`;
  el.onclick = e => { const a = e.target.closest('.guide-toc a'); if (a) { e.preventDefault(); document.querySelector(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } };
}
