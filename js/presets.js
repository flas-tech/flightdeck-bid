// Demonstration scenarios. All people, tails, passengers and companies are fictional.
import { D, uid } from './util.js';
import { makeRuleSet } from './rules.js';

const HOLIDAYS = ['2026-11-26', '2026-11-27', '2026-12-24', '2026-12-25', '2026-12-31', '2027-01-01', '2027-01-18', '2027-02-15', '2027-05-31', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24', '2027-12-25'];

function baseDept(over = {}) {
  return {
    name: 'Demo Flight Department', mode: 'mixed', modules: { trips: true },
    horizonDays: 45, lockDays: 14, lockWeekday: 1,
    coverage: { model: 'hybrid', utilizationPct: 60, bufferPct: 25, standbyCrewsPerType: 0, picCanFillSic: true },
    fairness: { target: 3, weekend: 1.5, holiday: 2, streak: 1, preference: 4 },
    bidMethod: 'seniority', lotterySeed: 'FDB-2026', rotationIndex: 0, seniorityTieBreaker: true, contractLast: true, bidRounds: 3,
    offCode: 'OFF', maxConsecutiveWork: 6,
    weeklyOff: { min: 1, target: 2, definition: 'calendar' },
    absenceCap: { enabled: false, max: 5, group: 'Pilots', codes: ['VAC'] },
    exclusions: [], trainingBuffer: { enabled: true, placement: 'both', strength: 'preference' },
    holidays: [...HOLIDAYS], blackouts: [],
    groups: [{ name: 'Pilots', kind: 'seat' }],
    defaultRuleSet: { '91': 'rs91', '135': 'rs135' },
    unresolved: [], setupComplete: true, presetName: '',
    ...over,
  };
}

const C = (code, name, color, o = {}) => ({ code, name, color, unavailable: true, countsCap: false, balance: { period: 'year', amount: 0 }, requiresApproval: true, priority: 2, protected: true, training: false, confirmed: true, ...o });

function genericCategories() {
  return [
    C('VAC', 'Vacation', '#2f7d6d', { countsCap: true, balance: { period: 'year', amount: 20 }, priority: 1 }),
    C('PDO', 'Personal day off', '#6d5bd0', { countsCap: true, balance: { period: 'year', amount: 6 }, priority: 2 }),
    C('SICK', 'Sick', '#b54848', { balance: { period: 'year', amount: 10 }, requiresApproval: false, priority: 0 }),
    C('TRN', 'Training', '#b7791f', { balance: { period: 'none', amount: 0 }, priority: 1, training: true }),
  ];
}

function q(spec) { // "G280:PIC,G550:SIC"
  return spec.split(',').filter(Boolean).map(s => { const [type, seat] = s.trim().split(':'); return { type, seat }; });
}

function person(i, name, group, quals, extra = {}) {
  return {
    id: `c${i}`, name, empId: `E${String(100 + i)}`, group, seniority: i, hireDate: D.add('2026-01-01', -i * 240),
    quals: q(quals), currency: [], targetDays: 16, allot: {}, prefs: { weekendsOff: false, note: '' },
    status: 'active', contract: false, priorQuarterHrs: 60 + (i * 17) % 120, priorYearHrs: 300 + (i * 41) % 300, ...extra,
  };
}

function ruleSets(kinds) {
  const out = [];
  if (kinds.includes('135')) out.push(makeRuleSet('rs135', '135.267'));
  if (kinds.includes('135s')) out.push(makeRuleSet('rs135s', '135.265'));
  if (kinds.includes('91')) out.push(makeRuleSet('rs91', '91'));
  return out;
}

function shell(dept, extra) {
  return {
    schema: 3, scenario: extra.scenario, dept, ruleSets: extra.ruleSets, aircraft: extra.aircraft || [], crew: extra.crew || [], categories: extra.categories || genericCategories(),
    requests: [], bids: [], roster: { cells: {}, status: {}, generatedAt: null, lockedThrough: null, publishedThrough: null, period: 'draft' },
    passengers: [], trips: [], suggestions: [], disruptions: [], exceptions: [], audit: [], notifications: [], tripSeq: 1001, created: new Date().toISOString(),
  };
}

function req(s, crewId, code, start, end, status, note = '') {
  s.requests.push({ id: uid('rq'), crewId, code, start, end: end || start, note, status, created: new Date().toISOString(), decidedBy: status === 'approved' ? 'Seed data' : null, reason: '' });
}

// ---------------------------------------------------------------- Coastal mixed fleet
export function coastal(today) {
  const dept = baseDept({ name: 'Coastal Air Group — Flight Department', mode: 'mixed', presetName: 'Sample mixed fleet (Part 91 + Part 135)',
    groups: [{ name: 'Pilots', kind: 'seat' }, { name: 'Maintenance', kind: 'count', minOnDuty: 1 }, { name: 'Dispatch', kind: 'count', minOnDuty: 1 }] });
  const aircraft = [
    { id: 'a1', tail: 'N280CA', type: 'G280', part: '135', minCrew: 2, seats: 9, base: 'KJAX', status: 'active', notes: 'Charter certificate aircraft', ruleSetId: null, downtime: [] },
    { id: 'a2', tail: 'N550CA', type: 'G550', part: '91', minCrew: 2, seats: 14, base: 'KJAX', status: 'active', notes: 'Owner aircraft, Part 91', ruleSetId: null, downtime: [] },
    { id: 'a3', tail: 'N551CA', type: 'G550', part: '135', minCrew: 2, seats: 14, base: 'KJAX', status: 'active', notes: '', ruleSetId: null, downtime: [{ start: D.add(today, 9), end: D.add(today, 11), reason: 'Scheduled inspection' }] },
    { id: 'a4', tail: 'N139CA', type: 'AW139', part: '91', minCrew: 2, seats: 12, base: 'KCRG', status: 'active', notes: 'Helicopter', ruleSetId: null, downtime: [] },
  ];
  const P = [
    ['Dana Whitaker', 'G550:PIC,G280:PIC'], ['Marcus Hale', 'G550:PIC'], ['Priya Raman', 'G280:PIC,G550:SIC'], ['Tom Becker', 'G550:PIC'],
    ['Elena Fischer', 'G280:PIC'], ['Luis Ortega', 'AW139:PIC,G280:SIC'], ['Grace Kim', 'G550:SIC'], ['Owen Price', 'G280:SIC,G550:SIC'],
    ['Hannah Cole', 'AW139:PIC'], ['Ravi Patel', 'G550:SIC'], ['Jess Moreno', 'AW139:SIC'], ['Sam Duarte', 'G280:SIC'],
    ['Nora Blake', 'AW139:SIC,G280:SIC'], ['Ken Ito', 'G550:PIC,G550:SIC'],
  ];
  const crew = P.map(([n, qs], i) => person(i + 1, n, 'Pilots', qs));
  crew[13].contract = true; crew[13].targetDays = 10; crew[13].prefs.note = 'Contract pilot — used after staff';
  crew[2].prefs.weekendsOff = true; crew[6].targetDays = 14;
  crew[0].currency = [{ label: 'G550 recurrent', type: 'G550', expires: D.add(today, 120) }, { label: 'Medical (1st class)', type: null, expires: D.add(today, 22) }];
  crew[4].currency = [{ label: 'G280 recurrent', type: 'G280', expires: D.add(today, 18) }];
  crew[7].currency = [{ label: 'G550 SIC recurrent', type: 'G550', expires: D.add(today, -3) }];
  crew[8].currency = [{ label: 'AW139 recurrent', type: 'AW139', expires: D.add(today, 200) }];
  crew.push(person(20, 'Ari Novak', 'Maintenance', ''), person(21, 'Beth Lund', 'Maintenance', ''), person(22, 'Cal Ruiz', 'Maintenance', ''));
  crew.push(person(23, 'Dee Sloan', 'Dispatch', ''), person(24, 'Eli Varga', 'Dispatch', ''), person(25, 'Fay Moss', 'Dispatch', ''));
  for (const c of crew.filter(c => c.group !== 'Pilots')) { c.targetDays = 15; c.seniority = c.seniority - 19; }
  const s = shell(dept, { scenario: 'coastal', ruleSets: ruleSets(['135', '91', '135s']), aircraft, crew });
  req(s, 'c2', 'VAC', D.add(today, 5), D.add(today, 9), 'approved', 'Family trip');
  req(s, 'c5', 'TRN', D.add(today, 15), D.add(today, 17), 'approved', 'G280 recurrent — sim');
  req(s, 'c7', 'VAC', D.add(today, 20), D.add(today, 26), 'pending', 'Holiday travel');
  req(s, 'c4', 'VAC', D.add(today, 21), D.add(today, 24), 'pending');
  req(s, 'c1', 'PDO', D.add(today, 3), D.add(today, 3), 'pending', 'School event');
  req(s, 'c9', 'VAC', D.add(today, 70), D.add(today, 76), 'pending', 'Beyond horizon — future PTO');
  req(s, 'c20', 'VAC', D.add(today, 12), D.add(today, 14), 'approved');
  s.bids.push({ id: uid('bd'), crewId: 'c3', type: 'off', date: D.add(today, 18), rank: 1, note: 'Anniversary', status: 'open', created: new Date().toISOString() });
  s.bids.push({ id: uid('bd'), crewId: 'c6', type: 'off', date: D.add(today, 18), rank: 1, note: '', status: 'open', created: new Date().toISOString() });
  s.bids.push({ id: uid('bd'), crewId: 'c10', type: 'work', date: D.add(today, 25), rank: 1, note: 'Want extra day', status: 'open', created: new Date().toISOString() });
  s.bids.push({ id: uid('bd'), crewId: 'c12', type: 'off', date: D.add(today, 27), rank: 2, note: '', status: 'open', created: new Date().toISOString() });
  s.passengers = [
    ['Robert Lang', 'Lang Holdings', 'CEO. Prefers aft club seat.', true], ['Maria Lang', 'Lang Holdings', 'Gluten-free catering', true],
    ['Jordan Pike', 'Lang Holdings', 'CFO', true], ['Alicia Grant', 'Grant Ventures', 'Charter client', true],
    ['Peter Osei', 'Grant Ventures', '', false], ['Wen Zhou', 'Harbor Medical', 'Medical director', true],
    ['Chris Dalton', 'Harbor Medical', '', false], ['Laura Benn', 'Lang Holdings', 'Executive assistant', true],
    ['Miguel Santos', 'Santos Marine', 'Charter client — dog travels with him', true], ['Ivy Chen', 'Harbor Medical', '', false],
  ].map(([name, company, notes, known], i) => ({ id: `px${i + 1}`, name, company, notes, known, email: `${name.split(' ')[0].toLowerCase()}@example.com`, phone: `555-01${String(10 + i)}`, weight: 150 + (i * 13) % 60 }));
  const L = (from, to, dayOff, dep, hrs, pax) => { const d = `${D.add(today, dayOff)}T${dep}`; const arr = new Date(Date.parse(d + ':00Z') + hrs * 36e5).toISOString().slice(0, 16); return { id: uid('lg'), from, to, dep: d, arr, pax }; };
  const trip = (o) => s.trips.push({
    id: uid('tr'), number: `T-${s.tripSeq++}`, status: 'Firm', part: 'aircraft', ruleSetId: null, legs: [], paxIds: [], hitchhikers: [], paxCount: 0,
    flexible: false, flexHours: 0, hitchAllowed: false, aircraftPref: '', tail: '', special: '', priority: 'Normal', notes: '',
    billing: { client: '', costCenter: '', code: '', invoiceStatus: 'Not invoiced', invoiceNo: '', costs: { fuel: 0, landing: 0, catering: 0, crew: 0, other: 0 }, notes: '' },
    crew: { pic: null, sic: null }, assign: 'unassigned', history: [{ status: o.status || 'Firm', at: new Date().toISOString(), by: 'Seed data' }], changes: [], billingFlag: false, frozen: false, created: new Date().toISOString(), ...o,
  });
  // Completed trip in the past (accounting record)
  const done = [L('KJAX', 'KTEB', -6, '13:00', 2.3, 4), L('KTEB', 'KJAX', -4, '18:00', 2.5, 4)];
  done.forEach(l => { l.depAct = T(l.dep, 0.2); l.arrAct = T(l.arr, 0.25); l.flightAct = 2.4; l.blockAct = 2.7; l.paxAct = 4; });
  trip({ status: 'Completed', legs: done, tail: 'a1', aircraftPref: 'G280', paxIds: ['px1', 'px2', 'px3', 'px8'], paxCount: 4, crew: { pic: 'c1', sic: 'c3' }, assign: 'published', frozen: true,
    billing: { client: 'Lang Holdings', costCenter: 'CC-100 Executive', code: 'LH-2611', invoiceStatus: 'Ready', invoiceNo: '', costs: { fuel: 6840, landing: 425, catering: 310, crew: 690, other: 0 }, notes: '' },
    history: [{ status: 'Draft', at: D.add(today, -20) + 'T14:00:00Z', by: 'Seed data' }, { status: 'Firm', at: D.add(today, -15) + 'T10:00:00Z', by: 'Seed data' }, { status: 'Completed', at: D.add(today, -4) + 'T22:00:00Z', by: 'Seed data' }] });
  trip({ status: 'Cancelled', legs: [L('KJAX', 'KMIA', -2, '09:00', 1.1, 2)], tail: 'a2', aircraftPref: 'G550', paxIds: ['px6', 'px7'], paxCount: 2, billing: { client: 'Harbor Medical', costCenter: 'CC-300 Medical', code: 'HM-2611', invoiceStatus: 'Not invoiced', invoiceNo: '', costs: { fuel: 0, landing: 0, catering: 0, crew: 0, other: 350 }, notes: 'Late cancellation fee' } });
  trip({ status: 'Firm', legs: [L('KJAX', 'KTEB', 2, '08:00', 2.4, 3), L('KTEB', 'KJAX', 2, '17:30', 2.6, 3)], tail: 'a2', aircraftPref: 'G550', paxIds: ['px1', 'px3', 'px8'], paxCount: 3, priority: 'High', billing: { client: 'Lang Holdings', costCenter: 'CC-100 Executive', code: 'LH-2612', invoiceStatus: 'Not invoiced', invoiceNo: '', costs: { fuel: 0, landing: 0, catering: 0, crew: 0, other: 0 }, notes: '' } });
  trip({ status: 'Firm', legs: [L('KJAX', 'KASE', 4, '10:00', 4.3, 6), L('KASE', 'KJAX', 8, '12:00', 4.0, 6)], tail: 'a1', aircraftPref: 'G280', paxIds: ['px4', 'px5'], paxCount: 6, special: 'Ski equipment; hot catering', billing: { client: 'Grant Ventures', costCenter: 'CHARTER', code: 'GV-0042', invoiceStatus: 'Not invoiced', invoiceNo: '', costs: { fuel: 0, landing: 0, catering: 0, crew: 0, other: 0 }, notes: '' } });
  trip({ status: 'Tentative', flexible: true, flexHours: 24, legs: [L('KJAX', 'KATL', 6, '09:00', 1.2, 2)], aircraftPref: 'G550', tail: 'a3', paxIds: ['px6'], paxCount: 2, hitchAllowed: true, notes: 'Times flexible ±1 day', billing: { client: 'Harbor Medical', costCenter: 'CC-300 Medical', code: 'HM-2612', invoiceStatus: 'Not invoiced', invoiceNo: '', costs: { fuel: 0, landing: 0, catering: 0, crew: 0, other: 0 }, notes: '' } });
  trip({ status: 'Tentative', flexible: true, flexHours: 24, legs: [L('KJAX', 'KATL', 6, '14:00', 1.2, 2)], aircraftPref: 'G550', paxIds: ['px9'], paxCount: 2, hitchAllowed: true, notes: 'Could share with Harbor Medical ATL trip', billing: { client: 'Santos Marine', costCenter: 'CHARTER', code: 'SM-0007', invoiceStatus: 'Not invoiced', invoiceNo: '', costs: { fuel: 0, landing: 0, catering: 0, crew: 0, other: 0 }, notes: '' } });
  trip({ status: 'Firm', legs: [L('KJAX', 'KPBI', 10, '07:30', 1.0, 4), L('KPBI', 'KJAX', 10, '16:00', 1.0, 0)], tail: 'a3', aircraftPref: 'G550', paxIds: ['px1', 'px2'], paxCount: 4, hitchAllowed: true, notes: 'Return leg empty', billing: { client: 'Lang Holdings', costCenter: 'CC-100 Executive', code: 'LH-2613', invoiceStatus: 'Not invoiced', invoiceNo: '', costs: { fuel: 0, landing: 0, catering: 0, crew: 0, other: 0 }, notes: '' } });
  trip({ status: 'Draft', flexible: true, flexHours: 12, legs: [L('KPBI', 'KJAX', 10, '13:00', 1.0, 2)], aircraftPref: 'G550', paxIds: ['px10', 'px7'], paxCount: 2, notes: 'Harbor Medical staff need a ride home from Palm Beach', billing: { client: 'Harbor Medical', costCenter: 'CC-300 Medical', code: 'HM-2613', invoiceStatus: 'Not invoiced', invoiceNo: '', costs: { fuel: 0, landing: 0, catering: 0, crew: 0, other: 0 }, notes: '' } });
  trip({ status: 'Firm', legs: [L('KCRG', 'KSGJ', 3, '11:00', 0.6, 3), L('KSGJ', 'KCRG', 3, '15:00', 0.6, 3)], tail: 'a4', aircraftPref: 'AW139', paxIds: ['px9'], paxCount: 3, billing: { client: 'Santos Marine', costCenter: 'CHARTER', code: 'SM-0008', invoiceStatus: 'Not invoiced', invoiceNo: '', costs: { fuel: 0, landing: 0, catering: 0, crew: 0, other: 0 }, notes: '' } });
  trip({ status: 'Firm', legs: [L('KJAX', 'KHPN', 13, '06:00', 2.6, 5), L('KHPN', 'KBOS', 13, '12:00', 0.9, 5), L('KBOS', 'KJAX', 13, '19:30', 3.0, 5)], tail: 'a1', aircraftPref: 'G280', paxIds: ['px1', 'px3'], paxCount: 5, priority: 'High', notes: 'Long day — check duty', billing: { client: 'Lang Holdings', costCenter: 'CC-200 Board', code: 'LH-2614', invoiceStatus: 'Not invoiced', invoiceNo: '', costs: { fuel: 0, landing: 0, catering: 0, crew: 0, other: 0 }, notes: '' } });
  trip({ status: 'Tentative', legs: [L('KJAX', 'MYNN', 22, '10:00', 1.5, 6), L('MYNN', 'KJAX', 25, '15:00', 1.5, 6)], aircraftPref: 'G550', paxIds: ['px4'], paxCount: 6, billing: { client: 'Grant Ventures', costCenter: 'CHARTER', code: 'GV-0043', invoiceStatus: 'Not invoiced', invoiceNo: '', costs: { fuel: 0, landing: 0, catering: 0, crew: 0, other: 0 }, notes: '' } });
  trip({ status: 'Draft', legs: [L('KJAX', 'EGGW', 40, '20:00', 8.2, 4)], aircraftPref: 'G550', paxIds: [], paxCount: 4, notes: 'Owner considering London trip; passengers TBD', billing: { client: 'Lang Holdings', costCenter: 'CC-100 Executive', code: '', invoiceStatus: 'Not invoiced', invoiceNo: '', costs: { fuel: 0, landing: 0, catering: 0, crew: 0, other: 0 }, notes: '' } });
  return s;
}
function T(s, h) { return new Date(Date.parse(s + ':00Z') + h * 36e5).toISOString().slice(0, 16); }

// ---------------------------------------------------------------- PDK pilot pool
export function pdk(today) {
  const dept = baseDept({
    name: 'PDK Pilot Pool', mode: '91', presetName: 'PDK pilot pool preset', modules: { trips: false },
    offCode: 'U', coverage: { model: 'utilization', utilizationPct: 60, bufferPct: 25, standbyCrewsPerType: 0, picCanFillSic: true },
    absenceCap: { enabled: true, max: 5, group: 'Pilots', codes: ['VAC', 'PWO', 'O'] },
    exclusions: [{ a: 'PWO', b: 'VAC', scope: 'month' }],
    weeklyOff: { min: 1, target: 2, stretch: 3, definition: 'calendar', countsLeave: false },
    trainingBuffer: { enabled: true, placement: 'both', strength: 'preference' },
    defaultRuleSet: { '91': 'rs91', '135': 'rs91' },
    unresolved: [
      'Define what D, A, PWO, O and U mean and whether each makes a pilot unavailable',
      'Confirm whether the weekly U requirement uses a fixed calendar week or any rolling seven days',
      'Confirm the training buffer: one U day before, after, either side, or both',
      'Confirm whether D, A and U count toward the five-pilot absence cap',
      'Confirm whether unused PWO / O entitlements expire, carry forward or accumulate',
      'Confirm whether vacation spanning two months excludes PWO in both months',
      'Confirm whether an honored "prefer off" bid is coded U and counts toward the cap',
    ],
  });
  const categories = [
    C('VAC', 'Vacation', '#2f7d6d', { countsCap: true, balance: { period: 'year', amount: 20 }, priority: 1 }),
    C('D', 'D — meaning unconfirmed', '#4a6fa5', { priority: 2, balance: { period: 'none', amount: 0 }, confirmed: false }),
    C('A', 'A — meaning unconfirmed', '#5b8bb5', { priority: 2, balance: { period: 'none', amount: 0 }, confirmed: false }),
    C('PWO', 'PWO — meaning unconfirmed', '#8a4fa8', { countsCap: true, priority: 3, balance: { period: 'month', amount: 1 }, confirmed: false }),
    C('O', 'O — meaning unconfirmed', '#a8639a', { countsCap: true, priority: 3, balance: { period: 'month', amount: 2 }, confirmed: false }),
    C('TRN', 'Training', '#b7791f', { priority: 1, balance: { period: 'none', amount: 0 }, training: true }),
  ];
  const aircraft = [
    { id: 'a1', tail: 'N280PK', type: 'G280', part: '91', minCrew: 2, seats: 9, base: 'KPDK', status: 'active', notes: '', ruleSetId: null, downtime: [] },
    { id: 'a2', tail: 'N281PK', type: 'G280', part: '91', minCrew: 2, seats: 9, base: 'KPDK', status: 'active', notes: '', ruleSetId: null, downtime: [] },
    { id: 'a3', tail: 'N550PK', type: 'G550', part: '91', minCrew: 2, seats: 14, base: 'KPDK', status: 'active', notes: '', ruleSetId: null, downtime: [] },
  ];
  const quals = ['G280:PIC,G550:SIC', 'G550:PIC', 'G280:SIC', 'G280:PIC,G550:SIC', 'G550:PIC', 'G280:SIC', 'G280:PIC,G550:SIC', 'G550:PIC', 'G280:SIC', 'G280:PIC,G550:SIC', 'G550:PIC,G280:PIC', 'G550:SIC'];
  const crew = quals.map((qs, i) => person(i + 1, `Demo Pilot ${String(i + 1).padStart(2, '0')}`, 'Pilots', qs, { targetDays: 15 }));
  const s = shell(dept, { scenario: 'pdk', ruleSets: ruleSets(['91']), aircraft, crew, categories });
  req(s, 'c1', 'VAC', D.add(today, 8), D.add(today, 12), 'approved');
  req(s, 'c2', 'PWO', D.add(today, 10), D.add(today, 10), 'approved');
  req(s, 'c3', 'O', D.add(today, 10), D.add(today, 10), 'approved');
  req(s, 'c4', 'VAC', D.add(today, 10), D.add(today, 11), 'approved');
  req(s, 'c5', 'O', D.add(today, 10), D.add(today, 10), 'pending', 'Fifth counted absence on this date');
  req(s, 'c6', 'PWO', D.add(today, 10), D.add(today, 10), 'pending', 'Would be sixth counted absence');
  req(s, 'c7', 'TRN', D.add(today, 16), D.add(today, 18), 'approved', 'Recurrent — training buffer preference applies');
  req(s, 'c8', 'VAC', D.add(today, 24), D.add(today, 28), 'pending');
  req(s, 'c8', 'PWO', D.add(today, 20), D.add(today, 20), 'pending', 'Conflicts with PWO/VAC same-month exclusion if both in one month');
  req(s, 'c9', 'D', D.add(today, 14), D.add(today, 14), 'pending');
  s.bids.push({ id: uid('bd'), crewId: 'c10', type: 'off', date: D.add(today, 19), rank: 1, note: 'Prefer not to work — no leave used', status: 'open', created: new Date().toISOString() });
  s.bids.push({ id: uid('bd'), crewId: 'c11', type: 'off', date: D.add(today, 19), rank: 1, note: '', status: 'open', created: new Date().toISOString() });
  s.bids.push({ id: uid('bd'), crewId: 'c12', type: 'off', date: D.add(today, 19), rank: 1, note: '', status: 'open', created: new Date().toISOString() });
  return s;
}

// ---------------------------------------------------------------- Small: one aircraft, two pilots
export function small(today) {
  const dept = baseDept({ name: 'Single-Aircraft Department', mode: '91', presetName: 'Small department (1 aircraft, 2 pilots)',
    coverage: { model: 'standby', utilizationPct: 50, bufferPct: 0, standbyCrewsPerType: 0, picCanFillSic: true }, weeklyOff: { min: 1, target: 2, definition: 'calendar' },
    defaultRuleSet: { '91': 'rs91', '135': 'rs91' } });
  const aircraft = [{ id: 'a1', tail: 'N1CJ', type: 'CE525', part: '91', minCrew: 2, seats: 7, base: 'KCRG', status: 'active', notes: '', ruleSetId: null, downtime: [] }];
  const crew = [person(1, 'Alex Rivera', 'Pilots', 'CE525:PIC'), person(2, 'Jamie Brooks', 'Pilots', 'CE525:PIC,CE525:SIC')];
  crew.forEach(c => c.targetDays = 18);
  const s = shell(dept, { scenario: 'small', ruleSets: ruleSets(['91']), aircraft, crew });
  req(s, 'c2', 'VAC', D.add(today, 12), D.add(today, 16), 'approved');
  s.passengers = [{ id: 'px1', name: 'Owner (fictional)', company: 'Owner LLC', notes: '', known: true, email: 'owner@example.com', phone: '555-0100', weight: 180 }];
  return s;
}

export function blank(today) {
  const dept = baseDept({ name: 'New Flight Department', mode: '91', setupComplete: false, presetName: 'Blank setup', modules: { trips: false }, holidays: [...HOLIDAYS] });
  return shell(dept, { scenario: 'blank', ruleSets: ruleSets(['91', '135']), aircraft: [], crew: [] });
}

export const SCENARIOS = {
  coastal: { label: 'Sample mixed fleet', desc: '4 aircraft (G280, two G550s, AW139), 14 pilots plus maintenance and dispatch, Part 91 + 135, trips and accounting on.', build: coastal },
  pdk: { label: 'PDK pilot pool preset', desc: '12 pilots, 5-pilot absence cap, VAC → D/A → PWO/O priorities, monthly PWO/O, U-day rules. Trips module off.', build: pdk },
  small: { label: 'Small department', desc: 'One aircraft and two pilots, Part 91, standby coverage.', build: small },
  blank: { label: 'Blank setup', desc: 'Start empty and walk through department setup.', build: blank },
};
