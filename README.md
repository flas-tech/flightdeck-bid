# FlightDeck Bid

Initial, dependency-free browser scaffold for configurable flight-department bidding. Fictional PDK pool of 12 pilots. Not operational software.

## Run
Serve this directory using any static HTTP server, for example `python -m http.server 8000`, then open localhost:8000. Opening index.html directly via file:// is not supported because the preset is fetched.

## Implemented
- Interface chooser at every fresh page load and on simulated login; employee, scheduler and administrator roles.
- Calendar, request grid and summary dashboard.
- Fictional explicit G280/G550 qualifications; no inferred GIV eligibility.
- Pending requests, manual approval with a counted daily absence cap, removal and local persistence.
- Editable PDK JSON policy, local reset and JSON export.
- PDK vacation > D/A > PWO/O priority metadata, cap of five counting VAC/PWO/O, weekly U minimum 1 / target 2 / stretch 3, and unresolved training-buffer preference.

## Important limitations
This is a scaffold, not a full-featured demo or award solver. Priority tiers are metadata and are not automatically enforced during manual approval. No seniority/lottery awards, staffing solver, duty/rest validation, weekly-U enforcement, training-buffer enforcement, PTO balances, multiple groups UI, shared data, import, backend or real authentication. All demo roles can inspect and edit browser state. Approval only checks the configured absence cap; it does not establish safe coverage. Changes to policy can produce cap violations, which are flagged rather than silently reversing approved requests. Approved request removal is possible with confirmation in this sandbox.

## Policy uncertainties
D/A/PWO/O/U meanings and availability/PTO effects are not assumed. Week definition and training-buffer placement remain unconfirmed. The PDK cap is not a universal departmental rule. Refer to presets/pdk.json.

## Hosting
Static-host ready. GitHub Pages has not been enabled by this commit. No production employee information or secrets should be added to this public repository.

## Manual smoke checks
1. Serve over HTTP; confirm chooser appears on reload.
2. Enter Scheduler; approve five VAC requests for different pilots on one day; sixth must be blocked.
3. Switch views; requests remain visible.
4. Reload; data remains local but chooser reappears.
5. Edit absenceCap below current count; run checks to see violation.
6. Export and reset; reset must clear local requests.

These checks are instructions, not a claim of executed browser tests.
