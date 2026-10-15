import { useState, useEffect } from "react";
import "./App.css";

function App() {
  function getToday() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function getDateWithOffset(baseDateStr, days) {
    if (!baseDateStr) return getToday();
    const parts = baseDateStr.split("-").map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function toMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== "string") return NaN;
    const [h, m] = timeStr.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return NaN;
    return h * 60 + m;
  }

  // ── Authentication State ──────────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem("guiltfree_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [authMode, setAuthMode] = useState("login"); // 'login' | 'register'
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // ── Calendar & Planner State ──────────────────────────────────────────────
  const [selectedDate, setSelectedDate] = useState(getToday());
  const [activities, setActivities] = useState([]);
  const [energy, setEnergy] = useState(3);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  // Active view: 'today' | 'history' | 'learning' | 'tray'
  const [activeView, setActiveView] = useState("today");

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    title: "",
    category: "Study",
    start: "15:30",
    end: "17:00",
    type: "flexible",
    expectedEnergy: "MEDIUM",
    priority: 3,
    deadline: "",
  });

  // Clock state
  const [currentClockTime, setCurrentClockTime] = useState(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  });

  // Replan state, comparison review, & postponement destination choices
  const [insights, setInsights] = useState(null);
  const [showInsights, setShowInsights] = useState(false);
  const [showInsightsChanges, setShowInsightsChanges] = useState(false);
  const [replanReview, setReplanReview] = useState(null);
  const [postponementTargets, setPostponementTargets] = useState({});
  const [replanLoading, setReplanLoading] = useState(false);

  // Version History state & restore
  const [historyRecords, setHistoryRecords] = useState([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Completion modal state
  const [completingActivity, setCompletingActivity] = useState(null);
  const [completionData, setCompletionData] = useState({
    actualDuration: 60,
    actualEnergy: "MEDIUM",
    reflection: "",
  });

  // Clock heartbeat
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentClockTime(
        `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
      );
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const initialActivities = [
    {
      title: "College: Data Structures & Algorithms",
      category: "Study",
      start: "09:00",
      end: "12:00",
      duration: "180 min",
      type: "fixed",
      status: "upcoming",
      expectedEnergy: "HIGH",
      priority: 5,
      date: getToday(),
    },
    {
      title: "Lunch & Rest Break",
      category: "Break",
      start: "12:00",
      end: "13:00",
      duration: "60 min",
      type: "fixed",
      status: "upcoming",
      expectedEnergy: "LOW",
      priority: 3,
      date: getToday(),
    },
    {
      title: "College: Database Systems Lab",
      category: "Study",
      start: "13:00",
      end: "15:30",
      duration: "150 min",
      type: "fixed",
      status: "upcoming",
      expectedEnergy: "MEDIUM",
      priority: 5,
      date: getToday(),
    },
    {
      title: "Self-Study & Problem Revision",
      category: "Study",
      start: "16:00",
      end: "17:30",
      duration: "90 min",
      type: "flexible",
      status: "upcoming",
      expectedEnergy: "HIGH",
      priority: 4,
      deadline: "20:00",
      date: getToday(),
    },
    {
      title: "Read Documentation & Notes",
      category: "Study",
      start: "17:30",
      end: "18:15",
      duration: "45 min",
      type: "flexible",
      status: "upcoming",
      expectedEnergy: "LOW",
      priority: 3,
      date: getToday(),
    },
    {
      title: "Web Project Coding",
      category: "Project",
      start: "18:30",
      end: "20:00",
      duration: "90 min",
      type: "flexible",
      status: "upcoming",
      expectedEnergy: "HIGH",
      priority: 4,
      deadline: "21:00",
      date: getToday(),
    },
  ];

  // ── Authentication Handlers ────────────────────────────────────────────────
  async function handleAuthSubmit(e) {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);

    const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
    try {
      const response = await fetch(`http://localhost:5000${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authForm),
      });

      let data;
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const text = await response.text();
        throw new Error(
          response.status === 404
            ? "Authentication endpoint not reachable. Please restart the backend server."
            : `Server response error: ${text.slice(0, 60)}`
        );
      }

      if (!response.ok) {
        throw new Error(data.message || "Authentication failed.");
      }

      localStorage.setItem("guiltfree_user", JSON.stringify(data.user));
      setCurrentUser(data.user);
      setNotice(`Welcome, ${data.user.name}!`);
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  }

  function handleDemoLogin() {
    setAuthLoading(true);
    setAuthError("");
    setTimeout(async () => {
      try {
        const response = await fetch("http://localhost:5000/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "student@college.edu",
            password: "password123",
          }),
        });

        let data = null;
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          data = await response.json();
        }

        if (response.ok && data && data.user) {
          localStorage.setItem("guiltfree_user", JSON.stringify(data.user));
          setCurrentUser(data.user);
          setNotice("Logged in as Demo Student.");
        } else {
          // Fallback demo user
          const demoUser = { id: "demo-user-1", name: "Alex Student", email: "student@college.edu" };
          localStorage.setItem("guiltfree_user", JSON.stringify(demoUser));
          setCurrentUser(demoUser);
          setNotice("Logged in as Demo Student.");
        }
      } catch {
        const demoUser = { id: "demo-user-1", name: "Alex Student", email: "student@college.edu" };
        localStorage.setItem("guiltfree_user", JSON.stringify(demoUser));
        setCurrentUser(demoUser);
        setNotice("Logged in as Demo Student.");
      } finally {
        setAuthLoading(false);
      }
    }, 150);
  }

  function handleLogout() {
    localStorage.removeItem("guiltfree_user");
    setCurrentUser(null);
    setActivities([]);
    setNotice("You have logged out.");
  }

  // ── Load Activities ────────────────────────────────────────────────────────
  async function loadActivities(targetDate = selectedDate) {
    if (!currentUser) return;
    setLoading(true);
    try {
      const userId = currentUser.id || "default-user";
      const response = await fetch(
        `http://localhost:5000/api/activities?date=${targetDate}&userId=${userId}`
      );
      if (!response.ok) {
        throw new Error("Could not connect to the activities API.");
      }

      const data = await response.json();
      let loadedActivities = data.activities || [];

      // Seed initial sample activities if empty for today
      if (loadedActivities.length === 0 && targetDate === getToday()) {
        const createdActivities = await Promise.all(
          initialActivities.map(async (activity) => {
            const createResponse = await fetch("http://localhost:5000/api/activities", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...activity, userId }),
            });
            if (!createResponse.ok) throw new Error("Could not save initial activities.");
            const result = await createResponse.json();
            return result.activity;
          })
        );
        loadedActivities = createdActivities;
      }

      setActivities(loadedActivities);
    } catch (error) {
      console.error("Loading activities failed:", error);
      setNotice("Could not connect to backend. Please ensure the server is running.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (currentUser) {
      loadActivities(selectedDate);
    }
  }, [selectedDate, currentUser]);

  function changeDate(daysOffset) {
    const nextDate = getDateWithOffset(selectedDate, daysOffset);
    setSelectedDate(nextDate);
  }

  const completedCount = activities.filter((a) => a.status === "done").length;
  const missedCount = activities.filter((a) => {
    if (a.status !== "upcoming" || a.type === "fixed") return false;
    const endMin = toMinutes(a.end);
    const nowMin = toMinutes(currentClockTime);
    return selectedDate === getToday() && !isNaN(endMin) && !isNaN(nowMin) && endMin <= nowMin;
  }).length;

  // Clock-aware status detector
  function getActivityStatus(activity) {
    if (activity.status === "done") return "done";
    if (activity.status === "partial") return "partial";
    if (activity.status === "skipped") return "skipped";

    if (selectedDate === getToday()) {
      const startMin = toMinutes(activity.start);
      const endMin = toMinutes(activity.end);
      const nowMin = toMinutes(currentClockTime);

      if (!isNaN(startMin) && !isNaN(endMin) && !isNaN(nowMin)) {
        if (startMin <= nowMin && endMin > nowMin) {
          return "in-progress";
        }
        if (endMin <= nowMin && activity.type === "flexible") {
          return "missed";
        }
      }
    }
    return "upcoming";
  }

  // Open completion modal
  function startCompletion(activity) {
    const durMatch = String(activity.duration || "").match(/\d+/);
    const plannedMin = durMatch ? parseInt(durMatch[0], 10) : 60;

    setCompletingActivity(activity);
    setCompletionData({
      actualDuration: plannedMin,
      actualEnergy: activity.expectedEnergy || (energy <= 2 ? "LOW" : energy >= 4 ? "HIGH" : "MEDIUM"),
      reflection: "",
    });
  }

  // Save activity completion log
  async function submitCompletion(e) {
    e.preventDefault();
    if (!completingActivity) return;

    try {
      const response = await fetch(
        `http://localhost:5000/api/activities/${completingActivity._id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "done",
            actualDuration: Number(completionData.actualDuration),
            actualEnergy: completionData.actualEnergy,
            reflection: completionData.reflection.trim(),
          }),
        }
      );

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Could not log completion.");
      }

      setActivities((current) =>
        current.map((act) => (act._id === completingActivity._id ? data.activity : act))
      );

      setCompletingActivity(null);
      setNotice("Completed! Actual duration, energy, and reflection saved.");
    } catch (error) {
      console.error("Completion logging failed:", error);
      setNotice("Could not save completion details. Please try again.");
    }
  }

  // Add new activity
  async function addActivity(event) {
    event.preventDefault();

    const startMinutes = toMinutes(formData.start);
    const endMinutes = toMinutes(formData.end);

    if (!formData.title.trim()) {
      setNotice("Please enter an activity title.");
      return;
    }

    if (endMinutes <= startMinutes) {
      setNotice("End time must be later than start time.");
      return;
    }

    const newActivity = {
      ...formData,
      title: formData.title.trim(),
      duration: `${endMinutes - startMinutes} min`,
      status: "upcoming",
      energy: energy,
      date: selectedDate,
      userId: currentUser?.id || "default-user",
    };

    try {
      const response = await fetch("http://localhost:5000/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newActivity),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Could not save activity.");
      }

      setActivities((current) =>
        [...current, data.activity].sort((a, b) =>
          (a.start || "").localeCompare(b.start || "")
        )
      );

      setFormData({
        title: "",
        category: "Study",
        start: "15:30",
        end: "17:00",
        type: "flexible",
        expectedEnergy: "MEDIUM",
        priority: 3,
        deadline: "",
      });

      setShowForm(false);
      setNotice(`Activity saved for ${selectedDate}.`);
    } catch (error) {
      console.error("Adding activity failed:", error);
      setNotice(error.message || "Could not save your activity.");
    }
  }

  // Delete an existing activity
  async function deleteActivity(id) {
    if (!window.confirm("Remove this activity from your schedule?")) {
      return;
    }
    try {
      const response = await fetch(`http://localhost:5000/api/activities/${id}`, {
        method: "DELETE",
      });

      let data = null;
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await response.json();
      }

      if (!response.ok) {
        throw new Error((data && data.message) || "Could not delete activity.");
      }

      setActivities((current) => current.filter((act) => act._id !== id));
      setNotice("Activity removed from schedule.");
    } catch (err) {
      console.error("Delete failed:", err);
      setNotice(err.message || "Failed to delete activity.");
    }
  }

  // Step 1: User-controlled replanning: preview mode + Comparison review
  async function triggerReplanPreview() {
    setReplanLoading(true);
    try {
      const now = new Date();
      const currentTimeMinutes =
        selectedDate === getToday() ? now.getHours() * 60 + now.getMinutes() : 480;

      const response = await fetch("http://localhost:5000/api/replan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: selectedDate,
          energy,
          currentTimeMinutes,
          preview: true,
          userId: currentUser?.id || "default-user",
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Could not generate replan preview.");

      // Initialize default target date for each postponed task to tomorrow
      const tomorrow = getDateWithOffset(selectedDate, 1);
      const initialTargets = {};
      for (const p of result.postponed) {
        if (p.activity && p.activity._id) {
          initialTargets[p.activity._id] = tomorrow;
        }
      }
      setPostponementTargets(initialTargets);
      setReplanReview(result);
      setNotice("");
    } catch (error) {
      console.error("Replanning preview failed:", error);
      setNotice(error.message || "Could not generate replan. Please check server.");
    } finally {
      setReplanLoading(false);
    }
  }

  // Step 2: Confirmation of revised schedule with chosen postponement dates
  async function confirmReplan() {
    try {
      const now = new Date();
      const currentTimeMinutes =
        selectedDate === getToday() ? now.getHours() * 60 + now.getMinutes() : 480;

      const postponements = Object.entries(postponementTargets).map(
        ([activityId, targetDate]) => ({
          activityId,
          targetDate: targetDate === "tray" ? null : targetDate,
          action: targetDate === "tray" ? "tray" : "postpone",
        })
      );

      const response = await fetch("http://localhost:5000/api/replan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: selectedDate,
          energy,
          currentTimeMinutes,
          preview: false,
          postponements,
          userId: currentUser?.id || "default-user",
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Could not confirm replan.");

      setActivities(result.activities.sort((a, b) => (a.start || "").localeCompare(b.start || "")));
      setInsights(result.insights);
      setShowInsights(true);
      setShowInsightsChanges(false);
      setReplanReview(null);
      setNotice("Revised schedule confirmed and saved successfully.");
    } catch (error) {
      console.error("Confirming replan failed:", error);
      setNotice(error.message || "Could not save replanned schedule.");
    }
  }

  // Restore schedule version
  async function rollbackToVersion(historyId, versionId) {
    if (!window.confirm(`Restore schedule to saved version [${versionId}]?`)) {
      return;
    }

    try {
      const response = await fetch("http://localhost:5000/api/replan/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          historyId,
          date: selectedDate,
          userId: currentUser?.id || "default-user",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Restore failed.");

      setActivities(data.activities);
      setNotice(`Schedule restored to version [${versionId}] successfully.`);
      setSelectedSnapshot(null);
    } catch (error) {
      console.error("Restore failed:", error);
      setNotice(error.message || "Could not restore snapshot version.");
    }
  }

  // Fetch replan version history
  async function fetchHistory() {
    setHistoryLoading(true);
    try {
      const userId = currentUser?.id || "default-user";
      const response = await fetch(
        `http://localhost:5000/api/replan/history?date=${selectedDate}&userId=${userId}`
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not load history.");
      if (data.success) setHistoryRecords(data.records);
    } catch (error) {
      console.error("Could not load history:", error);
    } finally {
      setHistoryLoading(false);
    }
  }

  // Reset demo schedule
  async function resetDemo() {
    if (!window.confirm("Reset your schedule to the clean demo day?")) return;
    try {
      const userId = currentUser?.id || "default-user";
      await fetch("http://localhost:5000/api/activities/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: selectedDate }),
      });

      const created = await Promise.all(
        initialActivities.map(async (act) => {
          const res = await fetch("http://localhost:5000/api/activities", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...act, date: selectedDate, userId }),
          });
          const d = await res.json();
          return d.activity;
        })
      );

      setActivities(created);
      setNotice(`Demo schedule for ${selectedDate} has been reset.`);
    } catch (error) {
      console.error("Reset failed:", error);
      setNotice("Reset failed. Please verify backend connection.");
    }
  }

  // ── Learning Metrics ────────────────────────────────────────────────────────
  const completedActivities = activities.filter((a) => a.status === "done" && a.actualDuration != null);
  const totalPlannedMinutes = completedActivities.reduce((sum, a) => {
    const durMatch = String(a.duration || "").match(/\d+/);
    return sum + (durMatch ? parseInt(durMatch[0], 10) : 0);
  }, 0);

  const totalActualMinutes = completedActivities.reduce(
    (sum, a) => sum + (Number(a.actualDuration) || 0),
    0
  );
  const timeDifference = totalActualMinutes - totalPlannedMinutes;

  const postponedActivities = activities.filter((a) => a.status === "skipped");
  const overdueTasksCount = activities.filter((a) => {
    const durMatch = String(a.duration || "").match(/\d+/);
    const planned = durMatch ? parseInt(durMatch[0], 10) : 0;
    return a.status === "done" && a.actualDuration > planned;
  }).length;

  // ── Render Authentication Screen if not logged in ───────────────────────────
  if (!currentUser) {
    return (
      <div className="auth-wrapper">
        <div className="auth-card">
          <div className="auth-brand">
            <div className="brand-icon">g.</div>
            <div>
              <h2 style={{ margin: 0, fontSize: "20px" }}>GuiltFreeCal</h2>
              <p style={{ margin: 0, fontSize: "11px", color: "#8a9b8e" }}>
                energy-aware daily scheduling
              </p>
            </div>
          </div>

          <h2>Plan with real life in mind.</h2>
          <p className="auth-desc">
            Organize your day based on available time and current energy. Sign in to your workspace.
          </p>

          <div className="auth-tabs">
            <button
              type="button"
              className={`auth-tab-btn ${authMode === "login" ? "active" : ""}`}
              onClick={() => {
                setAuthMode("login");
                setAuthError("");
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`auth-tab-btn ${authMode === "register" ? "active" : ""}`}
              onClick={() => {
                setAuthMode("register");
                setAuthError("");
              }}
            >
              Create Account
            </button>
          </div>

          {authError && (
            <div className="notice" style={{ marginBottom: "16px", color: "#b54747" }}>
              <span>⚠</span> {authError}
            </div>
          )}

          <form className="auth-form" onSubmit={handleAuthSubmit}>
            {authMode === "register" && (
              <label>
                Full Name
                <input
                  type="text"
                  placeholder="e.g. Alex Student"
                  value={authForm.name}
                  onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })}
                  required
                />
              </label>
            )}

            <label>
              College / Student Email
              <input
                type="email"
                placeholder="e.g. student@college.edu"
                value={authForm.email}
                onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
                required
              />
            </label>

            <label>
              Password
              <input
                type="password"
                placeholder="Enter password"
                value={authForm.password}
                onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
                required
              />
            </label>

            <button type="submit" className="auth-submit-btn" disabled={authLoading}>
              {authLoading
                ? "Processing..."
                : authMode === "login"
                ? "Sign In to Workspace"
                : "Create Account"}
            </button>
          </form>

          <div className="demo-login-box">
            <span>Presenting or testing?</span>
            <button
              type="button"
              className="demo-login-btn"
              onClick={handleDemoLogin}
              disabled={authLoading}
            >
              ⚡ 1-Click Demo Student Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render Main Application ────────────────────────────────────────────────
  return (
    <div className="app-shell">
      {/* ── Sidebar Navigation ── */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">g.</div>
          <div>
            <h2>guilt-free</h2>
            <p>your space to reset</p>
          </div>
        </div>

        <div className="nav-label">WORKSPACE</div>

        <button
          className={`nav-item ${activeView === "today" ? "active" : ""}`}
          onClick={() => setActiveView("today")}
        >
          <span>▦</span> Daily schedule
        </button>

        <button
          className={`nav-item ${activeView === "history" ? "active" : ""}`}
          onClick={() => {
            setActiveView("history");
            fetchHistory();
          }}
        >
          <span>▤</span> Saved history
        </button>

        <button
          className={`nav-item ${activeView === "learning" ? "active" : ""}`}
          onClick={() => setActiveView("learning")}
        >
          <span>☼</span> Expected vs Actual
        </button>

        <button
          className={`nav-item ${activeView === "tray" ? "active" : ""}`}
          onClick={() => setActiveView("tray")}
        >
          <span>↗</span> Unfinished tray {postponedActivities.length > 0 && `(${postponedActivities.length})`}
        </button>

        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="note-icon">✳</span>
            <h3>Simple & adaptive</h3>
            <p>
              Free time is protected from fixed commitments. When plans change, you can easily review proposals and choose where to postpone tasks.
            </p>
          </div>
          <p className="sidebar-footer">MADE FOR REAL LIFE ♡</p>
        </div>
      </aside>

      {/* ── Main Content Area ── */}
      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span>{" "}
            <strong>
              {activeView === "today"
                ? "Schedule"
                : activeView === "history"
                ? "Schedule History"
                : activeView === "learning"
                ? "Learning & Patterns"
                : "Unfinished Tray"}
            </strong>
          </div>

          {/* Date Navigator Bar */}
          <div className="date-navigator">
            <button onClick={() => changeDate(-1)} title="Previous Day">
              ◀ Prev
            </button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
            <button onClick={() => changeDate(1)} title="Next Day">
              Next ▶
            </button>
            {selectedDate !== getToday() && (
              <button
                onClick={() => setSelectedDate(getToday())}
                style={{ color: "#2563eb", fontWeight: "700" }}
              >
                Today
              </button>
            )}
          </div>

          {/* User profile & logout */}
          <div className="profile">
            <div className="profile-avatar">
              {(currentUser.name || "U")[0].toUpperCase()}
            </div>
            <span>{currentUser.name}</span>
            <button className="logout-btn" onClick={handleLogout} title="Log out">
              Log out
            </button>
          </div>
        </header>

        {/* ── Welcome & Top Cards ── */}
        <section className="welcome-section">
          <div>
            <p className="eyebrow">
              <span className="live-dot" /> ENERGY-AWARE SCHEDULING
            </p>
            <h1>Make room for today.</h1>
            <p className="welcome-description">
              Viewing plan for <strong>{selectedDate}</strong> {selectedDate === getToday() ? "(Today)" : ""}.
            </p>
          </div>

          <div className="date-card">
            <span>LOCAL CLOCK</span>
            <strong>{currentClockTime}</strong>
            <span className="date-caption">
              {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-IN", {
                weekday: "short",
                day: "2-digit",
                month: "short",
              })}
            </span>
          </div>
        </section>

        {/* ── Top Summary Cards ── */}
        <section className="summary-grid">
          {/* Progress Card */}
          <div className="summary-card progress-card">
            <div className="summary-top">
              <span>Day&apos;s progress</span>
              <span className="summary-icon">↗</span>
            </div>
            <div className="summary-number">
              {completedCount}
              <span> / {activities.length}</span>
            </div>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width: `${activities.length ? (completedCount / activities.length) * 100 : 0}%`,
                }}
              />
            </div>
            <p>
              {missedCount > 0 ? (
                <span style={{ color: "#b07004" }}>
                  {missedCount} past task{missedCount > 1 ? "s" : ""} ready to replan
                </span>
              ) : (
                "Every bit of progress counts."
              )}
            </p>
          </div>

          {/* Current User Energy Card */}
          <div className="summary-card energy-card">
            <div className="summary-top">
              <span>Your current energy</span>
              <span className="summary-icon">☼</span>
            </div>
            <div className="energy-options">
              {[1, 2, 3, 4, 5].map((level) => (
                <button
                  key={level}
                  className={`energy-button ${energy === level ? "selected" : ""}`}
                  onClick={() => setEnergy(level)}
                  aria-label={`Energy level ${level}`}
                >
                  {["☁", "◔", "◑", "◕", "☀"][level - 1]}
                </button>
              ))}
            </div>
            <p>
              {[
                "Running on empty (LOW)",
                "Taking it slow (LOW)",
                "Finding my pace (MEDIUM)",
                "Feeling good (HIGH)",
                "Full of energy (HIGH)",
              ][energy - 1]}
            </p>
          </div>

          {/* Intention Card */}
          <div className="summary-card intention-card">
            <div className="summary-top">
              <span>Today&apos;s intention</span>
              <span className="summary-icon">♡</span>
            </div>
            <h3>Progress over perfection.</h3>
            <p>Your calendar bends with you, not against you.</p>
          </div>
        </section>

        {/* Notice Banner */}
        {notice && (
          <div className="notice" role="status">
            <span>✳</span>
            {notice}
            <button onClick={() => setNotice("")} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}

        {/* ── VIEW 1: SCHEDULE VIEW ── */}
        {activeView === "today" && (
          <section className="schedule-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">YOUR PERSONAL TIMELINE</p>
                <h2>
                  Timeline for {selectedDate} <span>✳</span>
                </h2>
                <p className="section-subtitle">
                  Fixed commitments are protected. Flexible tasks adapt to your energy.
                </p>
              </div>

              <div className="heading-actions">
                <button
                  className="add-activity-button"
                  onClick={() => setShowForm(!showForm)}
                >
                  {showForm ? "Close Form" : "+ Add Activity"}
                </button>
                <button className="reset-button" onClick={resetDemo}>
                  ↻ Reset demo
                </button>
              </div>
            </div>

            {/* Clock-Aware Banner */}
            {selectedDate === getToday() && (
              <div className="clock-indicator">
                <span className="clock-dot" />
                <span>
                  System clock: <strong>{currentClockTime}</strong> · Clock-aware scheduling active
                </span>
              </div>
            )}

            {/* Add Activity Form */}
            {showForm && (
              <form className="activity-form" onSubmit={addActivity}>
                <h3>Plan an activity for {selectedDate} ✳</h3>

                <label>
                  Activity name
                  <input
                    type="text"
                    placeholder="e.g. Operating Systems Lab or Personal Study"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    required
                  />
                </label>

                <div className="form-row">
                  <label>
                    Category
                    <select
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    >
                      <option value="Study">Study</option>
                      <option value="Break">Break</option>
                      <option value="Project">Project</option>
                      <option value="Personal">Personal</option>
                    </select>
                  </label>

                  <label>
                    Activity type
                    <select
                      value={formData.type}
                      onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    >
                      <option value="flexible">Flexible (Can be replanned)</option>
                      <option value="fixed">Fixed commitment (Class / Unavailable)</option>
                    </select>
                  </label>
                </div>

                <div className="form-row">
                  <label>
                    Start time
                    <input
                      type="time"
                      value={formData.start}
                      onChange={(e) => setFormData({ ...formData, start: e.target.value })}
                      required
                    />
                  </label>

                  <label>
                    End time
                    <input
                      type="time"
                      value={formData.end}
                      onChange={(e) => setFormData({ ...formData, end: e.target.value })}
                      required
                    />
                  </label>
                </div>

                {formData.type === "flexible" && (
                  <div className="form-row">
                    <label>
                      Expected energy requirement
                      <select
                        value={formData.expectedEnergy}
                        onChange={(e) =>
                          setFormData({ ...formData, expectedEnergy: e.target.value })
                        }
                      >
                        <option value="LOW">LOW — Light / Gentle task</option>
                        <option value="MEDIUM">MEDIUM — Moderate focus</option>
                        <option value="HIGH">HIGH — Demanding / Deep focus</option>
                      </select>
                    </label>

                    <label>
                      Priority (1–5)
                      <select
                        value={formData.priority}
                        onChange={(e) =>
                          setFormData({ ...formData, priority: Number(e.target.value) })
                        }
                      >
                        <option value={1}>1 — Lowest</option>
                        <option value={2}>2 — Low</option>
                        <option value={3}>3 — Normal</option>
                        <option value={4}>4 — High</option>
                        <option value={5}>5 — Critical / Must do</option>
                      </select>
                    </label>
                  </div>
                )}

                {formData.type === "flexible" && (
                  <label>
                    Optional deadline (HH:MM)
                    <input
                      type="time"
                      value={formData.deadline}
                      onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
                    />
                  </label>
                )}

                <div className="form-actions">
                  <button type="submit" className="add-activity-button">
                    Save to schedule
                  </button>
                  <button
                    type="button"
                    className="reset-button"
                    onClick={() => setShowForm(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {loading && <p>Loading schedule for {selectedDate}...</p>}

            {/* Empty state */}
            {!loading && activities.length === 0 && (
              <div className="review-item" style={{ padding: "24px", textAlign: "center" }}>
                <p style={{ margin: 0, color: "#697e70" }}>
                  No activities planned yet for {selectedDate}.
                </p>
                <button
                  className="add-activity-button"
                  style={{ marginTop: "12px" }}
                  onClick={() => setShowForm(true)}
                >
                  + Plan activities for this day
                </button>
              </div>
            )}

            {/* Schedule List */}
            <div className="schedule-list">
              {activities.map((activity, index) => {
                const clockStatus = getActivityStatus(activity);
                const isDone = activity.status === "done";
                const isSkipped = activity.status === "skipped";

                return (
                  <article
                    className={`activity-card ${
                      isDone ? "activity-done" : isSkipped ? "activity-skipped" : ""
                    }`}
                    key={activity._id || index}
                  >
                    <div className="time-column">
                      <strong>{activity.start}</strong>
                      <span>{activity.end}</span>
                      {index !== activities.length - 1 && (
                        <div className="timeline-line" />
                      )}
                    </div>

                    <div className={`activity-indicator ${activity.category.toLowerCase()}`}>
                      {activity.category === "Study"
                        ? "✎"
                        : activity.category === "Break"
                        ? "☕"
                        : activity.category === "Project"
                        ? "⌘"
                        : "♡"}
                    </div>

                    <div className="activity-details">
                      <div className="activity-tags">
                        <span className={`category-tag ${activity.category.toLowerCase()}`}>
                          {activity.category}
                        </span>

                        <span className="duration-tag">{activity.duration}</span>

                        {activity.type === "fixed" ? (
                          <span className="fixed-tag">Fixed Commitment</span>
                        ) : (
                          <>
                            <span
                              className={`energy-tag ${(
                                activity.expectedEnergy || "medium"
                              ).toLowerCase()}`}
                            >
                              ⚡ {activity.expectedEnergy || "MEDIUM"}
                            </span>

                            <span className="priority-tag">
                              P{activity.priority || 3}
                            </span>

                            {activity.deadline && (
                              <span className="deadline-tag">
                                🎯 Due {activity.deadline}
                              </span>
                            )}
                          </>
                        )}
                      </div>

                      <h3>{activity.title}</h3>
                      <p>
                        {activity.type === "fixed"
                          ? "Protected commitment — never moved by planner."
                          : "Flexible — adapts to your remaining time and energy."}
                      </p>

                      {/* Display logged completion details if available */}
                      {isDone && (
                        <div className="completion-summary-badge">
                          ✓ Logged: {activity.actualDuration || activity.duration} min · Felt{" "}
                          <strong>{activity.actualEnergy || "MEDIUM"}</strong> energy
                          {activity.reflection && (
                            <div className="reflection-quote">
                              &ldquo;{activity.reflection}&rdquo;
                            </div>
                          )}
                        </div>
                      )}

                      {isSkipped && activity.postponedReason && (
                        <div className="review-item-reason">
                          ℹ {activity.postponedReason}
                        </div>
                      )}
                    </div>

                    <div className="activity-actions">
                      {clockStatus === "done" ? (
                        <span className="status-label done-label">✓ Done</span>
                      ) : clockStatus === "partial" ? (
                        <span className="status-label partial-label">◐ Partial</span>
                      ) : clockStatus === "skipped" ? (
                        <span className="status-label skipped-label">↗ Postponed</span>
                      ) : clockStatus === "in-progress" ? (
                        <span className="status-label in-progress-label">● In Progress</span>
                      ) : clockStatus === "missed" ? (
                        <span className="status-label missed-label">⚠ Missed</span>
                      ) : (
                        <span className="status-label upcoming-label">Upcoming</span>
                      )}

                      {/* Action buttons */}
                      <div className="action-buttons">
                        {!isDone && (
                          <button
                            className="log-button done-button"
                            onClick={() => startCompletion(activity)}
                          >
                            ✓ Done
                          </button>
                        )}
                        <button
                          className="log-button delete-button"
                          onClick={() => deleteActivity(activity._id)}
                          title="Remove activity"
                        >
                          ✕ Delete
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Replan Card */}
            <section className="replan-card">
              <div className="replan-symbol">✳</div>
              <div className="replan-copy">
                <h3>Need to adjust your day?</h3>
                <p>
                  Reorganize the remaining time according to energy. You can review all proposed changes, see what moved, and choose which day to postpone tasks to before confirming.
                </p>
              </div>
              <button
                className="replan-button"
                onClick={triggerReplanPreview}
                disabled={replanLoading}
              >
                {replanLoading ? "Analyzing..." : "Replan schedule →"}
              </button>
            </section>

            {/* Insights panel from last confirmed replan */}
            {showInsights && insights && (
              <div className="insights-panel">
                <div className="insights-header">
                  <span className="energy-label-pill">{insights.energyLabel}</span>
                  <button
                    className="hide-insights-link"
                    onClick={() => setShowInsights(false)}
                  >
                    Hide insights
                  </button>
                </div>
                <p className="insights-diagnosis">{insights.diagnosis}</p>
                <button
                  className="insights-toggle"
                  onClick={() => setShowInsightsChanges((prev) => !prev)}
                >
                  {showInsightsChanges ? "▾" : "▸"} What changed (
                  {insights.adjustments.length})
                </button>
                {showInsightsChanges && (
                  <ul className="insights-adjustments">
                    {insights.adjustments.map((adj, i) => (
                      <li key={i}>{adj}</li>
                    ))}
                  </ul>
                )}
                <div className="insights-stats">
                  <span>{insights.totalWorkMinutes} min work</span>
                  <span className="insights-dot">·</span>
                  <span>{insights.totalRestMinutes} min rest</span>
                  <span className="insights-dot">·</span>
                  <span>{insights.postponedCount || 0} postponed</span>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── VIEW 2: EXPECTED VS ACTUAL LEARNING (Section 8) ── */}
        {activeView === "learning" && (
          <section className="learning-section">
            <div className="learning-header">
              <h2>Expected vs. Actual Insights ☼</h2>
              <p>
                Understand your personal planning patterns through transparent statistics. No black-box AI — just honest data to help you pace yourself.
              </p>
            </div>

            <div className="learning-grid">
              <div className="learning-card">
                <div className="metric-label">Completed Duration</div>
                <div className="metric-value">{totalActualMinutes} min</div>
                <div className="metric-detail">
                  Planned was {totalPlannedMinutes} min (
                  {timeDifference >= 0 ? `+${timeDifference} min overrun` : `${timeDifference} min under`}
                  )
                </div>
              </div>

              <div className="learning-card">
                <div className="metric-label">Estimation Accuracy</div>
                <div className="metric-value">
                  {totalPlannedMinutes > 0
                    ? `${Math.round((totalPlannedMinutes / (totalActualMinutes || 1)) * 100)}%`
                    : "N/A"}
                </div>
                <div className="metric-detail">
                  {overdueTasksCount} task{overdueTasksCount !== 1 ? "s" : ""} took longer than estimated
                </div>
              </div>

              <div className="learning-card">
                <div className="metric-label">Completed vs Postponed</div>
                <div className="metric-value">
                  {completedCount} / {postponedActivities.length}
                </div>
                <div className="metric-detail">
                  {completedCount} finished, {postponedActivities.length} postponed to protect your energy
                </div>
              </div>
            </div>

            <div className="learning-tip-box">
              <span className="tip-icon">✳</span>
              <div>
                <h4>Gentle planning guideline</h4>
                <p>
                  If complex study tasks consistently run 15–20 minutes over, consider scheduling a 15-minute buffer afterwards. Remember: adapting your plan is a healthy skill, not a failure.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* ── VIEW 3: SAVED REPLAN HISTORY & SNAPSHOTS ── */}
        {activeView === "history" && (
          <section className="learning-section">
            <div className="learning-header">
              <h2>Saved Schedule Versions & History ▤</h2>
              <p>
                Every replan creates a saved snapshot of your day. You can review what changed or restore a previous version.
              </p>
            </div>

            {selectedSnapshot ? (
              <div className="snapshot-view">
                <button
                  className="reset-button"
                  style={{ marginBottom: "16px" }}
                  onClick={() => setSelectedSnapshot(null)}
                >
                  ← Back to history list
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                  <span className="version-badge">
                    {selectedSnapshot.versionId || selectedSnapshot.commitHash || "Version"}
                  </span>
                  <h3 style={{ margin: 0 }}>Snapshot for {selectedSnapshot.date}</h3>
                </div>

                <div className="diff-box">
                  <div className="diff-header">
                    <span>Before adjustment ({selectedSnapshot.snapshotBefore?.length || 0} items)</span>
                    <span>After adjustment ({selectedSnapshot.snapshotAfter?.length || 0} items)</span>
                  </div>
                  <div className="snapshot-columns" style={{ padding: "14px" }}>
                    <div>
                      <h4 className="snapshot-label">Original Schedule</h4>
                      {(selectedSnapshot.snapshotBefore || []).map((a, i) => (
                        <div key={i} className="snapshot-activity">
                          <span className="snapshot-time">{a.start}</span>
                          <span className="snapshot-title">{a.title}</span>
                          <span className="snapshot-dur">{a.duration}</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <h4 className="snapshot-label">Revised Schedule</h4>
                      {(selectedSnapshot.snapshotAfter || []).map((a, i) => (
                        <div key={i} className="snapshot-activity">
                          <span className="snapshot-time">{a.start}</span>
                          <span className="snapshot-title">{a.title}</span>
                          <span className="snapshot-dur">{a.duration}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <button
                  className="restore-btn"
                  onClick={() =>
                    rollbackToVersion(
                      selectedSnapshot._id,
                      selectedSnapshot.versionId || selectedSnapshot.commitHash || "Version"
                    )
                  }
                >
                  ↺ Restore this schedule version
                </button>
              </div>
            ) : (
              <div className="timeline-tree">
                {historyLoading && <p>Loading history...</p>}
                {!historyLoading && historyRecords.length === 0 && (
                  <p>No replan history recorded for {selectedDate} yet. Trigger a replan to save your first snapshot.</p>
                )}
                {historyRecords.map((record) => (
                  <div key={record._id} className="timeline-node">
                    <div className="timeline-top">
                      <span className="version-badge">
                        {record.versionId || record.commitHash || "Saved"}
                      </span>
                      <span className="timeline-msg">
                        {record.versionSummary || record.commitMessage || record.diagnosis}
                      </span>
                    </div>
                    <div className="timeline-meta">
                      Saved at{" "}
                      {new Date(record.replanAt).toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · Mode: <strong>{record.energyLabel}</strong>
                    </div>

                    {record.adjustments && record.adjustments.length > 0 && (
                      <ul style={{ margin: "6px 0 12px", paddingLeft: "18px", fontSize: "11px", color: "#4c6655" }}>
                        {record.adjustments.slice(0, 3).map((adj, i) => (
                          <li key={i}>{adj}</li>
                        ))}
                      </ul>
                    )}

                    <div style={{ display: "flex", gap: "10px" }}>
                      <button className="reset-button" onClick={() => setSelectedSnapshot(record)}>
                        View Comparison →
                      </button>
                      <button
                        className="restore-btn"
                        onClick={() =>
                          rollbackToVersion(
                            record._id,
                            record.versionId || record.commitHash || "Version"
                          )
                        }
                      >
                        ↺ Restore Version
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── VIEW 4: UNFINISHED TRAY ── */}
        {activeView === "tray" && (
          <section className="learning-section">
            <div className="learning-header">
              <h2>Unfinished & Postponed Tray ↗</h2>
              <p>
                Activities that didn&apos;t fit or were postponed to protect your energy. Nothing is deleted.
              </p>
            </div>

            {postponedActivities.length === 0 ? (
              <p>Your tray is currently empty. You&apos;re all caught up!</p>
            ) : (
              <div>
                {postponedActivities.map((act) => (
                  <div key={act._id} className="review-item postponed">
                    <div className="review-item-header">
                      <span className="review-item-title">{act.title}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span className="duration-tag">{act.duration}</span>
                        <button
                          className="log-button delete-button"
                          onClick={() => deleteActivity(act._id)}
                          title="Remove activity"
                          style={{ padding: "4px 8px", fontSize: "10px" }}
                        >
                          ✕ Delete
                        </button>
                      </div>
                    </div>
                    <div className="review-item-reason">
                      {act.postponedReason || "Postponed to balance remaining time and energy."}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── MODAL 1: PROPOSED REPLAN REVIEW & COMPARISON ── */}
        {replanReview && (
          <div className="modal-overlay">
            <div className="modal-dialog">
              <div className="modal-header">
                <div>
                  <h3 style={{ margin: 0 }}>Review Proposed Schedule</h3>
                  <span style={{ fontSize: "11px", color: "#6a8272" }}>
                    Target date: <strong>{selectedDate}</strong> · Mode: <strong>{replanReview.insights.energyLabel}</strong>
                  </span>
                </div>
                <button className="modal-close" onClick={() => setReplanReview(null)}>
                  ×
                </button>
              </div>

              <div className="modal-body">
                <p style={{ marginTop: 0 }}>
                  Here is the proposed schedule based on your current <strong>{replanReview.insights.energyLabel}</strong> and remaining free time. Please review what moved and choose where to postpone tasks.
                </p>

                {/* Comparison Diff Box */}
                <div className="diff-box">
                  <div className="diff-header">
                    <span>Proposed Schedule Changes</span>
                    <span>
                      {replanReview.scheduled.length} scheduled, {replanReview.postponed.length} postponed
                    </span>
                  </div>

                  {/* Rescheduled Tasks */}
                  {replanReview.scheduled.map((task) => (
                    <div key={task._id} className="diff-item">
                      <span className="diff-del">
                        Original: {task.title} ({task.duration})
                      </span>
                      <span className="diff-add">
                        Proposed: {task.title} at {task.start} – {task.end} (⚡ {task.expectedEnergy || "MEDIUM"} energy requirement)
                      </span>
                    </div>
                  ))}

                  {/* Postponed Tasks with Target Date Selector */}
                  {replanReview.postponed.map((item, idx) => {
                    const tomorrow = getDateWithOffset(selectedDate, 1);
                    const dayAfter = getDateWithOffset(selectedDate, 2);
                    const currentTarget = postponementTargets[item.activity._id] || tomorrow;

                    return (
                      <div key={idx} className="diff-item">
                        <span className="diff-del">
                          Postponing: {item.activity.title} ({item.activity.duration})
                        </span>
                        <div className="diff-postpone">
                          <div>
                            <strong>Why postponed:</strong> {item.reason}
                          </div>
                          <div
                            style={{
                              marginTop: "8px",
                              display: "flex",
                              alignItems: "center",
                              flexWrap: "wrap",
                              gap: "6px",
                            }}
                          >
                            <span>Move task to:</span>
                            <select
                              className="target-date-select"
                              value={currentTarget}
                              onChange={(e) =>
                                setPostponementTargets({
                                  ...postponementTargets,
                                  [item.activity._id]: e.target.value,
                                })
                              }
                            >
                              <option value={tomorrow}>Tomorrow ({tomorrow})</option>
                              <option value={dayAfter}>Day after tomorrow ({dayAfter})</option>
                              <option value={getDateWithOffset(selectedDate, 3)}>
                                In 3 days ({getDateWithOffset(selectedDate, 3)})
                              </option>
                              <option value="tray">Unscheduled Tray (Save for later)</option>
                            </select>

                            {currentTarget !== "tray" && (
                              <input
                                type="date"
                                className="target-date-select"
                                value={currentTarget}
                                min={getDateWithOffset(selectedDate, 1)}
                                onChange={(e) =>
                                  setPostponementTargets({
                                    ...postponementTargets,
                                    [item.activity._id]: e.target.value,
                                  })
                                }
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Unchanged / Frozen tasks */}
                {replanReview.unchanged.length > 0 && (
                  <div style={{ fontSize: "11px", color: "#667f6f", marginTop: "8px" }}>
                    <strong>Kept in place ({replanReview.unchanged.length}):</strong>{" "}
                    {replanReview.unchanged.map((u) => u.title).join(", ")}
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button className="cancel-modal-btn" onClick={() => setReplanReview(null)}>
                  Cancel (Keep Current)
                </button>
                <button className="confirm-replan-btn" onClick={confirmReplan}>
                  Confirm & Apply Schedule
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── MODAL 2: ACTIVITY COMPLETION & ENERGY LOGGING (Section 5) ── */}
        {completingActivity && (
          <div className="modal-overlay">
            <div className="modal-dialog">
              <div className="modal-header">
                <h3>Log Activity Completion ✳</h3>
                <button className="modal-close" onClick={() => setCompletingActivity(null)}>
                  ×
                </button>
              </div>

              <form onSubmit={submitCompletion}>
                <div className="modal-body">
                  <div style={{ marginBottom: "16px" }}>
                    <h4 style={{ margin: "0 0 4px", fontSize: "15px", color: "#284436" }}>
                      {completingActivity.title}
                    </h4>
                    <span style={{ fontSize: "12px", color: "#74887b" }}>
                      Planned duration: <strong>{completingActivity.duration}</strong> · Expected energy:{" "}
                      <strong>{completingActivity.expectedEnergy || "MEDIUM"}</strong>
                    </span>
                  </div>

                  <div className="completion-form">
                    <label>
                      Actual duration spent (minutes)
                      <input
                        type="number"
                        min="1"
                        max="600"
                        value={completionData.actualDuration}
                        onChange={(e) =>
                          setCompletionData({
                            ...completionData,
                            actualDuration: e.target.value,
                          })
                        }
                        required
                      />
                    </label>

                    <div>
                      <span style={{ fontSize: "11px", fontWeight: "600", color: "#5a7060" }}>
                        How much energy did it actually take?
                      </span>
                      <div className="energy-selector" style={{ marginTop: "6px" }}>
                        {["LOW", "MEDIUM", "HIGH"].map((lvl) => (
                          <button
                            type="button"
                            key={lvl}
                            className={`energy-choice-btn ${
                              completionData.actualEnergy === lvl ? "selected" : ""
                            }`}
                            onClick={() =>
                              setCompletionData({ ...completionData, actualEnergy: lvl })
                            }
                          >
                            ⚡ {lvl}
                          </button>
                        ))}
                      </div>
                    </div>

                    <label>
                      Short reflection (optional)
                      <textarea
                        rows="3"
                        placeholder="e.g. Felt energized once I got started, or needed more time than expected."
                        value={completionData.reflection}
                        onChange={(e) =>
                          setCompletionData({
                            ...completionData,
                            reflection: e.target.value,
                          })
                        }
                        style={{
                          border: "1px solid #dde6da",
                          borderRadius: "8px",
                          padding: "9px 11px",
                          font: "inherit",
                          fontSize: "12px",
                          background: "#f9fbf7",
                          color: "#344a3b",
                          resize: "vertical",
                        }}
                      />
                    </label>
                  </div>
                </div>

                <div className="modal-footer">
                  <button
                    type="button"
                    className="cancel-modal-btn"
                    onClick={() => setCompletingActivity(null)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="confirm-replan-btn">
                    Save Completion Log
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <footer className="page-footer">
          <span>Made for imperfect days ♡</span>
          <span>YOU ARE ALLOWED TO ADAPT.</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
