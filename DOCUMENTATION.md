# GuiltFreeCal — System Architecture & Comprehensive Walkthrough

---

## 1. Project Overview & Core Philosophy

**GuiltFreeCal** is a student productivity and scheduling application built around a simple truth:

> **People should plan their day according to both the time they have available and the energy they have available.**

Traditional calendars only track what users *hope* to do. When life gets in the way or energy dips, users fall behind, tasks pile up, and guilt sets in. GuiltFreeCal bridges the gap between expectations and reality by tracking three distinct dimensions:

1. **What I planned to do** (Planned duration, priority, deadlines).
2. **What I actually did** (Actual duration spent, completed vs. postponed).
3. **How I felt** (Expected task demand vs. actual perceived energy and reflections).

### Key Design Tenets
* **No AI or Black-Box Heuristics:** The system uses a clean, transparent, deterministic rule-based scheduling algorithm that any student can explain line-by-line to a college professor.
* **Supportive & Non-Judgmental:** Replace guilt-inducing language with constructive guidance (*"Adjust your plan"*, *"Postpone to protect your energy"*).
* **Clock-Aware & Non-Destructive:** Never moves completed work or past events; preserves schedule history.

---

## 2. System Architecture

```
React 19 + Vite Frontend (client/src/App.jsx)
         │
         │ REST API Requests (JSON)
         ▼
Express 5 REST API (server/server.js)
         │
         ├──► replanEngine.js (Pure Function Algorithm)
         │
         └──► MongoDB Atlas / In-Memory Demo Fallback
```

* **Frontend:** React 19 single-page application bundled with Vite. Styled with custom CSS using `DM Sans` and `Manrope` typography in a gentle sage/pastel palette.
* **Backend:** Node.js with Express 5 exposing clean RESTful endpoints.
* **Persistence:** MongoDB via Mongoose. If MongoDB Atlas is blocked by campus Wi-Fi or IP whitelist rules, an automatic In-Memory Store fallback activates so presentations and tests run offline seamlessly.

---

## 3. File-by-File Breakdown

### `server/models/User.js`
* **Purpose:** Stores user credentials for authentication.
* **Key Fields:**
  * `name`: Student's full name.
  * `email`: Unique login email (e.g. `student@college.edu`).
  * `password`: User password.

### `server/models/Activity.js`
* **Purpose:** Data model representing calendar events and tasks.
* **Key Fields:**
  * `title`: Name of the task or commitment.
  * `category`: `"Study"`, `"Break"`, `"Project"`, or `"Personal"`.
  * `start` & `end`: Scheduled times in `"HH:MM"` format.
  * `duration`: Duration string (e.g. `"90 min"`).
  * `type`:
    * `"fixed"`: Unmovable commitment (college lectures, labs, appointments).
    * `"flexible"`: Moveable personal tasks scheduled around fixed blocks.
  * `status`: `"upcoming"`, `"in-progress"`, `"done"`, `"partial"`, `"skipped"`, or `"missed"`.
  * `expectedEnergy`: Task energy requirement (`"LOW"`, `"MEDIUM"`, `"HIGH"`).
  * `priority`: Priority scale from 1 (lowest) to 5 (critical).
  * `deadline`: Optional deadline time (e.g. `"20:00"`).
  * `actualDuration`: Minutes spent (logged upon completion).
  * `actualEnergy`: User's perceived energy upon finishing (`"LOW"`, `"MEDIUM"`, `"HIGH"`).
  * `reflection`: Optional reflection note about how the task felt.
  * `date`: Target date (`"YYYY-MM-DD"`).
  * `userId`: Owner of the activity.

### `server/models/ReplanHistory.js`
* **Purpose:** Historical version snapshots saved each time the user replans.
* **Key Fields:**
  * `date`: Date of the schedule.
  * `versionId`: Clean version tag (e.g. `v-8f12a0`).
  * `versionSummary`: Summary of changes made.
  * `snapshotBefore`: Complete copy of the schedule before replanning.
  * `snapshotAfter`: Complete copy of the revised schedule.
  * `diagnosis` & `adjustments`: Explanation of what was adjusted and why.

### `server/utils/replanEngine.js`
* **Purpose:** Pure, deterministic scheduling algorithm.
* **Characteristics:** Pure function with **no I/O, no database queries, and no AI APIs**. Accepts schedule data, user energy, and current time, and returns a proposed schedule and postponement suggestions with human-readable explanations.

### `server/server.js`
* **Purpose:** Express application handling routing, data persistence, and graceful fallbacks.
* **Key Routes:**
  * `POST /api/auth/register`: Create a new user account.
  * `POST /api/auth/login`: Authenticate existing user.
  * `GET /api/activities?date=...&userId=...`: Fetch activities for a given date.
  * `POST /api/activities`: Create an activity or commitment.
  * `PATCH /api/activities/:id`: Update status, log completion, or edit fields.
  * `DELETE /api/activities/:id`: Remove an existing activity or commitment.
  * `POST /api/replan`:
    * When `preview: true`: Runs the replanning algorithm and returns proposals without saving to database.
    * When `preview: false`: Commits user-approved changes, moves postponed tasks to their selected dates, and saves a history snapshot.
  * `POST /api/replan/checkout`: Restores the schedule to a previous snapshot version.
  * `POST /api/activities/reset`: Resets schedule to sample demo day.

### `client/src/App.jsx`
* **Purpose:** Main application component managing state and workflows.
* **Key Modules:**
  * **Authentication:** Login/Registration view with 1-Click Demo Login.
  * **Date Navigator:** Calendar picker and previous/next day navigation.
  * **Clock-Aware Timeline:** Real-time clock indicator, badges for fixed commitments, energy levels, priorities, and deadlines, with 1-click completion and activity deletion.
  * **Activity Deletion & Management:** Users can remove unwanted activities with a single click and confirmation from both the schedule timeline and the Unfinished Tray.
  * **Activity Completion Modal:** Form to record actual duration, energy, and reflection.
  * **Replanning Review Modal:** Visual comparison showing what was kept, what was moved, and where postponed tasks will be sent.
  * **Expected vs Actual Learning View:** Transparent statistics (overruns, estimation accuracy, energy alignment).
  * **Saved History View:** Version history with one-click restore.

### `client/src/App.css`
* **Purpose:** Clean, responsive, pastel/sage aesthetic matching student well-being principles. Custom styled cards, badges, timeline tree, and dialog overlays.

---

## 4. How the Energy-Aware Replanning Algorithm Works

The replanning engine (`server/utils/replanEngine.js`) executes 7 deterministic steps:

1. **Step 1 — Freeze the Past:**
   - Activities marked `done` or `partial` are preserved exactly as they are.
   - Activities explicitly `in-progress` keep their current slot.
   - Fixed commitments (`type === "fixed"`) can never be shifted or overwritten.
   - Overdue/missed upcoming activities whose scheduled time has passed are identified as candidates for future rescheduling.

2. **Step 2 — Calculate Remaining Free Time Slots:**
   - The planning window starts at `currentTimeMinutes` and extends to end-of-day (24:00).
   - All upcoming fixed commitments are merged into blocked intervals.
   - The algorithm inverts these blocks to identify **continuous free-time slots** (e.g. 12:00–13:00, 15:30–24:00).

3. **Step 3 — Identify Eligible Candidates:**
   - Collects all flexible tasks that need placement in the future free time.

4. **Step 4 — Match Energy to Tasks:**
   - Compares current user energy (`LOW`, `MEDIUM`, `HIGH`) with the task requirement (`LOW`, `MEDIUM`, `HIGH`):
     - **HIGH energy:** High, medium, and low demand tasks can all be handled.
     - **MEDIUM energy:** Medium and low tasks are preferred; high tasks receive a mild penalty.
     - **LOW energy:** Low tasks are strongly favored (+30 bonus). High tasks receive a -40 penalty unless justified by priority 5 or an imminent deadline.

5. **Step 5 — Transparent Ranking & Scoring:**
   - Each candidate activity receives a score calculated using named variables:
     `Total Score = (Priority * 20) + EnergyMatchScore + DeadlineUrgencyScore`
     - **Priority Score:** (1 to 5) * 20 (weights 20 to 100).
     - **Energy Match Score:** +30 to -40 based on compatibility.
     - **Deadline Urgency Score:** Up to +40 points if a deadline is approaching today.
     - Ties are broken predictably: earlier deadline, then higher priority, then original time.

6. **Step 6 — Assign Future Slots:**
   - Evaluates tasks in descending score order.
   - Places each task into the earliest available free slot whose duration is sufficient.
   - Consumes the time from the slot, preventing any overlapping tasks.

7. **Step 7 — Produce Postponement Suggestions:**
   - If a task cannot fit or is a severe energy mismatch during low energy:
     - It is **not** deleted.
     - It is returned in the `postponed` list with a clear, human-readable reason (e.g., *"Postpone this task: there isn't enough free time remaining today"*, *"Consider doing this tomorrow when your energy is higher"*).

---

## 5. College Viva & Demonstration Guide

### Likely Professor Questions & Answers

#### Q1: "Why not use machine learning or an AI optimizer like genetic algorithms?"
> **Answer:** "In a student calendar, predictability and explainability are paramount. If an AI reschedules a task, the user doesn't know why. Our deterministic rule-based algorithm provides transparent reasons for every decision (e.g., 'moved because college ends at 3:30 PM', 'postponed because you reported low energy'). It has zero API costs, zero latency, and runs 100% locally."

#### Q2: "How does the system ensure college hours are never violated?"
> **Answer:** "In Step 2 of `replanEngine.js`, fixed commitments are treated as non-negotiable blocked intervals. The algorithm inverts these intervals to produce only true free-time slots. Flexible tasks can only be scheduled inside those free-time slots."

#### Q3: "What happens if an activity overruns its planned time?"
> **Answer:** "When the student logs in or clicks Replan, the system reads the local clock. The overdue or unfinished tasks are detected, and the algorithm shifts the remaining flexible tasks forward to start after the current time."

#### Q4: "Where do postponed tasks go?"
> **Answer:** "In our replanning review modal, the user chooses where to send each postponed task: Tomorrow, Day after tomorrow, a specific date via calendar, or the Unscheduled Tray. The task is preserved and committed to that day's schedule."

#### Q5: "How are past changes preserved?"
> **Answer:** "Every confirmed replan saves a snapshot of the schedule before and after the adjustment in `ReplanHistory`. The student can inspect comparisons or restore any previous schedule version with a single click."

---

## 6. Verification Status

* **Unit Tests (`server/tests/replanEngine.test.js`):** 10 / 10 Passing.
* **Frontend Production Build:** Built with zero errors in ~400ms.
* **Database Resilience:** Seamless automatic in-memory fallback ensures demonstrations never crash even without internet or Atlas IP whitelisting.
