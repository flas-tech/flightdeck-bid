// Duty/rest rule sets. Baselines transcribed from 14 CFR 135.265 / 135.267 (eCFR, current as reviewed Nov 2026).
// These are demonstration rule encodings; they have not been independently validated and are not legal advice.

export const PARAMS = [
  { key: 'flightPerDuty2p', label: 'Max flight time per duty / 24 h (two-pilot)', unit: 'h', dir: 'max' },
  { key: 'flightPerDuty1p', label: 'Max flight time per duty / 24 h (one-pilot)', unit: 'h', dir: 'max' },
  { key: 'maxDuty', label: 'Max duty period', unit: 'h', dir: 'max' },
  { key: 'minRest', label: 'Min rest before / after duty', unit: 'h', dir: 'min' },
  { key: 'quarterFlight', label: 'Max flight time per calendar quarter', unit: 'h', dir: 'max' },
  { key: 'twoQuarterFlight', label: 'Max flight time, two consecutive quarters', unit: 'h', dir: 'max' },
  { key: 'monthFlight', label: 'Max flight time per calendar month', unit: 'h', dir: 'max' },
  { key: 'sevenDayFlight', label: 'Max flight time in 7 consecutive days', unit: 'h', dir: 'max' },
  { key: 'yearFlight', label: 'Max flight time per calendar year', unit: 'h', dir: 'max' },
  { key: 'restPeriodsPerQuarter', label: '24-hour rest periods required per quarter', unit: 'count', dir: 'min' },
  { key: 'sevenDay24Rest', label: '24 consecutive hours free of duty in any 7 days (1 = required)', unit: 'flag', dir: 'min' },
  { key: 'reportBufferMin', label: 'Report buffer before first departure', unit: 'min', dir: 'min' },
  { key: 'releaseBufferMin', label: 'Release buffer after last arrival', unit: 'min', dir: 'min' },
  { key: 'maxConsecutiveDuty', label: 'Max consecutive duty days', unit: 'days', dir: 'max' },
];

// Regulatory values (null = not specified by that regulation; department policy only).
export const BASELINES = {
  '135.267': {
    name: 'Part 135 — unscheduled one- and two-pilot crews (14 CFR 135.267)',
    reg: { flightPerDuty2p: 10, flightPerDuty1p: 8, maxDuty: 14, minRest: 10, quarterFlight: 500, twoQuarterFlight: 800, yearFlight: 1400, restPeriodsPerQuarter: 13 },
    policy: { monthFlight: null, sevenDayFlight: null, sevenDay24Rest: 0, reportBufferMin: 60, releaseBufferMin: 30, maxConsecutiveDuty: 6 },
    cite: {
      flightPerDuty2p: '135.267(b)(2)', flightPerDuty1p: '135.267(b)(1)', maxDuty: '135.267(c)', minRest: '135.267(c)(1), (d)',
      quarterFlight: '135.267(a)(1)', twoQuarterFlight: '135.267(a)(2)', yearFlight: '135.267(a)(3)', restPeriodsPerQuarter: '135.267(f)',
    },
  },
  '135.265': {
    name: 'Part 135 — scheduled operations (14 CFR 135.265)',
    reg: { flightPerDuty2p: 8, flightPerDuty1p: 8, monthFlight: 120, sevenDayFlight: 34, yearFlight: 1200, minRest: 9, sevenDay24Rest: 1 },
    policy: { maxDuty: 14, quarterFlight: null, twoQuarterFlight: null, restPeriodsPerQuarter: null, reportBufferMin: 60, releaseBufferMin: 30, maxConsecutiveDuty: 6 },
    cite: {
      flightPerDuty2p: '135.265(a)(5)', flightPerDuty1p: '135.265(a)(4)', monthFlight: '135.265(a)(2)', sevenDayFlight: '135.265(a)(3)',
      yearFlight: '135.265(a)(1)', minRest: '135.265(b)(1) — 9/10/11 h tiered by scheduled flight time', sevenDay24Rest: '135.265(d)',
    },
  },
  '91': {
    name: 'Part 91 — department policy baseline (no Part 91 crew duty limits encoded)',
    reg: {},
    policy: { flightPerDuty2p: 10, flightPerDuty1p: 8, maxDuty: 14, minRest: 10, quarterFlight: null, twoQuarterFlight: null, monthFlight: null, sevenDayFlight: null, yearFlight: null, restPeriodsPerQuarter: null, sevenDay24Rest: 0, reportBufferMin: 60, releaseBufferMin: 30, maxConsecutiveDuty: 6 },
    cite: {},
  },
};

export function baselineParams(basis) {
  const b = BASELINES[basis];
  const out = {};
  for (const p of PARAMS) out[p.key] = b.reg[p.key] ?? b.policy[p.key] ?? null;
  return out;
}

export function makeRuleSet(id, basis, name) {
  return { id, basis, name: name || BASELINES[basis].name, version: 1, params: baselineParams(basis), updatedAt: new Date().toISOString(), updatedBy: 'System', history: [] };
}

// Returns list of params that are less stringent than the regulatory baseline.
export function relaxations(rs) {
  const reg = BASELINES[rs.basis]?.reg || {};
  const out = [];
  for (const p of PARAMS) {
    const base = reg[p.key];
    if (base == null) continue;
    const v = rs.params[p.key];
    if (v == null || v === '') { out.push({ ...p, base, value: 'disabled', cite: BASELINES[rs.basis].cite[p.key] }); continue; }
    if ((p.dir === 'max' && Number(v) > base) || (p.dir === 'min' && Number(v) < base)) out.push({ ...p, base, value: v, cite: BASELINES[rs.basis].cite[p.key] });
  }
  return out;
}

export function citeFor(rs, key) {
  const c = BASELINES[rs.basis]?.cite?.[key];
  return c ? `14 CFR ${c}` : 'Department policy';
}

// 135.265(b): rest required depends on scheduled flight time
export function requiredRest(rs, flightHrs) {
  const base = Number(rs.params.minRest) || 0;
  if (rs.basis !== '135.265') return base;
  // Department minRest sets the <8 h tier; higher tiers keep the regulatory +1 h / +2 h steps.
  const tier = flightHrs >= 9 ? 2 : flightHrs >= 8 ? 1 : 0;
  return base + tier;
}
