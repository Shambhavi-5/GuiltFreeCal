require("dotenv").config();

const dns = require("dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const Activity = require("./models/Activity");
const ReplanHistory = require('./models/ReplanHistory');
const replanEngine = require('./utils/replanEngine');

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

// Home route
app.get("/", (req, res) => {
  res.send("Guilt-Free Calendar API is running!");
});

// Check backend and database connection
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Backend is working!",
    database:
      mongoose.connection.readyState === 1
        ? "Connected"
        : "Disconnected",
  });
});

// GET: Fetch activities for a particular date
app.get("/api/activities", async (req, res) => {
  try {
    const date =
      req.query.date || new Date().toLocaleDateString("en-CA");

    const activities = await Activity.find({ date }).sort({
      start: 1,
    });

    res.json({
      success: true,
      count: activities.length,
      activities,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Could not fetch activities.",
      error: error.message,
    });
  }
});

// POST: Add a new activity
app.post("/api/activities", async (req, res) => {
  try {
    const activity = await Activity.create(req.body);

    res.status(201).json({
      success: true,
      message: "Activity created successfully!",
      activity,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: "Could not create activity.",
      error: error.message,
    });
  }
});

// POST: Energy-aware replan — runs replanEngine and saves history
app.post('/api/replan', async (req, res) => {
  try {
    const { date, energy, currentTimeMinutes } = req.body;

    if (!date || !energy || currentTimeMinutes === undefined) {
      return res.status(400).json({ success: false, message: 'date, energy, and currentTimeMinutes are required.' });
    }

    // Re-fetch activities from DB to avoid trusting stale or tampered client state.
    // This is the authoritative source of truth for the schedule.
    const dbActivities = await Activity.find({ date }).sort({ start: 1 }).lean();

    const snapshotBefore = JSON.parse(JSON.stringify(dbActivities));
    const result = replanEngine(dbActivities, energy, currentTimeMinutes);
    const { activities: rescheduled, insights } = result;

    // Save time changes for existing DB activities (those with real _id).
    // Exclude skipped activities from start/end/duration updates — their start/end
    // are sentinel values ('23:59') and must not overwrite the original scheduled times.
    // Skipped activities have only their status updated separately.
    // Include `date` in the filter to prevent cross-date overwrites.
    const updatePromises = rescheduled
      .filter(a => a._id && !String(a._id).startsWith('rest-') && a.status !== 'skipped')
      .map(a => Activity.findOneAndUpdate(
        { _id: a._id, date },
        { $set: { start: a.start, end: a.end, duration: a.duration, status: a.status } },
        { new: true, runValidators: true }
      ));

    const skippedUpdatePromises = rescheduled
      .filter(a => a._id && !String(a._id).startsWith('rest-') && a.status === 'skipped')
      .map(a => Activity.findOneAndUpdate(
        { _id: a._id, date },
        { $set: { status: 'skipped' } },
        { new: true, runValidators: true }
      ));

    const savedActivities = await Promise.all([...updatePromises, ...skippedUpdatePromises]);
    const savedById = new Map(
      savedActivities.filter(Boolean).map(a => [a._id.toString(), a])
    );

    // Merge: use saved DB records where available, keep synthetic rest breaks as-is
    const finalActivities = rescheduled.map(a => {
      if (a._id && savedById.has(String(a._id))) return savedById.get(String(a._id));
      return a;
    });

    finalActivities.sort((a, b) => a.start.localeCompare(b.start));

    // Strip sentinel times from skipped activities before storing the snapshot,
    // so history views show the original scheduled times rather than '23:59'.
    // Build a lookup of original times from snapshotBefore.
    const originalTimesById = new Map(
      snapshotBefore
        .filter(a => a._id)
        .map(a => [String(a._id), { start: a.start, end: a.end, duration: a.duration }])
    );

    const snapshotAfterClean = finalActivities.map(a => {
      if (a.status === 'skipped' && a._id && originalTimesById.has(String(a._id))) {
        const orig = originalTimesById.get(String(a._id));
        return { ...a, start: orig.start, end: orig.end, duration: orig.duration };
      }
      return a;
    });

    const historyRecord = await ReplanHistory.create({
      date,
      energyAtReplan: energy,
      energyLabel: insights.energyLabel,
      diagnosis: insights.diagnosis,
      adjustments: insights.adjustments,
      totalWorkMinutes: insights.totalWorkMinutes,
      totalRestMinutes: insights.totalRestMinutes,
      skippedCount: insights.skippedCount,
      snapshotBefore,
      snapshotAfter: snapshotAfterClean,
    });

    res.json({ success: true, activities: finalActivities, insights, historyId: historyRecord._id });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Could not replan the schedule.', error: error.message });
  }
});

// GET: Replan history (optionally filtered by date)
app.get('/api/replan/history', async (req, res) => {
  try {
    let records;
    if (req.query.date) {
      records = await ReplanHistory.find({ date: req.query.date }).sort({ replanAt: -1 });
    } else {
      records = await ReplanHistory.find().sort({ replanAt: -1 }).limit(30);
    }
    res.json({ success: true, count: records.length, records });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Could not fetch replan history.', error: error.message });
  }
});

// GET: Single history record by ID
app.get('/api/replan/history/:id', async (req, res) => {
  try {
    const record = await ReplanHistory.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'History record not found.' });
    res.json({ success: true, record });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Could not fetch history record.', error: error.message });
  }
});

// PATCH: Replan the schedule
// IMPORTANT: Keep this route BEFORE /api/activities/:id
app.patch("/api/activities/replan", async (req, res) => {
console.log("REPLAN ROUTE WAS CALLED");
  try {
    const { activities } = req.body;

    if (!Array.isArray(activities)) {
      return res.status(400).json({
        success: false,
        message: "Activities must be provided as an array.",
      });
    }

    const results = await Promise.all(
      activities.map(async (item) => {
        if (!item._id) {
          throw new Error("An activity is missing its ID.");
        }

        const updates = {};

        if (item.start !== undefined) {
          updates.start = item.start;
        }

        if (item.end !== undefined) {
          updates.end = item.end;
        }

        if (item.duration !== undefined) {
          updates.duration = item.duration;
        }

        return Activity.findByIdAndUpdate(
          item._id,
          { $set: updates },
          {
            new: true,
            runValidators: true,
          }
        );
      })
    );

    if (results.some((activity) => !activity)) {
      return res.status(404).json({
        success: false,
        message: "One or more activities could not be found.",
      });
    }

    res.json({
      success: true,
      message: "Replanned schedule saved successfully!",
      activities: results,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: "Could not save the replanned schedule.",
      error: error.message,
    });
  }
});

// PATCH: Update an individual activity
// This general route comes AFTER the specific replan route
app.patch("/api/activities/:id", async (req, res) => {
  try {
    const allowedFields = [
      "status",
      "energy",
      "title",
      "category",
      "start",
      "end",
      "duration",
      "type",
      "date",
    ];

    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    const activity = await Activity.findByIdAndUpdate(
      req.params.id,
      updates,
      {
        new: true,
        runValidators: true,
      }
    );

    if (!activity) {
      return res.status(404).json({
        success: false,
        message: "Activity not found.",
      });
    }

    res.json({
      success: true,
      message: "Activity updated successfully!",
      activity,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: "Could not update activity.",
      error: error.message,
    });
  }
});

// Start server only after MongoDB connects
async function startServer() {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    console.log("MongoDB connected successfully!");

    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
}

startServer();
