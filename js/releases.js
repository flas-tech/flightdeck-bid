// Version tracking and release notes ("What's new").
export const APP_VERSION = '1.4.0';
export const RELEASES = [
  { v: '1.4.0', d: '2026-11-16', t: 'Departments, invites and user classes', items: [
    'Create your department from the start screen. You become its department admin. Free during the beta.',
    'Invite people from the new Members page: choose their class (Department admin, Scheduler, Management, Accounting or Crew), link crew to their crew profile, then copy or email the invite link. Links expire after 14 days.',
    'Everyone in a department now works from the same shared schedule. Changes save online automatically, and other members see them within about 20 seconds.',
    'Crew members enter with their own crew view. Department admins can still view the app as any role to check what others see.',
    'You can belong to more than one department and switch between them from the start screen. Leave a department from Account.',
  ] },
  { v: '1.3.0', d: '2026-11-16', t: 'Your own department, saved to your account', items: [
    'Schedule Captain now lives at schedulecaptain.com.',
    'Sign in to get started. New accounts begin with the guided setup for your own department, and everything you set up is saved to your account.',
    'Sample departments are now reserved for the Schedule Captain team, who use them for demos and support.',
    'Change your password any time from Account.',
  ] },
  { v: '1.2.0', d: '2026-11-16', t: 'Schedule Captain: accounts, feedback and What’s new', items: [
    'FlightDeck Bid is now Schedule Captain.',
    'Create a free account or log in from the start screen. Signed-in users get their demo department saved to their account, so they can pick up where they left off on another device. Guests can still try everything without an account.',
    'Send feedback: the Send feedback button at the top of every page sends an idea, problem or question straight to the Schedule Captain team, with the page you were on and the app version. Your messages, their status and any reply are listed on the same page.',
    'What’s new: after each update, a pop-up lists what changed. Every release is listed under What’s new in the menu.',
  ] },
  { v: '1.1.1', d: '2026-11-11', t: 'Buttons respond again', items: [
    'Fixed a problem where a hidden layer covered the page, so buttons and links did not respond to clicks or taps.',
  ] },
  { v: '1.1.0', d: '2026-11-11', t: 'Line-check observers', items: [
    'Flag crew as Standards Captain / Check Airman or Peer Observer, then add an optional observer to any trip or calendar day.',
    'An observation day counts as a flight work day, and the observer leaves the available pool for coverage, time-off checks, bids and swaps.',
    'Lock & match fills a requested observer seat. Adding or removing an observer after lock goes through the disruption workflow and is audited.',
    'New Line checks page and an Observer utilization report. Accounting records and invoices list the observer.',
  ] },
  { v: '1.0.0', d: '2026-11-10', t: 'First release', items: [
    'Crew availability, time off, bids and swaps with seniority, lottery, rotation and points award methods.',
    'Optional trip scheduling with a trip builder, lock & match, suggestions and disruptions, plus optional accounting records.',
    'Rule sets for Part 135 and Part 91 department policy, exceptions, notifications and a full audit trail.',
  ] },
];
export const cmpVer = (a, b) => { const x = String(a || '0').split('.').map(Number), y = String(b || '0').split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
const SEEN = 'sc_seen_ver';
export const seenVer = () => localStorage.getItem(SEEN);
export const markSeen = () => localStorage.setItem(SEEN, APP_VERSION);
// First-time visitors see the latest release only.
export function unseen() { const s = seenVer(); return s ? RELEASES.filter(r => cmpVer(r.v, s) > 0) : RELEASES.slice(0, 1); }
