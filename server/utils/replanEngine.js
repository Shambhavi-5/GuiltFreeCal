/**
 * replanEngine.js
 * Pure function — no I/O, no DB calls.
 * Given the day's activities, an energy level (1-5), and the current time
 * in minutes-since-midnight, returns a rescheduled activities array plus
 * an insights object explaining what changed and why.
 */

'use strict';

// ── Helpers ──────────────────────────────────────────────────────────────────

function toMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string' || !/^\d{1,2}:\d{2}$/.test(timeStr)) {
    return NaN;
  }
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return NaN;
  return h * 60 + m;
}

function toTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function parseDuration(durStr) {
  // '90 min' → 90, '60 min' → 60, etc.
  const match = String(durStr).match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 30;
}

// ── Main export ───────────────────────────────────────────────────────────────

module.exports = function replanEngine(activities, energy, currentTimeMinutes) {
  // ── 1. Separate activities ─────────────────────────────────────────────────
  const fixed     = activities.filter(a => a.type === 'fixed');
  const unchanged = activities.filter(a => a.type !== 'fixed' && a.status !== 'upcoming');
  const movable   = activities
    .filter(a => a.status === 'upcoming' && a.type === 'flexible')
    // Guard: only include activities with valid start/end time strings
    .filter(a => !isNaN(toMinutes(a.start)) && !isNaN(toMinutes(a.end)))
    .map(a => ({ ...a })); // shallow clone so we don't mutate callers' objects

  // ── 2. Energy-based duration adjustment ───────────────────────────────────
  const originalDurations = {};
  movable.forEach(a => {
    originalDurations[a._id || a.title] = parseDuration(a.duration);
  });

  movable.forEach(a => {
    const orig = parseDuration(a.duration);
    let adjusted;
    if (energy <= 2) {
      adjusted = Math.max(10, Math.round(orig * 0.70));
    } else if (energy >= 4) {
      adjusted = Math.round(orig * 1.20);
    } else {
      adjusted = orig;
    }
    a._adjustedDuration = adjusted;
    a._originalDuration = orig;
  });

  // ── 3. Energy-based ordering ──────────────────────────────────────────────
  const HEAVY_CATS = ['Study', 'Project'];

  if (energy <= 2) {
    // Sort Study/Project to end; within each group keep original start-time order
    movable.sort((a, b) => {
      const aHeavy = HEAVY_CATS.includes(a.category) ? 1 : 0;
      const bHeavy = HEAVY_CATS.includes(b.category) ? 1 : 0;
      if (aHeavy !== bHeavy) return aHeavy - bHeavy;
      return a.start.localeCompare(b.start);
    });
  } else if (energy >= 4) {
    // Group by category in the order Study → Project → Personal → Break
    const catOrder = { Study: 0, Project: 1, Personal: 2, Break: 3 };
    movable.sort((a, b) => {
      const ao = catOrder[a.category] ?? 99;
      const bo = catOrder[b.category] ?? 99;
      if (ao !== bo) return ao - bo;
      return a.start.localeCompare(b.start);
    });
  } else {
    // Energy 3: keep original order (sort by start time)
    movable.sort((a, b) => a.start.localeCompare(b.start));
  }

  // ── 4. Build schedule ─────────────────────────────────────────────────────
  const upcomingFixed = fixed
    .filter(a => !isNaN(toMinutes(a.start)) && !isNaN(toMinutes(a.end)) && toMinutes(a.end) > currentTimeMinutes)
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

  const lowEnergyCap = currentTimeMinutes + 360; // 6 hours

  let cursor = currentTimeMinutes;
  let workSinceLastRest = 0; // minutes of non-Break work since last rest break
  const scheduled = [];
  const adjustments = [];

  for (let i = 0; i < movable.length; i++) {
    const activity = movable[i];
    const adjustedDuration = activity._adjustedDuration;

    // ── Low-energy rest break insertion (pre-check) ────────────────────────
    // If we've already accumulated >=60 work-minutes before this activity,
    // insert a rest break first (pre-existing surplus from last activity).
    if (energy <= 2 && workSinceLastRest >= 60 && activity.category !== 'Break') {
      const restStart = cursor;
      const restEnd   = cursor + 15;

      if (restEnd <= 1440 && restEnd <= lowEnergyCap) {
        const restBreak = {
          title:    'Rest break',
          category: 'Break',
          type:     'flexible',
          status:   'upcoming',
          energy:   energy,
          date:     activity.date,
          start:    toTime(restStart),
          end:      toTime(restEnd),
          duration: '15 min',
          _id:      `rest-${Date.now()}-${Math.random()}`,
        };
        scheduled.push(restBreak);
        adjustments.push(`Added rest break at ${toTime(restStart)}`);
        cursor = restEnd;
        workSinceLastRest = 0;
      }
    }

    // ── Check for fixed-activity conflicts ─────────────────────────────────
    // Find the next fixed activity that starts at or after cursor
    const nextFixed = upcomingFixed.find(f => toMinutes(f.start) >= cursor);

    let start = cursor;
    let end   = start + adjustedDuration;

    if (nextFixed && end > toMinutes(nextFixed.start)) {
      const gap = toMinutes(nextFixed.start) - cursor;
      if (gap >= 15) {
        // Truncate to fit before the fixed block
        end = toMinutes(nextFixed.start);
      } else {
        // Jump after the fixed block
        start = toMinutes(nextFixed.end);
        end   = start + adjustedDuration;
      }
    }

    // Re-check for any fixed activity that still overlaps [start, end]
    const overlapping = upcomingFixed.find(
      f => start < toMinutes(f.end) && end > toMinutes(f.start)
    );
    if (overlapping) {
      start = toMinutes(overlapping.end);
      end   = start + adjustedDuration;
    }

    // ── Cap checks ─────────────────────────────────────────────────────────
    if (end > 1440 || (energy <= 2 && start > lowEnergyCap)) {
      // Use sentinel start '23:59' so skipped activities sort to the tail
      const skipped = { ...activity, status: 'skipped', start: '23:59', end: '23:59' };
      delete skipped._adjustedDuration;
      delete skipped._originalDuration;
      scheduled.push(skipped);
      adjustments.push(`${activity.title} skipped — not enough time`);
      // Do NOT advance cursor
      continue;
    }

    // ── Place the activity ─────────────────────────────────────────────────
    const origStart = activity.start;
    const origDur   = activity._originalDuration;
    const placed = {
      ...activity,
      start:    toTime(start),
      end:      toTime(end),
      duration: `${end - start} min`,
    };
    delete placed._adjustedDuration;
    delete placed._originalDuration;
    scheduled.push(placed);
    cursor = end;

    // Track work time for low-energy rest insertion
    if (activity.category !== 'Break') {
      const workAdded = end - start;
      workSinceLastRest += workAdded;

      // Post-placement check: if a single activity crossed the 60-min boundary,
      // insert a rest break immediately after it (retroactively into scheduled).
      // This handles the case where one long task > 60 min runs without a break.
      if (energy <= 2 && workSinceLastRest >= 60) {
        const restStart = cursor;
        const restEnd   = cursor + 15;
        if (restEnd <= 1440 && restEnd <= lowEnergyCap) {
          const restBreak = {
            title:    'Rest break',
            category: 'Break',
            type:     'flexible',
            status:   'upcoming',
            energy:   energy,
            date:     activity.date,
            start:    toTime(restStart),
            end:      toTime(restEnd),
            duration: '15 min',
            _id:      `rest-${Date.now()}-${Math.random()}`,
          };
          scheduled.push(restBreak);
          adjustments.push(`Added rest break at ${toTime(restStart)}`);
          cursor = restEnd;
          workSinceLastRest = 0;
        }
      }
    } else {
      workSinceLastRest = 0;
    }

    // ── Build adjustment strings ───────────────────────────────────────────
    if (energy <= 2 && placed.duration !== `${origDur} min`) {
      adjustments.push(`Shortened ${activity.title} from ${origDur} min to ${end - start} min`);
    } else if (energy >= 4 && placed.duration !== `${origDur} min`) {
      adjustments.push(`Extended ${activity.title} from ${origDur} min to ${end - start} min`);
    }

    if (energy <= 2 && HEAVY_CATS.includes(activity.category) && placed.start !== origStart) {
      adjustments.push(`Moved ${activity.title} later due to low energy`);
    } else if (placed.start !== origStart) {
      adjustments.push(`Rescheduled ${activity.title} from ${origStart} to ${placed.start}`);
    }
  }

  if (adjustments.length === 0) {
    adjustments.push('No changes needed — your schedule looks good.');
  }

  // ── 5. Build insights ─────────────────────────────────────────────────────
  const energyLabel =
    energy <= 2 ? 'Low energy mode' :
    energy === 3 ? 'Steady pace mode' :
    'High energy mode';

  const diagnosis =
    energy <= 2
      ? "You're running low on energy today. I've shortened your flexible tasks and added recovery breaks so you don't burn out. Heavy tasks like studying and project work have been moved to when you might feel better. It's okay to take it slow — progress still counts."
      : energy === 3
      ? "You're at a steady pace today. I've kept your schedule as planned but rearranged the order to flow better. No major changes needed — just stay consistent and give yourself grace."
      : "You've got great energy today! I've given your flexible tasks a bit more breathing room and grouped similar work together so you can get into a flow state. Make the most of it, but don't forget to rest.";

  const allScheduled = [...scheduled];

  const totalWorkMinutes = allScheduled
    .filter(a => a.status !== 'skipped' && a.category !== 'Break')
    .reduce((sum, a) => sum + parseDuration(a.duration), 0);

  const totalRestMinutes = allScheduled
    .filter(a => a.status !== 'skipped' && a.category === 'Break')
    .reduce((sum, a) => sum + parseDuration(a.duration), 0);

  const skippedCount = allScheduled.filter(a => a.status === 'skipped').length;

  const insights = {
    energyLabel,
    adjustments,
    diagnosis,
    totalWorkMinutes,
    totalRestMinutes,
    skippedCount,
  };

  // ── 6. Merge all activities and sort by start time ─────────────────────────
  // fixed + unchanged activities stay as-is; scheduled replaces movable.
  // Deduplicate by _id so done/partial activities that appear in both the
  // unchanged bucket and a previous replan's output don't produce duplicate
  // time entries. The scheduled version wins over the unchanged version because
  // it was processed last (Map insertion order: later writes win).
  const fixedClean     = fixed.map(a => ({ ...a }));
  const unchangedClean = unchanged.map(a => ({ ...a }));

  const merged = new Map();
  for (const a of [...fixedClean, ...unchangedClean, ...allScheduled]) {
    const key = a._id ? String(a._id) : `${a.title}-${a.start}`;
    merged.set(key, a);
  }
  const result = [...merged.values()];

  // Sort by start time (HH:MM string comparison works fine here)
  // NaN-safe: activities with malformed start times sort to the end
  result.sort((a, b) => {
    const aMin = toMinutes(a.start);
    const bMin = toMinutes(b.start);
    if (isNaN(aMin) && isNaN(bMin)) return 0;
    if (isNaN(aMin)) return 1;
    if (isNaN(bMin)) return -1;
    return aMin - bMin;
  });

  return { activities: result, insights };
};
