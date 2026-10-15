# Implementation Plan — Energy-Aware Replan Feature

Stack: Express 5 + Mongoose 9 (CommonJS) on the server; React 19 + Vite 8 (ESM) on the client.
No test framework exists in the project — verification uses the dev server and manual curl/browser checks.

---

## PART 1 — Replan Engine (pure utility, no I/O)

- [ ] 1. Create `server/utils/replanEngine.js`

  Write and export a single function `replanEngine(activities, energy, currentTimeMinutes)`.

  **Internal logic (implement in this exact order):**

  1. **Helper conversions** — `toMinutes(timeStr)` splits `"HH:MM"` and returns total minutes; `toTime(mins)` pads back to `"HH:MM"`.

  2. **Separate fixed vs flexible** — fixed activities (`type === "fixed"`) are never touched. Collect flexible `upcoming` activities whose end time is after `currentTimeMinutes` into a `movable` array, sorted ascending by `start`. Activities already `done`, `partial`, or `skipped` stay unchanged.

  3. **Apply energy adjustments to durations (before scheduling)**
     - Energy 1–2 (Low): multiply each flexible duration by **0.70** (round to nearest minute, minimum 10 min). Reorder `movable` so `Study` and `Project` categories sort to the end (after `Break` and `Personal`).
     - Energy 3 (Medium): keep original durations. Keep original order.
     - Energy 4–5 (High): multiply each flexible duration by **1.20** (round, no cap). Group by category: collect all of each category together in the order `Study`, `Project`, `Personal`, `Break`.

  4. **Schedule loop** — maintain a `cursor = currentTimeMinutes`. For each item in `movable`:
     - Find the earliest fixed activity whose start ≥ `cursor`.
     - Try `start = cursor`, `end = cursor + adjustedDuration`.
     - If `end > nextFixed.start`: check available gap = `nextFixed.start − cursor`. If gap ≥ 15 min, truncate: `end = nextFixed.start`. Otherwise skip over the fixed block: `start = nextFixed.end`, `end = start + adjustedDuration`.
     - After placing, check again for any fixed activity overlapping `[start, end]`. If found, push `start = overlapping.end`, `end = start + adjustedDuration`.
     - **Low-energy rest insertion**: after every 60 cumulative work minutes scheduled (track `workSinceLastRest`), if the next item is not already a Break, insert a synthetic `{title: "Rest break", category: "Break", type: "flexible", duration: "15 min", status: "upcoming"}` block for 15 min at the cursor before continuing.
     - **Midnight cap**: if `end > 1440`, mark the activity `status: "skipped"` and do not advance `cursor`. Continue to next item.
     - **Low-energy 6-hour cap**: if `energy <= 2` and `start > currentTimeMinutes + 360`, mark `status: "skipped"`. Continue.
     - On success: set `start`, `end`, `duration` on the activity, advance `cursor = end`.

  5. **Build output activities array** — merge: unchanged activities + updated movables (preserve `_id` and all other fields). Sort by `start`.

  6. **Build `insights` object:**
     - `energyLabel`: `'Low energy mode'` for 1–2, `'Steady pace mode'` for 3, `'High energy mode'` for 4–5.
     - `adjustments`: array of human-readable strings, one per changed activity. Format: `"'<title>': moved to <newStart>–<newEnd> (<newDuration>)"` for time changes; `"'<title>': skipped — could not fit before midnight"` for skipped; `"Rest break inserted at <time>"` for synthetic breaks. If nothing changed, push `"No changes needed — your schedule looks good."`.
     - `totalWorkMinutes`: sum of durations of non-Break activities that are `upcoming` (not skipped).
     - `totalRestMinutes`: sum of durations of Break activities that are `upcoming` (not skipped).
     - `skippedCount`: count of activities with `status === 'skipped'`.
     - `diagnosis`: a 2–4 sentence paragraph. Compose it from the detected state:
       - Mention the energy level and mode name.
       - State how many flexible activities were rescheduled and how many were skipped (if any).
       - If energy is low: note that heavy tasks (Study/Project) were deprioritised and rest breaks were added.
       - If energy is high: note that similar tasks were grouped and durations extended to maintain momentum.
       - Always close with a supportive sentence (e.g., "This schedule is built around what you can actually manage right now.").

  7. Return `{ activities, insights }`.

  Files: `server/utils/replanEngine.js` (new file)

  Verify: Start the server with `node server.js` in the `server/` directory. It must start without errors (the module is only `require`d — no runtime call at startup).

---

## PART 2 — ReplanHistory Model + New API Routes

- [ ] 2. Create `server/models/ReplanHistory.js`

  Use Mongoose `Schema` with `timestamps: true`. Fields exactly:

  ```
  date              String, required
  replanAt          Date, default: Date.now
  energyAtReplan    Number, min: 1, max: 5
  energyLabel       String
  diagnosis         String
  adjustments       [String]
  totalWorkMinutes  Number
  totalRestMinutes  Number
  skippedCount      Number
  snapshotBefore    [Schema.Types.Mixed]
  snapshotAfter     [Schema.Types.Mixed]
  ```

  Export as `mongoose.model("ReplanHistory", replanHistorySchema)`.

  Files: `server/models/ReplanHistory.js` (new file)

  Verify: `node -e "require('./models/ReplanHistory')" ` run from `server/` prints nothing (no syntax errors).

- [ ] 3. Add three new routes to `server/server.js` — insert them **before** the existing `PATCH /api/activities/replan` fallback route (which must remain in place).

  At the top of `server.js`, after the existing `require` statements, add:
  ```js
  const ReplanHistory = require("./models/ReplanHistory");
  const replanEngine  = require("./utils/replanEngine");
  ```

  **Route A — `POST /api/replan`**
  - Accept body: `{ date, energy, currentTimeMinutes, activities }`.
  - Validate: `activities` must be an array; `energy` must be 1–5; `date` must be a non-empty string. Return 400 with `{ success: false, message }` if invalid.
  - Call `const { activities: planned, insights } = replanEngine(activities, energy, currentTimeMinutes)`.
  - Save `new ReplanHistory({ date, energyAtReplan: energy, energyLabel: insights.energyLabel, diagnosis: insights.diagnosis, adjustments: insights.adjustments, totalWorkMinutes: insights.totalWorkMinutes, totalRestMinutes: insights.totalRestMinutes, skippedCount: insights.skippedCount, snapshotBefore: activities, snapshotAfter: planned })`. Await `.save()`.
  - Return `{ success: true, activities: planned, insights, historyId: saved._id }`.
  - Catch → 500 with `{ success: false, message, error: error.message }`.

  **Route B — `GET /api/replan/history`**
  - Optional query param `?date=YYYY-MM-DD`.
  - If `date` provided: `ReplanHistory.find({ date }).sort({ replanAt: -1 })`.
  - If no `date`: `ReplanHistory.find().sort({ replanAt: -1 }).limit(30)`.
  - Return `{ success: true, count: records.length, history: records }`.
  - Catch → 500.

  **Route C — `GET /api/replan/history/:id`**
  - `ReplanHistory.findById(req.params.id)`.
  - 404 if not found; else return `{ success: true, record }`.
  - Catch → 400 (handles invalid ObjectId format).

  Files: `server/server.js` (modify), `server/models/ReplanHistory.js` (already created in step 2), `server/utils/replanEngine.js` (already created in step 1)

  Verify: Start the server. `curl -s http://localhost:5000/api/replan/history` must return `{"success":true,"count":0,"history":[]}`. `curl -s -X POST http://localhost:5000/api/replan -H "Content-Type: application/json" -d "{\"date\":\"2025-01-01\",\"energy\":3,\"currentTimeMinutes\":480,\"activities\":[]}"` must return `{ success: true, activities: [], insights: {...}, historyId: "..." }`.

---

## PART 3 — Client-Side: Wire API + Insights Panel + History Drawer

- [ ] 4. Add new state variables and wire `replanDay()` to `POST /api/replan` in `client/src/App.jsx`

  **New state at the top of the `App` component** (add after existing `useState` declarations):
  ```js
  const [insights, setInsights] = useState(null);       // insights object from last replan
  const [showInsights, setShowInsights] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyRecords, setHistoryRecords] = useState([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState(null); // { before: [], after: [], record: {} }
  ```

  **Replace the body of `replanDay()`** — keep the old algorithm as a block comment (`/* OLD CLIENT-SIDE ALGORITHM … */`) wrapping the original code, then write the new implementation:
  ```js
  async function replanDay() {
    try {
      const now = new Date();
      const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();
      const response = await fetch("http://localhost:5000/api/replan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: getToday(),
          energy,
          currentTimeMinutes,
          activities,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Could not replan.");
      setActivities([...result.activities].sort((a, b) => a.start.localeCompare(b.start)));
      setInsights(result.insights);
      setShowInsights(true);
      setNotice("Your day has been replanned based on your energy level.");
    } catch (error) {
      console.error("Replanning failed:", error);
      setNotice(error.message || "Could not replan your day. Please try again.");
    }
  }
  ```

  Files: `client/src/App.jsx`

  Verify: Click "Replan my day" in the browser. The network tab must show a `POST /api/replan` request returning 200. The schedule list must update.

- [ ] 5. Add the Insights Panel JSX to `client/src/App.jsx`

  Insert the following JSX block **immediately after** the closing `</section>` of the `.replan-card` section (and before the `<footer>` element):

  ```jsx
  {showInsights && insights && (
    <div className="insights-panel">
      <div className="insights-header">
        <span className="energy-label-pill">{insights.energyLabel}</span>
        <button className="hide-insights-link" onClick={() => setShowInsights(false)}>
          Hide insights ×
        </button>
      </div>
      <p className="insights-diagnosis">{insights.diagnosis}</p>
      <details className="insights-adjustments">
        <summary>What changed ({insights.adjustments.length})</summary>
        <ul>
          {insights.adjustments.map((adj, i) => (
            <li key={i}>{adj}</li>
          ))}
        </ul>
      </details>
      <div className="insights-stats">
        <span>{insights.totalWorkMinutes} min work</span>
        <span>·</span>
        <span>{insights.totalRestMinutes} min rest</span>
        <span>·</span>
        <span>{insights.skippedCount} skipped</span>
      </div>
    </div>
  )}
  ```

  Files: `client/src/App.jsx`

  Verify: After a replan, the insights panel must appear below the replan card showing the energyLabel pill, diagnosis text, a `<details>` toggle listing adjustments, and the stats row.

- [ ] 6. Add the History Drawer JSX to `client/src/App.jsx`

  **Add `fetchHistory` function** (place it alongside the other async functions, after `replanDay`):
  ```js
  async function fetchHistory() {
    try {
      const response = await fetch(
        `http://localhost:5000/api/replan/history?date=${getToday()}`
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not load history.");
      setHistoryRecords(data.history);
    } catch (error) {
      console.error("History fetch failed:", error);
      setNotice("Could not load replan history.");
    }
  }
  ```

  **Update the "My schedule" nav button** — replace:
  ```jsx
  <button
    className="nav-item"
    onClick={() =>
      setNotice("Your weekly planning view is coming next.")
    }
  >
    <span>▤</span> My schedule
  </button>
  ```
  with:
  ```jsx
  <button
    className={`nav-item ${showHistory ? "active" : ""}`}
    onClick={() => {
      setShowHistory((prev) => !prev);
      if (!showHistory) fetchHistory();
    }}
  >
    <span>▤</span> My schedule
  </button>
  ```

  **Add history drawer JSX** — insert the block below **after** the closing `</section>` of `.schedule-section` (before `</main>`):
  ```jsx
  {showHistory && (
    <section className="history-drawer">
      <div className="history-header">
        <h2>Replan History <span>✳</span></h2>
        <button className="reset-button" onClick={() => { setShowHistory(false); setSelectedSnapshot(null); }}>
          × Close
        </button>
      </div>

      {selectedSnapshot ? (
        <div className="snapshot-view">
          <button className="back-link" onClick={() => setSelectedSnapshot(null)}>
            ← Back to today
          </button>
          <div className="snapshot-cols">
            <div>
              <h3>Before</h3>
              {selectedSnapshot.before.map((act, i) => (
                <div key={i} className="snapshot-row">
                  <span className="snapshot-time">{act.start}–{act.end}</span>
                  <span>{act.title}</span>
                  <span className={`category-tag ${act.category.toLowerCase()}`}>{act.category}</span>
                </div>
              ))}
            </div>
            <div>
              <h3>After</h3>
              {selectedSnapshot.after.map((act, i) => (
                <div key={i} className="snapshot-row">
                  <span className="snapshot-time">{act.start}–{act.end}</span>
                  <span>{act.title}</span>
                  <span className={`category-tag ${act.category.toLowerCase()}`}>{act.category}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="history-list">
          {historyRecords.length === 0 && (
            <p className="history-empty">No replans recorded for today yet.</p>
          )}
          {historyRecords.map((rec) => (
            <div key={rec._id} className="history-record">
              <div className="history-record-meta">
                <span className="history-energy-emoji">
                  {["☁", "◔", "◑", "◕", "☀"][rec.energyAtReplan - 1]}
                </span>
                <div>
                  <span className="history-label">{rec.energyLabel}</span>
                  <span className="history-time">
                    {new Date(rec.replanAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </div>
              <p className="history-diagnosis-snippet">
                {rec.diagnosis.length > 120 ? rec.diagnosis.slice(0, 120) + "…" : rec.diagnosis}
              </p>
              <button
                className="view-snapshot-button"
                onClick={() => setSelectedSnapshot({ before: rec.snapshotBefore, after: rec.snapshotAfter, record: rec })}
              >
                View snapshot →
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )}
  ```

  Files: `client/src/App.jsx`

  Verify: Click "My schedule" in the sidebar. The history drawer must appear inline below the schedule. If no replans have been run yet, it shows "No replans recorded for today yet." After a replan, clicking "My schedule" again shows the new history record. "View snapshot" renders the before/after columns. "← Back to today" closes the snapshot view.

- [ ] 7. Add all new CSS to `client/src/App.css`

  Append the following new rule blocks at the **end** of the file (after the last `@media` block):

  ```css
  /* ── Insights Panel ─────────────────────────────── */
  .insights-panel {
    margin-top: 16px;
    padding: 20px;
    background: #eaf4ea;
    border: 1px solid #d4e8d2;
    border-radius: 14px;
  }

  .insights-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .energy-label-pill {
    display: inline-block;
    background: #c8e6c9;
    color: #2e6b3e;
    border-radius: 20px;
    padding: 4px 12px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
  }

  .hide-insights-link {
    border: 0;
    background: transparent;
    color: #7a9b7e;
    font-size: 11px;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .insights-diagnosis {
    font-style: italic;
    color: #3d5e45;
    font-size: 12px;
    line-height: 1.7;
    margin: 0 0 14px;
  }

  .insights-adjustments {
    margin-bottom: 14px;
  }

  .insights-adjustments summary {
    font-size: 11px;
    font-weight: 700;
    color: #4d7258;
    cursor: pointer;
    user-select: none;
  }

  .insights-adjustments ul {
    margin: 10px 0 0 18px;
    padding: 0;
  }

  .insights-adjustments li {
    font-size: 11px;
    color: #5a7a60;
    line-height: 1.8;
  }

  .insights-stats {
    display: flex;
    gap: 10px;
    font-size: 11px;
    font-weight: 600;
    color: #5e8065;
  }

  .insights-stats span:nth-child(even) {
    color: #afc8b2;
  }

  /* ── History Drawer ──────────────────────────────── */
  .history-drawer {
    margin-top: 30px;
    padding: 24px;
    background: #fff;
    border: 1px solid #e9ede6;
    border-radius: 16px;
  }

  .history-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
  }

  .history-header h2 {
    font: 800 20px 'Manrope', sans-serif;
    color: #2b4538;
    letter-spacing: -0.7px;
    margin: 0;
  }

  .history-header h2 span {
    color: #82a68a;
    font-size: 16px;
  }

  .history-list {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .history-empty {
    color: #9aa49b;
    font-size: 12px;
    text-align: center;
    padding: 24px 0;
  }

  .history-record {
    padding: 16px;
    background: #f7faf6;
    border: 1px solid #e6ece4;
    border-radius: 12px;
  }

  .history-record-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }

  .history-energy-emoji {
    font-size: 22px;
  }

  .history-label {
    font-size: 11px;
    font-weight: 700;
    color: #3d6448;
    display: block;
  }

  .history-time {
    font-size: 10px;
    color: #9aa49b;
  }

  .history-diagnosis-snippet {
    font-size: 11px;
    color: #6a7e6e;
    line-height: 1.6;
    margin: 0 0 10px;
  }

  .view-snapshot-button {
    background: #436d52;
    color: white;
    border: 0;
    border-radius: 7px;
    padding: 7px 13px;
    font-size: 10px;
    font-weight: 600;
  }

  .view-snapshot-button:hover {
    background: #355b43;
  }

  /* ── Snapshot View ───────────────────────────────── */
  .snapshot-view {
    padding-top: 4px;
  }

  .back-link {
    border: 0;
    background: transparent;
    color: #4b8c75;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    margin-bottom: 18px;
    display: inline-block;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .snapshot-cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }

  .snapshot-cols h3 {
    font: 700 13px 'Manrope', sans-serif;
    color: #3a5a44;
    margin: 0 0 12px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }

  .snapshot-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    border-bottom: 1px solid #edf1ea;
    font-size: 11px;
    color: #4a5e4e;
    flex-wrap: wrap;
  }

  .snapshot-time {
    font-weight: 600;
    color: #536c5a;
    flex-shrink: 0;
    min-width: 90px;
  }

  /* ── Add Activity Button ─────────────────────────── */
  .add-activity-button {
    background: #436d52;
    color: white;
    border: 0;
    padding: 10px 14px;
    border-radius: 9px;
    font-size: 11px;
    font-weight: 600;
  }

  .add-activity-button:hover {
    background: #355b43;
  }

  /* ── Activity Form ───────────────────────────────── */
  .activity-form {
    background: #fff;
    border: 1px solid #e8ede5;
    border-radius: 13px;
    padding: 22px;
    margin-bottom: 20px;
  }

  .activity-form h3 {
    font: 700 15px 'Manrope', sans-serif;
    color: #2b4538;
    margin: 0 0 18px;
  }

  .activity-form label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    color: #5a7261;
    margin-bottom: 14px;
  }

  .activity-form input,
  .activity-form select {
    border: 1px solid #dde3da;
    border-radius: 8px;
    padding: 9px 11px;
    font: inherit;
    font-size: 12px;
    color: #344a3b;
    background: #fafbf9;
  }

  .activity-form input:focus,
  .activity-form select:focus {
    outline: 2px solid #4b8c75;
    outline-offset: 2px;
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }

  .form-actions {
    display: flex;
    gap: 10px;
    margin-top: 6px;
  }

  /* ── Heading Actions ─────────────────────────────── */
  .heading-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
  ```

  Files: `client/src/App.css`

  Verify: `npm run dev` in `client/` starts without errors. In the browser, the existing schedule renders correctly with no style regressions. After a replan, the `.insights-panel` appears with green background. After clicking "My schedule", the `.history-drawer` slides in.

---

## Dependency & Order Notes

- Item 2 depends on nothing (pure schema).
- Item 1 depends on nothing (pure function).
- Item 3 depends on items 1 and 2 (requires both files).
- Item 4 depends on item 3 (the `POST /api/replan` endpoint must exist before wiring the client).
- Items 5 and 6 depend on item 4 (new state variables must exist first).
- Item 7 depends on items 5 and 6 (CSS classes referenced in JSX must exist, but CSS can be added in the same pass).

Items 1 and 2 are independent of each other and can be created in either order.
Items 5 and 6 are both modifications to `App.jsx` and should be done in a single pass (step 5 then step 6, or combined) to avoid conflicts.
