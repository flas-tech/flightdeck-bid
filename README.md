# Schedule Captain

(Formerly FlightDeck Bid.) A browser demo of a modular crew-availability, bidding and trip-scheduling system for small flight departments — from one aircraft and two pilots up to a 10–50 pilot, 4–20 aircraft Part 91, Part 135 or mixed operation.

> Demonstration only. All data is fictional. Department data is saved online and shared with the department's members. This is not an approved scheduling, regulatory-compliance or accounting system, and the rule encodings are not legal advice.

## Try it

Open [schedulecaptain.com](https://schedulecaptain.com), sign in, pick or create a department, then a preferred layout (calendar, staffing grid or dashboard). The chooser appears every time you sign in. Super admins also see the sample departments below:

| Scenario | What it shows |
|---|---|
| Sample mixed fleet | G280, two G550s and an AW139; 14 pilots plus maintenance and dispatch; Part 91 + 135; trips and accounting on |
| PDK pilot pool preset | 12 pilots, 5-pilot absence cap, VAC → D/A → PWO/O priorities, monthly PWO/O allotments, U-day rules; trips off |
| Small department | One aircraft, two pilots, Part 91 standby coverage |
| Blank setup | Empty department with the guided setup wizard |

Use **Setup & rules → Data** to reset, export or import the whole dataset as JSON.

## Departments, roles and invites

Three levels of access:

| Level | Who | Can do |
|---|---|---|
| Super admin | The Schedule Captain team (`app_admins`, two-factor required) | See every department and user, open a read-only support view, suspend a department, set its plan, read and answer feedback, use the sample departments |
| Department admin | Whoever creates the department, plus anyone they promote | Invite and remove members, assign user classes, link members to crew profiles, full setup and scheduling; can view the app as any role |
| User classes | Set per member by a department admin | Scheduler (setup, schedules, trips, approvals) · Management (scheduler rights plus exception approval) · Accounting (trip records, billing, invoices) · Crew member (own schedule, time off, bids, swaps — linked to a crew profile) |

- **Self-serve beta**: any signed-in user can create a department (up to 3 per person) and becomes its department admin. Each department has `plan` (beta, trial, active, comp) and `status` (active, suspended) fields so billing can be added later; creation can be locked down to invite-only before billing starts.
- **Invites**: on **Members**, a department admin enters an email and user class, then copies the invite link or opens it in their email app. The link works once, only for that email address, and expires after 14 days. Invitees create an account (email prefilled) or log in, and join automatically.
- **Shared saving**: everyone in a department works on the same online copy. Changes save automatically; other members pick them up within about 20 seconds. If two people save at the same moment, the second person gets the latest version and is asked to redo their change.
- A department always keeps at least one department admin. Members can leave a department from Account.

## Feedback and What's new

- **Send feedback**: the button at the top of every page sends an idea, problem or question with the page, role and app version. Senders see status and replies on the same page.
- **What's new**: after each update a pop-up lists what changed; every release is listed under What's new.
- **App feedback** (super admin): set a status and reply. Super admin access is claimed once with a single-use code from Account, and requires an authenticator app (two-factor) every session.

Backend: Supabase (Postgres with row-level security, Auth, one `signup` edge function). The browser only holds the public publishable key; admin rights are enforced in the database (`app_admins` plus a two-factor session).

## Run locally

No build step or dependencies.

```
python -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` through `file://` is not supported because the app uses ES modules.

## Features

### Crew availability (always on)
- 45-day rolling horizon with a configurable near-term lock window; draft → bidding → reviewed → locked → published workflow.
- Proposed roster generation that respects coverage models (seat-based for pilots, head-count for maintenance, dispatch and other groups), weekly off-day targets, maximum consecutive work days and training buffer days.
- Multi-type qualifications per person (for example G280 + G550, or fixed wing + helicopter) with no inferred eligibility for types that are not listed.
- Time-off requests with configurable categories, annual and monthly allotments, mutually exclusive categories in a month, a daily absence cap, immediate rule checks and an approval queue.
- Bids and swaps: prefer-off, prefer-work and partner swaps (partner must accept). Award methods: seniority, lottery, rotating priority and points, with a side-by-side method comparison and per-person fairness history.
- Staffing grid, calendar and dashboard layouts; CSV export and print.

### Trip scheduling (optional module)
- Guided trip builder with multi-leg itineraries, return-leg helper, aircraft or type preference, passengers and hitchhikers, priority and live entry validation.
- Continuous checking against crew availability; pre-lock suggestions; lock-and-match that proposes the best qualified, current, available crew without new duty or rest violations. Every proposal needs explicit scheduler approval.
- Disruptions (weather, maintenance, passenger change, crew sick and others) with impact evaluation, automatic accounting flags and a change log.
- Trip completion with actual times, which freezes the operational record.
- Passenger directory and trip history.

### Accounting (optional module)
- A record for every trip; operational fields are read-only, billing and cost fields are editable only by the Accounting role.
- Invoice status, billing flags, printable invoice, period reports and CSV export.

### Line-check observers
- Flag crew as Standards Captain / Check Airman or Peer Observer (Setup & rules → Crew, or Add several people).
- Add an optional observer to any trip (builder step 5 or the trip's crew panel), or to a calendar day on the Line checks page when the Trip module is off.
- Only flagged crew can be assigned. An observation day counts as a flight work day (work and fairness counters), and the observer is removed from the available pool for coverage, time-off checks, bids and swaps.
- Lock & match and trip suggestions treat the observer as a hard resource and show the coverage impact. Observer duty is checked against the trip's rule set; counting observed flight time toward limits is a department setting.
- Adding or removing an observer after lock or publish goes through the disruption workflow and is audited. Accounting records, invoices and CSVs list the observer; Reports → Observer utilization summarizes usage; crew see their own line checks.

### Rules, compliance and governance
- Rule sets per aircraft or operation: Part 135 unscheduled (14 CFR 135.267), Part 135 scheduled (14 CFR 135.265) and a Part 91 department-policy baseline with no Part 91 crew duty limits encoded.
- Stricter-than-baseline changes are allowed. Relaxing a regulatory baseline requires a written justification, raises a management exception and shows a persistent warning until resolved.
- Versioned rule history, override logging, exception approvals, notifications and a full audit trail.
- Reports: fairness, coverage, currency/expiring items and compliance.
- Admin: department profile, groups, aircraft and downtime, crew (simple forms with per-type qualification picks, training rows and allowances; add several people by typing rows or pasting from a spreadsheet), categories, coverage, bidding method and policies.

## Spec mapping

| Spec area | Where it lives |
|---|---|
| Phase 1 — crew availability core | Schedule, Time off, Bids & swaps, Setup & rules |
| Phase 2 — trip module | Trips (builder, suggestions, lock & match, disruptions), Passengers |
| Phase 3 — accounting | Accounting records and period reports |
| Line-check observers (all phases) | Line checks, trip crew panel and builder, disruptions, Reports → Observer utilization, Accounting |
| Cross-cutting — roles, rules, audit | Role chooser, rule sets, Exceptions, Audit trail, Reports |

## Known limits

- No password-reset email yet; contact the team to reset a password. Sign-up does not verify email ownership.
- Rate limits: 5 sign-ups per network per hour; 10 feedback messages per user per hour.

- Membership, user classes, invites and super admin rights are enforced in the database. Within a department, the finer permissions (for example, what a crew member can edit) are enforced by the app, because the department is stored as one shared document that every member can save.
- Invite links are copied or sent from your own email app; Schedule Captain does not send invite emails yet.
- Saving conflicts are resolved by reloading the latest version, not by merging changes.
- Duty and rest rules were transcribed from the eCFR ([14 CFR Part 135 Subpart F](https://www.ecfr.gov/current/title-14/chapter-I/subchapter-G/part-135/subpart-F)) for demonstration. They have not been validated by the FAA, an operator or counsel, and do not cover every provision, exception or operations specification.
- PDK policy codes (D/A, PWO, O, U) are kept as visible, editable settings rather than assumed meanings.
- The roster and matching engines are heuristics, not optimizers, and do not guarantee a feasible or fair outcome.
- Which crew are Standards Captains or Peer Observers is an open item for each department; the sample flags are fictional. Whether observer time counts toward flight-time limits depends on the operator and should be confirmed.
- During the beta, avoid entering sensitive employee, passenger or financial information.

## Structure

`index.html`, `styles.css`, and `js/` (vanilla ES modules): `store.js` state and permissions, `engine.js` roster/bidding/compliance, `trips.js` trip logic, `rules.js` rule baselines, `presets.js` scenarios, `views/` one module per screen. GitHub Pages deploys via `.github/workflows/pages.yml`.

## Staffing & bidding guide

Help → Staffing & bidding guide explains each coverage model (full, utilization, standby, hybrid) and award method (seniority, lottery draw, rotating, points) with pros, cons and best fit. The setup wizard runs department → aircraft → coverage & groups → categories → bidding → crew, so groups exist before crew are added.
