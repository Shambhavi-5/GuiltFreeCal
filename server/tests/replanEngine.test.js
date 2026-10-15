/**
 * replanEngine.test.js
 * Test suite verifying the 10 critical requirements of GuiltFreeCal
 * using Node's built-in test runner (node:test, node:assert).
 */

const test = require('node:test');
const assert = require('node:assert');
const replanEngine = require('../utils/replanEngine');
const { toMinutes } = replanEngine;

// ── Test Case 1: Fixed Commitment Protection ──────────────────────────────────
test('1. A user with college from 9 AM to 4 PM is never scheduled for personal activities during college', () => {
  const activities = [
    {
      _id: 'fixed-1',
      title: 'College Lectures & Labs',
      type: 'fixed',
      start: '09:00',
      end: '16:00',
      duration: '420 min',
      category: 'Study',
      status: 'upcoming',
    },
    {
      _id: 'flex-1',
      title: 'Personal Study / Coding',
      type: 'flexible',
      start: '10:00',
      end: '11:30',
      duration: '90 min',
      category: 'Study',
      status: 'upcoming',
      expectedEnergy: 'MEDIUM',
      priority: 3,
    },
  ];

  // User starts day / replans at 08:30 (510 min)
  const result = replanEngine(activities, 'MEDIUM', 510);
  const scheduledStudy = result.scheduled.find((a) => a._id === 'flex-1');

  assert.ok(scheduledStudy, 'Personal activity should be scheduled outside college hours');
  const studyStart = toMinutes(scheduledStudy.start);
  const studyEnd = toMinutes(scheduledStudy.end);

  // Must not overlap [09:00, 16:00] = [540, 960]
  const overlapsCollege = studyStart < 960 && studyEnd > 540;
  assert.strictEqual(overlapsCollege, false, 'Activity must not fall between 09:00 and 16:00');
});

// ── Test Case 2: Completed Activities Remain Unchanged ───────────────────────
test('2. An activity that has already been completed remains completed after replanning', () => {
  const activities = [
    {
      _id: 'done-1',
      title: 'Morning Yoga',
      type: 'flexible',
      start: '07:00',
      end: '07:45',
      duration: '45 min',
      category: 'Personal',
      status: 'done',
      actualDuration: 50,
      actualEnergy: 'HIGH',
      reflection: 'Felt great!',
    },
    {
      _id: 'flex-2',
      title: 'Math Revision',
      type: 'flexible',
      start: '14:00',
      end: '15:00',
      duration: '60 min',
      category: 'Study',
      status: 'upcoming',
      priority: 3,
    },
  ];

  const result = replanEngine(activities, 'LOW', 720); // 12:00 PM
  const completedTask = result.activities.find((a) => a._id === 'done-1');

  assert.ok(completedTask, 'Completed task must exist in schedule');
  assert.strictEqual(completedTask.status, 'done', 'Status must remain done');
  assert.strictEqual(completedTask.start, '07:00', 'Original start time preserved');
  assert.strictEqual(completedTask.end, '07:45', 'Original end time preserved');
  assert.strictEqual(completedTask.actualDuration, 50, 'Actual duration preserved');
});

// ── Test Case 3: No Scheduling in the Past ────────────────────────────────────
test('3. An activity is never scheduled in the past', () => {
  const activities = [
    {
      _id: 'flex-overdue',
      title: 'Chemistry Lab Prep',
      type: 'flexible',
      start: '08:00',
      end: '09:00',
      duration: '60 min',
      category: 'Study',
      status: 'upcoming',
      expectedEnergy: 'MEDIUM',
      priority: 4,
    },
  ];

  const currentTime = 660; // 11:00 AM
  const result = replanEngine(activities, 'MEDIUM', currentTime);
  const rescheduled = result.scheduled.find((a) => a._id === 'flex-overdue');

  if (rescheduled) {
    const startMin = toMinutes(rescheduled.start);
    assert.ok(startMin >= currentTime, `Start time (${rescheduled.start}) must be >= current time (11:00)`);
  }
});

// ── Test Case 4: Energy Mismatch Deprioritization & Urgency Exception ─────────
test('4. A HIGH-energy task is deprioritized when the user reports LOW energy, unless priority or deadline justifies it', () => {
  const activities = [
    {
      _id: 'task-high-routine',
      title: 'Complex Algorithm Design',
      type: 'flexible',
      start: '15:00',
      end: '16:30',
      duration: '90 min',
      category: 'Project',
      status: 'upcoming',
      expectedEnergy: 'HIGH',
      priority: 2, // Low priority routine task
    },
    {
      _id: 'task-low-reading',
      title: 'Read Documentation',
      type: 'flexible',
      start: '16:30',
      end: '17:15',
      duration: '45 min',
      category: 'Study',
      status: 'upcoming',
      expectedEnergy: 'LOW',
      priority: 3,
    },
    {
      _id: 'task-high-urgent',
      title: 'Final Term Project Submission',
      type: 'flexible',
      start: '17:30',
      end: '19:00',
      duration: '90 min',
      category: 'Project',
      status: 'upcoming',
      expectedEnergy: 'HIGH',
      priority: 5, // Top priority justified!
      deadline: '20:00',
    },
  ];

  // User reports LOW energy at 14:00 (840)
  const result = replanEngine(activities, 'LOW', 840);

  // 1. Routine HIGH-energy task with low priority should be suggested for postponement
  const routinePostponed = result.postponed.find((p) => p.activity._id === 'task-high-routine');
  assert.ok(routinePostponed, 'Routine HIGH task should be postponed when energy is LOW');
  assert.match(routinePostponed.reason, /energy/i, 'Reason should mention energy');

  // 2. Urgent HIGH-energy task with priority 5 should still be scheduled
  const urgentScheduled = result.scheduled.find((s) => s._id === 'task-high-urgent');
  assert.ok(urgentScheduled, 'Priority 5 HIGH-energy task should be scheduled despite low energy');

  // 3. LOW-energy task should be scheduled
  const lowScheduled = result.scheduled.find((s) => s._id === 'task-low-reading');
  assert.ok(lowScheduled, 'LOW-energy task should be prioritized and scheduled');
});

// ── Test Case 5: Postponement on Insufficient Time ────────────────────────────
test('5. A task that does not fit in the remaining time is suggested for postponement', () => {
  const activities = [
    {
      _id: 'fixed-eve',
      title: 'Family Dinner',
      type: 'fixed',
      start: '22:00',
      end: '23:30',
      duration: '90 min',
      category: 'Personal',
      status: 'upcoming',
    },
    {
      _id: 'large-task',
      title: 'Full Mock Exam Simulation',
      type: 'flexible',
      start: '20:00',
      end: '23:00',
      duration: '180 min', // 3 hours
      category: 'Study',
      status: 'upcoming',
      expectedEnergy: 'HIGH',
      priority: 3,
    },
  ];

  // Current time is 21:00 (1260). Only 60 min before dinner (22:00) and 30 min before midnight.
  const result = replanEngine(activities, 'MEDIUM', 1260);

  const postponedTask = result.postponed.find((p) => p.activity._id === 'large-task');
  assert.ok(postponedTask, '180 min task cannot fit and must be suggested for postponement');
  assert.match(postponedTask.reason, /free time|slot/i, 'Reason must state insufficient time or slot');
});

// ── Test Case 6: No Overlapping Between Activities ────────────────────────────
test('6. Two activities are never assigned overlapping time slots', () => {
  const activities = [
    {
      _id: 'act-1',
      title: 'Task A',
      type: 'flexible',
      duration: '60 min',
      category: 'Study',
      status: 'upcoming',
      priority: 4,
    },
    {
      _id: 'act-2',
      title: 'Task B',
      type: 'flexible',
      duration: '45 min',
      category: 'Project',
      status: 'upcoming',
      priority: 3,
    },
    {
      _id: 'act-3',
      title: 'Task C',
      type: 'flexible',
      duration: '30 min',
      category: 'Personal',
      status: 'upcoming',
      priority: 2,
    },
  ];

  const result = replanEngine(activities, 'MEDIUM', 600); // 10:00 AM
  const scheduledList = result.scheduled.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

  for (let i = 0; i < scheduledList.length - 1; i++) {
    const currentEnd = toMinutes(scheduledList[i].end);
    const nextStart = toMinutes(scheduledList[i + 1].start);
    assert.ok(
      currentEnd <= nextStart,
      `Task ${scheduledList[i].title} (ends ${scheduledList[i].end}) overlaps with ${scheduledList[i + 1].title} (starts ${scheduledList[i + 1].start})`
    );
  }
});

// ── Test Case 7: Fixed Commitment Never Overwritten ───────────────────────────
test('7. A fixed commitment is never overwritten', () => {
  const fixed = {
    _id: 'fixed-class',
    title: 'Operating Systems Lecture',
    type: 'fixed',
    start: '13:00',
    end: '14:30',
    duration: '90 min',
    category: 'Study',
    status: 'upcoming',
  };

  const flexible = {
    _id: 'flex-task',
    title: 'Write Lab Report',
    type: 'flexible',
    start: '13:00', // Collides with lecture originally
    end: '14:00',
    duration: '60 min',
    category: 'Project',
    status: 'upcoming',
    priority: 5,
  };

  const result = replanEngine([fixed, flexible], 'MEDIUM', 720); // 12:00 PM
  const outputFixed = result.activities.find((a) => a._id === 'fixed-class');

  assert.ok(outputFixed, 'Fixed commitment must exist');
  assert.strictEqual(outputFixed.start, '13:00', 'Fixed start time must remain 13:00');
  assert.strictEqual(outputFixed.end, '14:30', 'Fixed end time must remain 14:30');
});

// ── Test Case 8: Schedule and Postponement Suggestions Are Consistent ─────────
test('8. The revised schedule and postponement suggestions are consistent and account for all items', () => {
  const activities = [
    { _id: 'f1', title: 'Task 1', type: 'flexible', duration: '60 min', category: 'Study', priority: 4 },
    { _id: 'f2', title: 'Task 2', type: 'flexible', duration: '120 min', category: 'Project', priority: 1, expectedEnergy: 'HIGH' },
    { _id: 'f3', title: 'Task 3', type: 'flexible', duration: '30 min', category: 'Personal', priority: 5 },
  ];

  // At 22:30 (1350 min), only 90 min left until midnight
  const result = replanEngine(activities, 'LOW', 1350);

  const totalCandidateIds = new Set(activities.map((a) => a._id));
  const scheduledIds = new Set(result.scheduled.map((a) => a._id));
  const postponedIds = new Set(result.postponed.map((p) => p.activity._id));

  // No activity is both scheduled and postponed
  for (const id of scheduledIds) {
    assert.strictEqual(postponedIds.has(id), false, `Task ${id} cannot be both scheduled and postponed`);
  }

  // All candidates are accounted for
  for (const id of totalCandidateIds) {
    assert.ok(scheduledIds.has(id) || postponedIds.has(id), `Task ${id} must be either scheduled or postponed`);
  }
});

// ── Test Case 9: Replanning Does Not Erase Completion Logs or Delete Tasks ────
test('9. Replanning does not erase previous completion logs or silently delete unscheduled tasks', () => {
  const completedTask = {
    _id: 'logged-1',
    title: 'Morning Run',
    type: 'flexible',
    start: '06:30',
    end: '07:15',
    duration: '45 min',
    actualDuration: 40,
    actualEnergy: 'MEDIUM',
    reflection: 'Felt refreshed and energized',
    category: 'Personal',
    status: 'done',
  };

  const missedTask = {
    _id: 'missed-1',
    title: 'Breakfast Reading',
    type: 'flexible',
    start: '07:30',
    end: '08:00',
    duration: '30 min',
    category: 'Study',
    status: 'upcoming',
  };

  const result = replanEngine([completedTask, missedTask], 'MEDIUM', 600); // 10:00 AM

  // 1. Completion log preserved
  const foundDone = result.activities.find((a) => a._id === 'logged-1');
  assert.strictEqual(foundDone.actualDuration, 40);
  assert.strictEqual(foundDone.reflection, 'Felt refreshed and energized');

  // 2. Missed task is NOT silently deleted; it is either rescheduled or postponed with explanation
  const foundMissed = result.activities.find((a) => a._id === 'missed-1');
  assert.ok(foundMissed, 'Missed task must not be silently deleted');
});

// ── Test Case 10: Duration Overrun Triggers Sensible Proposals ─────────────────
test('10. An activity that overruns its planned duration triggers a sensible proposal for the remaining activities', () => {
  // Scenario: Student planned Study Session from 14:00 to 15:00.
  // It is now 15:30 (30-minute overrun). The user calls replan.
  const activities = [
    {
      _id: 'overrun-task',
      title: 'Data Structures Problem Set',
      type: 'flexible',
      start: '14:00',
      end: '15:00', // Originally planned until 15:00, but time is now 15:30
      duration: '60 min',
      category: 'Study',
      status: 'done', // Logged as finished at 15:30
      actualDuration: 90,
    },
    {
      _id: 'next-task-1',
      title: 'Database Assignment',
      type: 'flexible',
      start: '15:00', // Was originally scheduled at 15:00
      end: '16:00',
      duration: '60 min',
      category: 'Study',
      status: 'upcoming',
      priority: 4,
    },
    {
      _id: 'next-task-2',
      title: 'Gym Workout',
      type: 'flexible',
      start: '16:00',
      end: '17:00',
      duration: '60 min',
      category: 'Personal',
      status: 'upcoming',
      priority: 3,
    },
  ];

  const currentTime = 930; // 15:30 (3:30 PM)
  const result = replanEngine(activities, 'MEDIUM', currentTime);

  // The remaining activities must be shifted forward to start at or after 15:30
  const rescheduledDb = result.scheduled.find((a) => a._id === 'next-task-1');
  assert.ok(rescheduledDb, 'Remaining Database Assignment should be rescheduled');
  assert.strictEqual(rescheduledDb.start, '15:30', 'Should now start at current time 15:30');
  assert.strictEqual(rescheduledDb.end, '16:30', 'Should end at 16:30');

  const rescheduledGym = result.scheduled.find((a) => a._id === 'next-task-2');
  assert.ok(rescheduledGym, 'Gym workout should follow without overlap');
  assert.strictEqual(rescheduledGym.start, '16:30', 'Should start after Database Assignment at 16:30');
  assert.strictEqual(rescheduledGym.end, '17:30', 'Should end at 17:30');
});
