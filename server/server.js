require("dotenv").config();

const dns = require("dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const User = require("./models/User");
const Activity = require("./models/Activity");
const ReplanHistory = require("./models/ReplanHistory");
const replanEngine = require("./utils/replanEngine");

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

// ── In-Memory Fallback Store (for offline or unwhitelisted IP demos) ──────────
let useMemoryStore = false;
const memoryUsers = [
  {
    _id: "demo-user-1",
    name: "Alex Student",
    email: "student@college.edu",
    password: "password123",
  },
];
const memoryActivities = [];
const memoryHistory = [];

const MemoryStore = {
  findUserByEmail(email) {
    return memoryUsers.find((u) => u.email.toLowerCase() === email.toLowerCase());
  },
  createUser(data) {
    const user = {
      ...data,
      _id: `user-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      createdAt: new Date(),
    };
    memoryUsers.push(user);
    return user;
  },
  findActivities(query = {}) {
    let res = memoryActivities.filter((a) => {
      const matchDate = !query.date || a.date === query.date;
      const matchUser = !query.userId || a.userId === query.userId || a.userId === "default-user";
      return matchDate && matchUser;
    });
    return res.sort((a, b) => (a.start || "").localeCompare(b.start || ""));
  },
  createActivity(data) {
    const act = {
      ...data,
      _id: `mem-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      userId: data.userId || "default-user",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memoryActivities.push(act);
    return act;
  },
  updateActivity(id, updates) {
    const idx = memoryActivities.findIndex((a) => String(a._id) === String(id));
    if (idx === -1) return null;
    memoryActivities[idx] = {
      ...memoryActivities[idx],
      ...updates,
      updatedAt: new Date(),
    };
    return memoryActivities[idx];
  },
  deleteActivity(id) {
    const idx = memoryActivities.findIndex((a) => String(a._id) === String(id));
    if (idx === -1) return null;
    return memoryActivities.splice(idx, 1)[0];
  },
  createHistory(data) {
    const rec = {
      ...data,
      _id: `hist-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      userId: data.userId || "default-user",
      createdAt: new Date(),
    };
    memoryHistory.unshift(rec);
    return rec;
  },
  findHistory(query = {}) {
    return memoryHistory.filter((h) => {
      const matchDate = !query.date || h.date === query.date;
      const matchUser = !query.userId || h.userId === query.userId || h.userId === "default-user";
      return matchDate && matchUser;
    });
  },
};

// ── Authentication Routes ────────────────────────────────────────────────────

// POST: Register a new user
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and password are required.",
      });
    }

    if (password.length < 4) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 4 characters long.",
      });
    }

    let existing;
    if (useMemoryStore) {
      existing = MemoryStore.findUserByEmail(email);
    } else {
      existing = await User.findOne({ email: email.toLowerCase() });
    }

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "An account with this email already exists. Please log in.",
      });
    }

    let newUser;
    if (useMemoryStore) {
      newUser = MemoryStore.createUser({ name, email: email.toLowerCase(), password });
    } else {
      newUser = await User.create({ name, email: email.toLowerCase(), password });
    }

    res.status(201).json({
      success: true,
      message: "Account created successfully!",
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Registration failed.",
      error: error.message,
    });
  }
});

// POST: Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    let user;
    if (useMemoryStore) {
      user = MemoryStore.findUserByEmail(email);
    } else {
      user = await User.findOne({ email: email.toLowerCase() });
    }

    if (!user || user.password !== password) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    res.json({
      success: true,
      message: "Welcome back!",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Login failed.",
      error: error.message,
    });
  }
});

// ── General Routes ───────────────────────────────────────────────────────────

// Home route
app.get("/", (req, res) => {
  res.send("Guilt-Free Calendar API is running!");
});

// Check backend and database connection
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Backend is working!",
    mode: useMemoryStore ? "In-Memory Demo Mode" : "MongoDB Atlas",
    database:
      mongoose.connection.readyState === 1
        ? "Connected"
        : useMemoryStore
        ? "In-Memory Ready"
        : "Disconnected",
  });
});

// GET: Fetch activities for a particular date
app.get("/api/activities", async (req, res) => {
  try {
    const date = req.query.date || new Date().toLocaleDateString("en-CA");
    const userId = req.query.userId || "default-user";

    let activities;
    if (useMemoryStore) {
      activities = MemoryStore.findActivities({ date, userId });
    } else {
      activities = await Activity.find({
        date,
        $or: [{ userId }, { userId: "default-user" }, { userId: { $exists: false } }],
      })
        .sort({ start: 1 })
        .lean();
    }

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
    const activityData = {
      ...req.body,
      userId: req.body.userId || "default-user",
    };

    let activity;
    if (useMemoryStore) {
      activity = MemoryStore.createActivity(activityData);
    } else {
      activity = await Activity.create(activityData);
    }

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

// POST: Energy-aware replan — supports preview mode and explicit confirmation
app.post("/api/replan", async (req, res) => {
  try {
    const { date, energy, currentTimeMinutes, preview, userId = "default-user" } = req.body;

    if (!date || !energy || currentTimeMinutes === undefined) {
      return res.status(400).json({
        success: false,
        message: "date, energy, and currentTimeMinutes are required.",
      });
    }

    // Authoritative source of truth: fetch day's schedule from storage
    let dbActivities;
    if (useMemoryStore) {
      dbActivities = MemoryStore.findActivities({ date, userId });
    } else {
      dbActivities = await Activity.find({
        date,
        $or: [{ userId }, { userId: "default-user" }, { userId: { $exists: false } }],
      })
        .sort({ start: 1 })
        .lean();
    }

    const snapshotBefore = JSON.parse(JSON.stringify(dbActivities));

    // Run the pure deterministic replanning algorithm
    const result = replanEngine(dbActivities, energy, currentTimeMinutes);
    const { activities: rescheduled, scheduled, postponed, unchanged, insights } = result;

    // PREVIEW MODE: Return proposed changes without modifying the database!
    if (preview === true) {
      return res.json({
        success: true,
        preview: true,
        activities: rescheduled,
        scheduled,
        postponed,
        unchanged,
        insights,
      });
    }

    // CONFIRMED REPLAN: Save new schedule to database
    // Handle target date choices for postponed activities (e.g. tomorrow, specific date, or tray)
    const postponementMap = new Map();
    if (Array.isArray(req.body.postponements)) {
      for (const p of req.body.postponements) {
        if (p.activityId) postponementMap.set(String(p.activityId), p);
      }
    }

    // 1. Update scheduled flexible tasks on current date
    for (const a of scheduled) {
      if (a._id) {
        const updates = {
          start: a.start,
          end: a.end,
          duration: a.duration,
          status: a.status || "upcoming",
        };
        if (useMemoryStore) {
          MemoryStore.updateActivity(a._id, updates);
        } else {
          await Activity.findOneAndUpdate({ _id: a._id, date }, { $set: updates });
        }
      }
    }

    // 2. Process postponed tasks: move to target chosen date or mark as skipped/tray
    const postponedSummary = [];
    for (const p of postponed) {
      const act = p.activity;
      if (act._id) {
        const userChoice = postponementMap.get(String(act._id));
        const targetDate = userChoice && userChoice.targetDate ? userChoice.targetDate : null;

        if (targetDate && targetDate !== date) {
          // Task is postponed to a different date!
          const updates = {
            date: targetDate,
            status: "upcoming",
            postponedReason: p.reason,
          };
          if (useMemoryStore) {
            MemoryStore.updateActivity(act._id, updates);
          } else {
            await Activity.findOneAndUpdate({ _id: act._id }, { $set: updates });
          }
          postponedSummary.push(`Moved "${act.title}" to ${targetDate}`);
        } else {
          // Task remains on current date in unscheduled / postponed state
          const updates = {
            status: "skipped",
            postponedReason: p.reason,
          };
          if (useMemoryStore) {
            MemoryStore.updateActivity(act._id, updates);
          } else {
            await Activity.findOneAndUpdate({ _id: act._id, date }, { $set: updates });
          }
          postponedSummary.push(`Postponed "${act.title}" to unscheduled tray`);
        }
      }
    }

    // Fetch updated activities for the current date
    let finalActivities;
    if (useMemoryStore) {
      finalActivities = MemoryStore.findActivities({ date, userId });
    } else {
      finalActivities = await Activity.find({
        date,
        $or: [{ userId }, { userId: "default-user" }, { userId: { $exists: false } }],
      })
        .sort({ start: 1 })
        .lean();
    }

    // Clean version identifier (e.g. v-1a8c9e)
    const versionId = `v-${Math.random().toString(16).substring(2, 8)}`;
    const versionSummary = `Adjusted for ${insights.energyLabel}: ${scheduled.length} scheduled, ${postponed.length} postponed`;

    // Save snapshot record to ReplanHistory
    let historyRecord;
    const historyData = {
      userId,
      date,
      energyAtReplan: typeof energy === "number" ? energy : energy === "LOW" ? 1 : energy === "HIGH" ? 5 : 3,
      energyLabel: insights.energyLabel,
      diagnosis: insights.diagnosis,
      adjustments: [...insights.adjustments, ...postponedSummary],
      totalWorkMinutes: insights.totalWorkMinutes,
      totalRestMinutes: insights.totalRestMinutes,
      skippedCount: postponed.length,
      versionId,
      versionSummary,
      commitHash: versionId, // backward compatibility
      commitMessage: versionSummary, // backward compatibility
      snapshotBefore,
      snapshotAfter: finalActivities,
    };

    if (useMemoryStore) {
      historyRecord = MemoryStore.createHistory(historyData);
    } else {
      historyRecord = await ReplanHistory.create(historyData);
    }

    res.json({
      success: true,
      preview: false,
      versionId,
      versionSummary,
      activities: finalActivities,
      scheduled,
      postponed,
      unchanged,
      insights,
      historyId: historyRecord._id,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Could not replan the schedule.",
      error: error.message,
    });
  }
});

// GET: Replan history (optionally filtered by date)
app.get("/api/replan/history", async (req, res) => {
  try {
    const query = {};
    if (req.query.date) query.date = req.query.date;
    if (req.query.userId) query.userId = req.query.userId;

    let records;
    if (useMemoryStore) {
      records = MemoryStore.findHistory(query);
    } else {
      records = await ReplanHistory.find(query).sort({ replanAt: -1 }).limit(30);
    }
    res.json({ success: true, count: records.length, records });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Could not fetch replan history.",
      error: error.message,
    });
  }
});

// GET: Single history record by ID
app.get("/api/replan/history/:id", async (req, res) => {
  try {
    let record;
    if (useMemoryStore) {
      record = memoryHistory.find((r) => String(r._id) === String(req.params.id));
    } else {
      record = await ReplanHistory.findById(req.params.id);
    }
    if (!record) return res.status(404).json({ success: false, message: "History record not found." });
    res.json({ success: true, record });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Could not fetch history record.",
      error: error.message,
    });
  }
});

// POST: Restore schedule to a previous saved version
app.post("/api/replan/checkout", async (req, res) => {
  try {
    const { historyId, date, userId = "default-user" } = req.body;
    if (!historyId) {
      return res.status(400).json({ success: false, message: "historyId is required." });
    }

    let record;
    if (useMemoryStore) {
      record = memoryHistory.find((r) => String(r._id) === String(historyId));
    } else {
      record = await ReplanHistory.findById(historyId);
    }

    if (!record) {
      return res.status(404).json({ success: false, message: "Snapshot version not found." });
    }

    const targetDate = date || record.date;
    const restoredActivities = (record.snapshotBefore || []).map((a) => {
      const copy = { ...a, date: targetDate, userId };
      delete copy._id;
      return copy;
    });

    if (useMemoryStore) {
      const remaining = memoryActivities.filter((a) => a.date !== targetDate);
      memoryActivities.length = 0;
      memoryActivities.push(...remaining);
      for (const a of restoredActivities) {
        MemoryStore.createActivity(a);
      }
    } else {
      await Activity.deleteMany({ date: targetDate });
      if (restoredActivities.length > 0) {
        await Activity.insertMany(restoredActivities);
      }
    }

    let currentSchedule;
    if (useMemoryStore) {
      currentSchedule = MemoryStore.findActivities({ date: targetDate, userId });
    } else {
      currentSchedule = await Activity.find({ date: targetDate }).sort({ start: 1 }).lean();
    }

    res.json({
      success: true,
      message: `Restored schedule version ${record.versionId || record.commitHash || record._id} successfully!`,
      activities: currentSchedule,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Could not restore schedule.",
      error: error.message,
    });
  }
});

// PATCH: Update an individual activity (status, completion logs, times)
app.patch("/api/activities/:id", async (req, res) => {
  try {
    const allowedFields = [
      "status",
      "energy",
      "expectedEnergy",
      "priority",
      "deadline",
      "actualDuration",
      "actualEnergy",
      "reflection",
      "title",
      "category",
      "start",
      "end",
      "duration",
      "type",
      "date",
      "userId",
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    let activity;
    if (useMemoryStore) {
      activity = MemoryStore.updateActivity(req.params.id, updates);
    } else {
      activity = await Activity.findByIdAndUpdate(req.params.id, updates, {
        new: true,
        runValidators: true,
      });
    }

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

// DELETE: Remove an activity
app.delete("/api/activities/:id", async (req, res) => {
  try {
    let deleted;
    if (useMemoryStore) {
      deleted = MemoryStore.deleteActivity(req.params.id);
    } else {
      deleted = await Activity.findByIdAndDelete(req.params.id);
    }

    if (!deleted) {
      return res.status(404).json({ success: false, message: "Activity not found." });
    }

    res.json({ success: true, message: "Activity removed successfully." });
  } catch (error) {
    res.status(500).json({ success: false, message: "Could not delete activity.", error: error.message });
  }
});

// POST: Reset demo activities for date
app.post("/api/activities/reset", async (req, res) => {
  try {
    const date = req.body.date || new Date().toLocaleDateString("en-CA");
    if (useMemoryStore) {
      const remaining = memoryActivities.filter((a) => a.date !== date);
      memoryActivities.length = 0;
      memoryActivities.push(...remaining);
    } else {
      await Activity.deleteMany({ date });
    }
    res.json({ success: true, message: "Schedule reset for demo." });
  } catch (error) {
    res.status(500).json({ success: false, message: "Reset failed.", error: error.message });
  }
});

// Start server with Atlas connection and automatic in-memory fallback
async function startServer() {
  try {
    // Attempt MongoDB connection with 3-second timeout
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 3000 });
    console.log("MongoDB connected successfully to Atlas!");
  } catch (error) {
    console.warn("⚠️ MongoDB Atlas connection unavailable (network/whitelist restriction).");
    console.warn("   Activating In-Memory fallback store so the demo works smoothly offline.");
    useMemoryStore = true;
  }

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

// Start server only when executed directly (not when required for tests)
if (require.main === module) {
  startServer();
}

module.exports = app;
