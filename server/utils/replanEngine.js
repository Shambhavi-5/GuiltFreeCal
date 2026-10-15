/**
 * replanEngine.js
 * GuiltFreeCal — Energy-Aware Scheduling and Intelligent Replanning Engine
 *
 * Pure function: accepts schedule data, user energy, and current time,
 * and returns a proposed schedule plus postponement suggestions.
 * No I/O, no database queries, no external AI libraries.
 */

'use strict';

// ── Time & Duration Helpers ──────────────────────────────────────────────────

function toMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string' || !/^\d{1,2}:\d{2}$/.test(timeStr)) {
    return NaN;
  }
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return NaN;
  return h * 60 + m;
}

function toTime(minutes) {
  const normalized = Math.max(0, Math.min(1439, minutes));
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function parseDuration(dur) {
  if (typeof dur === 'number') return dur;
  const match = String(dur || '').match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 30;
}

/**
 * Normalizes user energy level to 'LOW', 'MEDIUM', or 'HIGH'.
 * Accepts number 1-5 or string ('LOW', 'MEDIUM', 'HIGH').
 */
function normalizeEnergy(energyInput) {
  if (typeof energyInput === 'string') {
    const upper = energyInput.toUpperCase();
    if (['LOW', 'MEDIUM', 'HIGH'].includes(upper)) return upper;
  }
  const num = Number(energyInput);
  if (num <= 2) return 'LOW';
  if (num >= 4) return 'HIGH';
  return 'MEDIUM';
}

/**
 * Normalizes task energy requirement to 'LOW', 'MEDIUM', or 'HIGH'.
 */
function normalizeTaskEnergy(activity) {
  if (activity.expectedEnergy) {
    const upper = String(activity.expectedEnergy).toUpperCase();
    if (['LOW', 'MEDIUM', 'HIGH'].includes(upper)) return upper;
  }
  // Fallback to legacy numeric energy if present
  if (typeof activity.energy === 'number') {
    if (activity.energy <= 2) return 'LOW';
    if (activity.energy >= 4) return 'HIGH';
  }
  return 'MEDIUM';
}

// ── Main Replanning Function ─────────────────────────────────────────────────

/**
 * Deterministic rule-based replanning algorithm:
 *
 * @param {Array} activities - List of user activities for the day
 * @param {number|string} userEnergy - Current user energy (1-5 or 'LOW'|'MEDIUM'|'HIGH')
 * @param {number} currentTimeMinutes - Minutes since midnight (e.g. 14:30 = 870)
 * @param {Object} [options] - Optional configurations (horizon, sleepTime, etc.)
 */
function replanEngine(activities, userEnergy, currentTimeMinutes, options = {}) {
  const currentEnergy = normalizeEnergy(userEnergy);
  const horizon = options.planningHorizonMinutes || 1440; // Default end of day: 24:00 (1440)

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 1 — Freeze the Past
  // Completed, partial, past activities, and currently in-progress activities
  // must remain unchanged and never be moved blindly.
  // ───────────────────────────────────────────────────────────────────────────
  const fixedCommitments = [];
  const completedOrPast = [];
  let inProgressActivity = null;
  const candidateActivities = [];

  for (const raw of activities) {
    const act = { ...raw };
    const startMin = toMinutes(act.start);
    const endMin = toMinutes(act.end);

    // Fixed commitments (classes, work, doctor appointments) can never be moved
    if (act.type === 'fixed') {
      fixedCommitments.push(act);
      continue;
    }

    // Already completed or partially completed activities are frozen
    if (act.status === 'done' || act.status === 'partial') {
      completedOrPast.push(act);
      continue;
    }

    // Explicitly in-progress activities (user is currently working on this)
    if (act.status === 'in-progress') {
      if (!inProgressActivity) {
        inProgressActivity = act;
        continue;
      }
    }

    // Flexible activities with status 'upcoming', 'missed', or 'skipped'
    // are eligible candidates for rescheduling.
    // If their previous start time was before now, they were delayed or missed.
    const wasDelayedOrMissed = !isNaN(startMin) && startMin < currentTimeMinutes;
    candidateActivities.push({
      ...act,
      _wasMissed: wasDelayedOrMissed,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 2 — Calculate Remaining Free Time Slots
  // Identify free continuous slots between currentTimeMinutes and planning horizon,
  // strictly excluding fixed commitments and ongoing tasks.
  // ───────────────────────────────────────────────────────────────────────────
  const blockedIntervals = [];

  // In-progress task blocks time until it finishes
  if (inProgressActivity) {
    blockedIntervals.push({
      start: currentTimeMinutes,
      end: toMinutes(inProgressActivity.end),
      label: inProgressActivity.title,
    });
  }

  // Future fixed commitments block time
  for (const f of fixedCommitments) {
    const fStart = toMinutes(f.start);
    const fEnd = toMinutes(f.end);
    if (!isNaN(fStart) && !isNaN(fEnd) && fEnd > currentTimeMinutes) {
      blockedIntervals.push({
        start: Math.max(currentTimeMinutes, fStart),
        end: Math.min(horizon, fEnd),
        label: f.title,
      });
    }
  }

  // Sort and merge blocked intervals
  blockedIntervals.sort((a, b) => a.start - b.start);
  const mergedBlocked = [];
  for (const block of blockedIntervals) {
    if (mergedBlocked.length === 0) {
      mergedBlocked.push({ ...block });
    } else {
      const prev = mergedBlocked[mergedBlocked.length - 1];
      if (block.start <= prev.end) {
        prev.end = Math.max(prev.end, block.end);
      } else {
        mergedBlocked.push({ ...block });
      }
    }
  }

  // Compute available free time slots
  const freeSlots = [];
  let slotCursor = currentTimeMinutes;

  for (const block of mergedBlocked) {
    if (block.start > slotCursor) {
      freeSlots.push({
        start: slotCursor,
        end: block.start,
        duration: block.start - slotCursor,
      });
    }
    slotCursor = Math.max(slotCursor, block.end);
  }

  if (slotCursor < horizon) {
    freeSlots.push({
      start: slotCursor,
      end: horizon,
      duration: horizon - slotCursor,
    });
  }

  const totalFreeMinutesRemaining = freeSlots.reduce((sum, s) => sum + s.duration, 0);

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 3 & 4 — Match Energy to Tasks & Filter Candidates
  // Evaluate each candidate task's energy requirement against user's energy level.
  // ───────────────────────────────────────────────────────────────────────────
  // Clone candidate tasks and attach metadata
  const evaluatedTasks = candidateActivities.map((task) => {
    const taskEnergy = normalizeTaskEnergy(task);
    const duration = parseDuration(task.duration);
    const priority = Math.max(1, Math.min(5, Number(task.priority) || 3));
    const deadlineMinutes = task.deadline ? toMinutes(task.deadline) : null;

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 5 — Rank Activities Using Transparent Scoring
    // Formula: Score = (Priority * 20) + EnergyMatchScore + DeadlineScore
    // ─────────────────────────────────────────────────────────────────────────
    const priorityScore = priority * 20; // 20 to 100

    let energyMatchScore = 0;
    let energySuitability = 'GOOD'; // 'GOOD', 'ACCEPTABLE', 'MISMATCH'

    if (currentEnergy === 'HIGH') {
      // User has great energy: high-demand tasks are welcomed
      if (taskEnergy === 'HIGH') {
        energyMatchScore = 25;
      } else if (taskEnergy === 'MEDIUM') {
        energyMatchScore = 15;
      } else {
        energyMatchScore = 10;
      }
    } else if (currentEnergy === 'MEDIUM') {
      // Steady pace: medium and low tasks preferred
      if (taskEnergy === 'MEDIUM') {
        energyMatchScore = 20;
      } else if (taskEnergy === 'LOW') {
        energyMatchScore = 15;
      } else {
        energyMatchScore = -15; // High energy tasks are harder right now
        energySuitability = 'MISMATCH';
      }
    } else {
      // LOW energy: prioritize low-demand tasks; deprioritize high-demand tasks
      if (taskEnergy === 'LOW') {
        energyMatchScore = 30; // Gentle tasks strongly preferred
      } else if (taskEnergy === 'MEDIUM') {
        energyMatchScore = 5;
        energySuitability = 'ACCEPTABLE';
      } else {
        // High-demand task when user is exhausted
        const isUrgent = priority >= 5 || (deadlineMinutes && deadlineMinutes <= currentTimeMinutes + 240);
        if (isUrgent) {
          // Justified by critical priority or near deadline
          energyMatchScore = -5;
          energySuitability = 'ACCEPTABLE';
        } else {
          // Significant penalty: postpone to protect student well-being
          energyMatchScore = -40;
          energySuitability = 'MISMATCH';
        }
      }
    }

    // Deadline urgency score
    let deadlineScore = 0;
    if (deadlineMinutes && !isNaN(deadlineMinutes)) {
      const minutesUntilDeadline = deadlineMinutes - currentTimeMinutes;
      if (minutesUntilDeadline > 0) {
        // Earlier deadline gets higher score (up to +40 points)
        deadlineScore = Math.max(0, Math.round(40 * (1 - Math.min(minutesUntilDeadline, 480) / 480)));
      } else {
        // Deadline has passed or is right now
        deadlineScore = 40;
      }
    }

    const totalScore = priorityScore + energyMatchScore + deadlineScore;

    return {
      ...task,
      _taskEnergy: taskEnergy,
      _durationMinutes: duration,
      _priority: priority,
      _deadlineMinutes: deadlineMinutes,
      _totalScore: totalScore,
      _energySuitability: energySuitability,
    };
  });

  // Sort candidate activities descending by totalScore
  // Tie-breaker: earlier deadline, then higher priority, then original start time
  evaluatedTasks.sort((a, b) => {
    if (b._totalScore !== a._totalScore) return b._totalScore - a._totalScore;
    if (a._deadlineMinutes && b._deadlineMinutes && a._deadlineMinutes !== b._deadlineMinutes) {
      return a._deadlineMinutes - b._deadlineMinutes;
    }
    if (b._priority !== a._priority) return b._priority - a._priority;
    return (a.start || '').localeCompare(b.start || '');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 6 — Assign Future Slots
  // Place ranked activities into available free time slots without overlapping.
  // ───────────────────────────────────────────────────────────────────────────
  const scheduled = [];
  const postponed = [];
  const adjustments = [];

  // Available free slots working list
  const availableSlots = freeSlots.map((s) => ({ ...s }));

  for (const task of evaluatedTasks) {
    const duration = task._durationMinutes;
    let placed = false;

    // Check if task is a poor energy fit during LOW energy without high urgency
    if (currentEnergy === 'LOW' && task._taskEnergy === 'HIGH' && task._priority < 4 && !task._deadlineMinutes) {
      postponed.push({
        activity: cleanTask(task),
        reason: 'Consider doing this tomorrow when your energy is higher — you reported low energy and this is a demanding high-energy task.',
        code: 'LOW_ENERGY_MISMATCH',
      });
      adjustments.push(`Suggested postponing "${task.title}" to protect your energy.`);
      continue;
    }

    // Find the first available free slot that can accommodate this task's duration
    for (let sIndex = 0; sIndex < availableSlots.length; sIndex++) {
      const slot = availableSlots[sIndex];

      if (slot.duration >= duration) {
        // Check deadline constraint: must complete before deadline if deadline exists
        if (task._deadlineMinutes && slot.start + duration > task._deadlineMinutes) {
          // Cannot finish before deadline in this slot
          continue;
        }

        const taskStart = slot.start;
        const taskEnd = taskStart + duration;

        const scheduledTask = {
          ...cleanTask(task),
          start: toTime(taskStart),
          end: toTime(taskEnd),
          duration: `${duration} min`,
          status: 'upcoming',
        };

        scheduled.push(scheduledTask);
        placed = true;

        if (task.start !== scheduledTask.start) {
          adjustments.push(
            `Rescheduled "${task.title}" from ${task.start || 'unscheduled'} to ${scheduledTask.start}–${scheduledTask.end}`
          );
        } else {
          adjustments.push(`Kept "${task.title}" at ${scheduledTask.start}`);
        }

        // Consume time from the slot
        slot.start = taskEnd;
        slot.duration = slot.end - taskEnd;

        // If slot is completely used, remove it
        if (slot.duration <= 0) {
          availableSlots.splice(sIndex, 1);
        }
        break;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 7 — Produce Postponement Suggestions
    // If the task could not be placed in any remaining slot, give a clear reason.
    // ─────────────────────────────────────────────────────────────────────────
    if (!placed) {
      let reason = '';
      let code = 'NO_SLOT';

      const maxAvailableSlot = availableSlots.reduce((max, s) => Math.max(max, s.duration), 0);

      if (duration > totalFreeMinutesRemaining) {
        reason = `Postpone this task: there isn't enough free time remaining today (needs ${duration} min, but only ${totalFreeMinutesRemaining} min free).`;
        code = 'INSUFFICIENT_TOTAL_TIME';
      } else if (duration > maxAvailableSlot) {
        reason = `This task needs ${duration} minutes, but the largest remaining continuous slot is only ${maxAvailableSlot} minutes.`;
        code = 'SLOT_TOO_SMALL';
      } else if (task._deadlineMinutes && task._deadlineMinutes <= currentTimeMinutes + duration) {
        reason = `Cannot complete before its deadline (${task.deadline}) without overlapping existing commitments.`;
        code = 'DEADLINE_UNATTAINABLE';
      } else {
        reason = 'A higher-priority task or commitment was scheduled first, filling the remaining available slots.';
        code = 'LOWER_PRIORITY_DISPLACED';
      }

      postponed.push({
        activity: cleanTask(task),
        reason,
        code,
      });

      adjustments.push(`Suggested postponing "${task.title}": ${reason}`);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Diagnostic Summary & Insights
  // ───────────────────────────────────────────────────────────────────────────
  const energyLabel =
    currentEnergy === 'LOW'
      ? 'Low energy mode'
      : currentEnergy === 'MEDIUM'
      ? 'Steady pace mode'
      : 'High energy mode';

  const diagnosis =
    currentEnergy === 'LOW'
      ? "You're running low on energy today. We prioritized gentle, essential tasks and protected your free time. Heavy tasks can wait for when you feel refreshed — progress still counts."
      : currentEnergy === 'MEDIUM'
      ? "You're at a steady pace today. Your flexible tasks have been balanced around your commitments so you can work comfortably without rushing."
      : "You've got great energy today! We've scheduled your high-priority and demanding tasks into your best available time slots so you can make strong progress.";

  const totalWorkMinutes = scheduled
    .filter((a) => a.category !== 'Break')
    .reduce((sum, a) => sum + parseDuration(a.duration), 0);

  const totalRestMinutes = scheduled
    .filter((a) => a.category === 'Break')
    .reduce((sum, a) => sum + parseDuration(a.duration), 0);

  const insights = {
    energyLabel,
    currentEnergy,
    diagnosis,
    adjustments: adjustments.length ? adjustments : ['No schedule changes were required.'],
    totalWorkMinutes,
    totalRestMinutes,
    postponedCount: postponed.length,
    freeMinutesRemaining: totalFreeMinutesRemaining,
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Merge All Activities for Full Schedule Output
  // Preserve fixed, completed, and in-progress tasks as-is.
  // ───────────────────────────────────────────────────────────────────────────
  const unchangedList = [
    ...fixedCommitments,
    ...completedOrPast,
    ...(inProgressActivity ? [inProgressActivity] : []),
  ];

  // Postponed activities are retained with their status set to 'skipped' / postponed
  // so they are never silently deleted.
  const postponedAsSkipped = postponed.map((p) => ({
    ...p.activity,
    status: 'skipped',
    postponedReason: p.reason,
    // Keep original start/end so user can see what was postponed
  }));

  const allMerged = [...unchangedList, ...scheduled, ...postponedAsSkipped];

  // Sort final schedule chronologically by start time
  allMerged.sort((a, b) => {
    const aMin = toMinutes(a.start);
    const bMin = toMinutes(b.start);
    if (isNaN(aMin) && isNaN(bMin)) return 0;
    if (isNaN(aMin)) return 1;
    if (isNaN(bMin)) return -1;
    return aMin - bMin;
  });

  return {
    activities: allMerged,
    scheduled,
    postponed,
    unchanged: unchangedList,
    insights,
  };
}

// Helper to remove temporary internal engine properties before returning
function cleanTask(task) {
  const copy = { ...task };
  delete copy._taskEnergy;
  delete copy._durationMinutes;
  delete copy._priority;
  delete copy._deadlineMinutes;
  delete copy._totalScore;
  delete copy._energySuitability;
  delete copy._wasMissed;
  return copy;
}

// Export module functions
module.exports = replanEngine;
module.exports.toMinutes = toMinutes;
module.exports.toTime = toTime;
module.exports.parseDuration = parseDuration;
module.exports.normalizeEnergy = normalizeEnergy;
module.exports.normalizeTaskEnergy = normalizeTaskEnergy;
