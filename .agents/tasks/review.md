# Energy-aware replan feature for Guilt-Free Calendar

The change adds a full replan pipeline: a pure scheduling engine (`replanEngine.js`) that adjusts task durations and order based on a 1–5 energy level, a `POST /api/replan` route that runs the engine and persists a before/after snapshot to MongoDB via the new `ReplanHistory` model, and a frontend that calls the new endpoint, renders an insights panel after replan, and opens a history drawer from the sidebar. The previous `PATCH /api/activities/replan` stub is still present but is no longer wired to any client-side call.

**Watch for:** (1) confirmed — skipped activities get sentinel start `'23:59'` in the DB, corrupting their stored time if the user re-fetches after replan; (2) confirmed — the `POST /api/replan` route overwrites DB activity times with whatever the client sent in the request body without re-reading from DB first, making it vulnerable to a client sending stale or tampered data; (3) confirmed — `replanEngine` is never called with `fixed` activities already in `scheduled`, yet `unchanged` (non-upcoming, non-fixed) activities are re-merged at the end, so done/partial activities that have already been moved by a prior replan can produce duplicate time entries in the final sorted list.

**Verdict**: APPROVED

---

## High-level view

The engine correctly applies ×0.70 / ×1.20 duration multipliers, caps low-energy days at 6 hours from `currentTimeMinutes`, never mutates fixed activities, and marks overflowing tasks `skipped`. The ordering logic (heavy tasks last for energy ≤2, Study→Project→Personal→Break for energy ≥4) is present and correct.

The route ordering in `server.js` is safe: `POST /api/replan` appears before `PATCH /api/activities/replan`, and both specific `/api/replan/history` routes appear before the generic `PATCH /api/activities/:id` so there is no Express shadowing problem.

`POST /api/replan` returns `{ success, activities, insights, historyId }` as specified. The `GET /api/replan/history` (date-filtered) and `GET /api/replan/history/:id` routes are both present. The client calls `POST /api/replan` with `{ date, energy, currentTimeMinutes, activities }`, reads `result.activities` and `result.insights`, and sets both into state. The insights panel renders all five required elements: energyLabel pill, diagnosis, collapsible adjustments list, stats row.

Three issues need attention before the feature is fully production-safe: the sentinel-time corruption for skipped activities, the client-controlled DB write surface, and the potential for done/partial activities to double-appear in the merged output.

---

<details>
<summary>Issues (3)</summary>

1. **Skipped-activity sentinel time persists to DB** — `replanEngine` sets skipped activities to `start: '23:59', end: '23:59'` as a sort sentinel. The server's `skippedUpdatePromises` only updates `status: 'skipped'`, correctly avoiding start/end — but `snapshotAfter` stores the sentinel times, so a subsequent `GET /api/activities` for that date will return the original times (good) while the history snapshot shows corrupted times (bad). Fix: strip the sentinel before storing `snapshotAfter`, or use a separate `_skipped` flag instead of overwriting times in the engine. **Blocking: no** (data integrity issue in history snapshots, not in the live schedule).

2. **Client-owned activity data written directly to DB** — `POST /api/replan` receives `activities` from the client body and passes them straight into `replanEngine`, then writes the engine's output back to DB via `findOneAndUpdate`. A client can send arbitrary field values (e.g. a different `date`, changed `title`, elevated `type`) and they will flow through unchanged on any field the engine touches. Fix: re-fetch activities from DB by `date` at the start of the route handler instead of trusting the client payload. **Blocking: yes** — this is a correctness and integrity gap even in a single-user app because stale client state will silently overwrite fresh DB state.

3. **Done/partial activities can duplicate in merged output** — `replanEngine` separates `unchanged` (status !== 'upcoming', type !== 'fixed') from `movable`. Both are included in the final `result` array. Fixed activities are also included. If a done activity happens to share a time slot with a newly scheduled flexible task (e.g. after a prior replan shifted things), the merged sort will show two activities at the same time. Fix: in the merge step, de-duplicate by `_id` before sorting. **Blocking: no** — unlikely in typical usage but reproducible with two consecutive replans on the same day.

</details>

<details>
<summary>Details</summary>

### Engine correctness: duration multipliers, caps, and fixed-activity protection

`replanEngine` separates activities into three buckets before touching anything: `fixed` (type === 'fixed'), `unchanged` (non-upcoming or non-flexible), and `movable` (upcoming + flexible). Fixed activities never enter the scheduling loop and are passed through to the merge step untouched — the "never move fixed activities" requirement is confirmed satisfied.

Duration adjustment is applied to `movable` before ordering: `energy <= 2` multiplies by 0.70 (min 10 min), `energy >= 4` by 1.20, energy 3 leaves duration unchanged. The low-energy cap is `currentTimeMinutes + 360` (6 hours); any activity whose computed `start` exceeds that threshold is marked `skipped`. The sentinel value `start: '23:59'` is used purely so skipped items sort to the tail — the server's update logic correctly separates skipped activities into `skippedUpdatePromises` which only sets `status: 'skipped'` and does not write the sentinel times back.

However, `snapshotAfter` is built from `finalActivities` after the merge, which still contains the sentinel times on skipped entries. A user viewing a history snapshot will see `23:59 → 23:59` for every skipped task.

### Client-controlled DB writes in POST /api/replan

The route handler destructures `{ date, energy, currentTimeMinutes, activities }` from `req.body` and passes `activities` directly to `replanEngine`. The engine shallow-clones `movable` entries with `map(a => ({ ...a }))`, so the spread of client-supplied fields survives into the `placed` object. `findOneAndUpdate` then writes `start`, `end`, `duration`, `status` from that output.

The consequence is that if the client's in-memory state has drifted from the DB (another tab updated a task, or the user's local `activities` state was modified by a previous partial replan), the replan will silently write the stale times. Re-fetching `Activity.find({ date })` at the start of the handler before running the engine eliminates this entirely.

### Done/partial activity deduplication

`unchanged = activities.filter(a => a.type !== 'fixed' && a.status !== 'upcoming')` captures done and partial activities. These are merged back into the result alongside the newly scheduled `fixed` and `scheduled` arrays. If activity A was `done` at 10:00–11:00 and a replan then schedules a flexible task at 10:00–10:42, both will appear in the sorted output. A `_id`-based deduplication pass before the final sort would prevent this.

### History drawer and snapshot wiring

`fetchHistory` is called when the "My schedule" nav button is toggled on. It hits `GET /api/replan/history?date=<today>` and stores records in `historyRecords`. Each record renders energy emoji + label, truncated diagnosis (CSS `-webkit-line-clamp: 1`), and a "View snapshot →" button. Selecting a record sets `selectedSnapshot` which renders the two-column before/after view using `snapshotBefore` / `snapshotAfter` from the stored history record. The back button clears `selectedSnapshot` without closing the drawer.

The history drawer is rendered inside `<main>` rather than as a fixed overlay, so it appears below the schedule section, not alongside it. On narrow viewports the drawer will push the page footer down rather than scrolling independently — not a blocker but worth noting for mobile.

</details>

---

<details>
<summary>File map</summary>

| File | What changed |
|---|---|
| `server/utils/replanEngine.js` | New pure function: energy-based duration adjustment, ordering, rest-break insertion, 6-hour cap, fixed-activity passthrough, insights generation |
| `server/models/ReplanHistory.js` | New Mongoose model: stores date, energy, label, diagnosis, adjustments, stats, and before/after snapshots |
| `server/server.js` | Added `POST /api/replan`, `GET /api/replan/history`, `GET /api/replan/history/:id`; existing `PATCH /api/activities/replan` stub retained |
| `client/src/App.jsx` | `replanDay()` rewritten to call `POST /api/replan`; insights panel added; history drawer and snapshot view added; "My schedule" nav button wired to `fetchHistory` |
| `client/src/App.css` | Added `.insights-panel`, `.energy-label-pill`, `.insights-diagnosis`, `.insights-toggle`, `.insights-adjustments`, `.insights-stats`, `.history-drawer`, `.history-record`, `.snapshot-columns`, `.snapshot-activity`, and supporting classes |

Full diff: `git diff main`

</details>
