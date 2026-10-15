import { useState, useEffect } from "react";
import "./App.css";

function App() {
  const [activities, setActivities] = useState([]);
  const [energy, setEnergy] = useState(3);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  
  const [showForm, setShowForm] = useState(false);
  const [insights, setInsights] = useState(null);
  const [showInsights, setShowInsights] = useState(false);
  const [showInsightsChanges, setShowInsightsChanges] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyRecords, setHistoryRecords] = useState([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [formData, setFormData] = useState({
  title: "",
  category: "Study",
  start: "15:00",
  end: "16:00",
  type: "flexible",
});

  function getToday() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  const initialActivities = [
    {
      title: "Morning study session",
      category: "Study",
      start: "09:00",
      end: "10:30",
      duration: "90 min",
      type: "flexible",
      status: "upcoming",
      energy: 3,
      date: getToday(),
    },
    {
      title: "Breakfast & reset",
      category: "Break",
      start: "10:30",
      end: "11:00",
      duration: "30 min",
      type: "fixed",
      status: "upcoming",
      energy: 3,
      date: getToday(),
    },
    {
      title: "Web Technology project",
      category: "Project",
      start: "11:00",
      end: "12:30",
      duration: "90 min",
      type: "flexible",
      status: "upcoming",
      energy: 3,
      date: getToday(),
    },
    {
      title: "Lunch break",
      category: "Personal",
      start: "12:30",
      end: "13:30",
      duration: "60 min",
      type: "fixed",
      status: "upcoming",
      energy: 3,
      date: getToday(),
    },
    {
      title: "Revision & practice",
      category: "Study",
      start: "13:30",
      end: "14:30",
      duration: "60 min",
      type: "flexible",
      status: "upcoming",
      energy: 3,
      date: getToday(),
    },
  ];

  useEffect(() => {
    async function loadActivities() {
      try {
        const response = await fetch(
          `http://localhost:5000/api/activities?date=${getToday()}`
        );
        if (!response.ok) {
          throw new Error("Could not connect to the activities API.");
        }

        const data = await response.json();
        let loadedActivities = data.activities;

        if (loadedActivities.length === 0) {
          const createdActivities = await Promise.all(
            initialActivities.map(async (activity) => {
              const createResponse = await fetch(
                "http://localhost:5000/api/activities",
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(activity),
                }
              );
              if (!createResponse.ok) {
                throw new Error("Could not save the sample activities.");
              }
              const result = await createResponse.json();
              return result.activity;
            })
          );
          loadedActivities = createdActivities;
        }

        setActivities(loadedActivities);
        setNotice("Your activities are connected to your database.");
      } catch (error) {
        console.error("Loading activities failed:", error);
        setNotice(
          "Could not load activities. Please check that your backend is running."
        );
      } finally {
        setLoading(false);
      }
    }

    loadActivities();
  }, []);

  const completed = activities.filter(
    (activity) => activity.status === "done"
  ).length;

  async function updateStatus(id, status) {
    try {
      const response = await fetch(
        `http://localhost:5000/api/activities/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Could not update activity.");
      }

      setActivities((current) =>
        current.map((activity) =>
          activity._id === id ? data.activity : activity
        )
      );
      setNotice("Activity saved. Every small step counts.");
    } catch (error) {
      console.error("Updating activity failed:", error);
      setNotice("Your update could not be saved. Please try again.");
    }
  }

  
async function addActivity(event) {
  event.preventDefault();

  const startMinutes =
    Number(formData.start.split(":")[0]) * 60 +
    Number(formData.start.split(":")[1]);

  const endMinutes =
    Number(formData.end.split(":")[0]) * 60 +
    Number(formData.end.split(":")[1]);

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
    date: getToday(),
  };

  try {
    const response = await fetch(
      "http://localhost:5000/api/activities",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(newActivity),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Could not save activity.");
    }

    setActivities((current) =>
      [...current, data.activity].sort((a, b) =>
        a.start.localeCompare(b.start)
      )
    );

    setFormData({
      title: "",
      category: "Study",
      start: "15:00",
      end: "16:00",
      type: "flexible",
    });

    setShowForm(false);
    setNotice("Activity added and saved successfully!");
  } catch (error) {
    console.error("Adding activity failed:", error);
    setNotice(error.message || "Could not save your activity.");
  }
}


async function replanDay() {
  try {
    const now = new Date();
    const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();
    const response = await fetch('http://localhost:5000/api/replan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: getToday(),
        energy,
        currentTimeMinutes,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Could not replan.');
    setActivities(result.activities.sort((a, b) => a.start.localeCompare(b.start)));
    setInsights(result.insights);
    setShowInsights(true);
    setShowInsightsChanges(false);
    setNotice('');
  } catch (error) {
    console.error('Replanning failed:', error);
    setNotice(error.message || 'Could not replan your day. Please try again.');
  }
}

async function fetchHistory() {
  setHistoryLoading(true);
  try {
    const response = await fetch(`http://localhost:5000/api/replan/history?date=${getToday()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Could not load history.');
    if (data.success) setHistoryRecords(data.records);
  } catch (error) {
    console.error('Could not load history:', error);
  } finally {
    setHistoryLoading(false);
  }
}


  function resetDay() {
    setNotice(
      "Reset is not connected yet. Your saved activities remain in the database."
    );
  }

  return (

    <div className="app-shell">

      <aside className="sidebar">

        <div className="brand">

          <div className="brand-icon">g.</div>

          <div>

            <h2>guilt-free</h2>

            <p>your space to reset</p>

          </div>

        </div>



        <div className="nav-label">WORKSPACE</div>



        <button className="nav-item active">

          <span>▦</span> Today

        </button>



        <button
          className={`nav-item ${showHistory ? 'active' : ''}`}
          onClick={() => {
            setShowHistory(prev => !prev);
            if (!showHistory) fetchHistory();
          }}
        >
          <span>▤</span> My schedule
        </button>



        <button

          className="nav-item"

          onClick={() =>

            setNotice("Your unfinished activities tray is coming next.")

          }

        >

          <span>↗</span> Unfinished tray

        </button>



        <div className="sidebar-bottom">

          <div className="sidebar-note">

            <span className="note-icon">✳</span>

            <h3>A gentle reminder</h3>

            <p>

              Your plan is here to support you, not to measure your worth.

            </p>

          </div>

          <p className="sidebar-footer">MADE FOR REAL LIFE ♡</p>

        </div>

      </aside>



      <main className="main-content">

        <header className="topbar">

          <div className="breadcrumb">

            Workspace <span>/</span> <strong>Today</strong>

          </div>

          <div className="profile">

            <div className="profile-avatar">Y</div>

            <span>Your space</span>

          </div>

        </header>



        <section className="welcome-section">

          <div>

            <p className="eyebrow">

              <span className="live-dot" /> YOUR DAY, YOUR PACE

            </p>

            <h1>Make room for today.</h1>

            <p className="welcome-description">

              A plan that bends with you, not against you.

            </p>

          </div>



          <div className="date-card">

            <span>YOUR PLANNER</span>

            <strong>

              {new Date().toLocaleDateString("en-IN", {

                weekday: "short",

                day: "2-digit",

                month: "short",

              })}

            </strong>

            <span className="date-caption">One day at a time ♡</span>

          </div>

        </section>



        <section className="summary-grid">

          <div className="summary-card progress-card">

            <div className="summary-top">

              <span>Today's progress</span>

              <span className="summary-icon">↗</span>

            </div>

            <div className="summary-number">

              {completed}

              <span> / {activities.length}</span>

            </div>

            <div className="progress-track">

              <div

                className="progress-fill"

                style={{

                  width: `${(completed / activities.length) * 100}%`,

                }}

              />

            </div>

            <p>Every bit of progress counts.</p>

          </div>



          <div className="summary-card energy-card">

            <div className="summary-top">

              <span>How's your energy?</span>

              <span className="summary-icon">☼</span>

            </div>

            <div className="energy-options">

              {[1, 2, 3, 4, 5].map((level) => (

                <button

                  key={level}

                  className={`energy-button ${

                    energy === level ? "selected" : ""

                  }`}

                  onClick={() => setEnergy(level)}

                  aria-label={`Energy level ${level}`}

                >

                  {["☁", "◔", "◑", "◕", "☀"][level - 1]}

                </button>

              ))}

            </div>

            <p>

              {[

                "Running on empty",

                "Taking it slow",

                "Finding my pace",

                "Feeling good",

                "Full of energy",

              ][energy - 1]}

            </p>

          </div>



          <div className="summary-card intention-card">

            <div className="summary-top">

              <span>Today's intention</span>

              <span className="summary-icon">♡</span>

            </div>

            <h3>Progress over perfection.</h3>

            <p>You can always begin again.</p>

          </div>

        </section>



        <section className="schedule-section">

          <div className="section-heading">

            <div>

              <p className="eyebrow">YOUR PERSONAL TIMELINE</p>

              <h2>Today's flow <span>✳</span></h2>

              <p className="section-subtitle">

                Adjust as life happens. Nothing here is set in stone.

              </p>

            </div>



            
<div className="heading-actions">
  <button
    className="add-activity-button"
    onClick={() => setShowForm(!showForm)}
  >
    + Add Activity
  </button>

  <button className="reset-button" onClick={resetDay}>
    ↻ Reset demo
  </button>
</div>


          </div>

              
{showForm && (
  <form className="activity-form" onSubmit={addActivity}>
    <h3>Plan something for today ✳</h3>

    <label>
      Activity name
      <input
        type="text"
        placeholder="e.g. Complete Web Tech assignment"
        value={formData.title}
        onChange={(e) =>
          setFormData({ ...formData, title: e.target.value })
        }
        required
      />
    </label>

    <div className="form-row">
      <label>
        Category
        <select
          value={formData.category}
          onChange={(e) =>
            setFormData({ ...formData, category: e.target.value })
          }
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
          onChange={(e) =>
            setFormData({ ...formData, type: e.target.value })
          }
        >
          <option value="flexible">Flexible</option>
          <option value="fixed">Fixed commitment</option>
        </select>
      </label>
    </div>

    <div className="form-row">
      <label>
        Start time
        <input
          type="time"
          value={formData.start}
          onChange={(e) =>
            setFormData({ ...formData, start: e.target.value })
          }
          required
        />
      </label>

      <label>
        End time
        <input
          type="time"
          value={formData.end}
          onChange={(e) =>
            setFormData({ ...formData, end: e.target.value })
          }
          required
        />
      </label>
    </div>

    <div className="form-actions">
      <button type="submit" className="add-activity-button">
        Save Activity
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


          {notice && (

            <div className="notice" role="status">

              <span>✳</span>

              {notice}

              <button onClick={() => setNotice("")} aria-label="Dismiss">

                ×

              </button>

            </div>

          )}



          {loading && <p>Loading your activities...</p>}

          <div className="schedule-list">

            {activities.map((activity, index) => (

              <article

                className={`activity-card ${

                  activity.status === "done" ? "activity-done" : ""

                }`}

                key={activity._id}

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

                    <span className="duration-tag">

                      {activity.duration}

                    </span>

                    {activity.type === "fixed" && (

                      <span className="fixed-tag">Fixed</span>

                    )}

                  </div>

                  <h3>{activity.title}</h3>

                  <p>

                    {activity.type === "fixed"

                      ? "A commitment to keep as planned."

                      : "Flexible — adapt it to your energy."}

                  </p>

                </div>



                <div className="activity-actions">

                  {activity.status === "done" ? (

                    <span className="status-label done-label">✓ Done</span>

                  ) : activity.status === "partial" ? (

                    <span className="status-label partial-label">

                      ◐ Partial

                    </span>

                  ) : activity.status === "skipped" ? (

                    <span className="status-label skipped-label">

                      ↗ Skipped

                    </span>

                  ) : (

                    <span className="status-label upcoming-label">

                      Upcoming

                    </span>

                  )}



                  <div className="action-buttons">

                    <button

                      className="log-button done-button"

                      onClick={() => updateStatus(activity._id, "done")}

                    >

                      ✓ Done

                    </button>

                    <button

                      className="log-button partial-button"

                      onClick={() => updateStatus(activity._id, "partial")}

                    >

                      Partial

                    </button>

                    <button

                      className="log-button skip-button"

                      onClick={() => updateStatus(activity._id, "skipped")}

                    >

                      Skip

                    </button>

                  </div>

                </div>

              </article>

            ))}

          </div>



          <section className="replan-card">

            <div className="replan-symbol">✳</div>

            <div className="replan-copy">

              <h3>Things didn't go as planned?</h3>

              <p>

                That's okay. Let's make a little more room for what matters.

              </p>

            </div>

            <button className="replan-button" onClick={replanDay}>

              Replan my day <span>→</span>

            </button>

          </section>

          {showInsights && insights && (
            <div className="insights-panel">
              <div className="insights-header">
                <span className="energy-label-pill">{insights.energyLabel}</span>
                <button className="hide-insights-link" onClick={() => setShowInsights(false)}>Hide insights</button>
              </div>
              <p className="insights-diagnosis">{insights.diagnosis}</p>
              <button
                className="insights-toggle"
                onClick={() => setShowInsightsChanges(prev => !prev)}
              >
                {showInsightsChanges ? '▾' : '▸'} What changed ({insights.adjustments.length})
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
                <span>{insights.skippedCount} skipped</span>
              </div>
            </div>
          )}

          <footer className="page-footer">

            <span>Made for imperfect days ♡</span>

            <span>YOU ARE ALLOWED TO ADAPT.</span>

          </footer>

        </section>

        {showHistory && (
          <div className="history-drawer">
            <div className="history-drawer-header">
              <h2>My schedule history</h2>
              <button className="history-close" onClick={() => { setShowHistory(false); setSelectedSnapshot(null); }}>×</button>
            </div>
            {selectedSnapshot ? (
              <div className="snapshot-view">
                <button className="back-to-today" onClick={() => setSelectedSnapshot(null)}>← Back to history</button>
                <h3>Snapshot — {selectedSnapshot.date}</h3>
                <div className="snapshot-columns">
                  <div>
                    <h4 className="snapshot-label">Before replan</h4>
                    {selectedSnapshot.snapshotBefore.map((a, i) => (
                      <div key={i} className="snapshot-activity">
                        <span className="snapshot-time">{a.start}</span>
                        <span className="snapshot-title">{a.title}</span>
                        <span className="snapshot-dur">{a.duration}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h4 className="snapshot-label">After replan</h4>
                    {selectedSnapshot.snapshotAfter.map((a, i) => (
                      <div key={i} className="snapshot-activity">
                        <span className="snapshot-time">{a.start}</span>
                        <span className="snapshot-title">{a.title}</span>
                        <span className="snapshot-dur">{a.duration}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="history-list">
                {historyLoading && <p className="history-loading">Loading history...</p>}
                {!historyLoading && historyRecords.length === 0 && (
                  <p className="history-empty">No replan history for today yet. Hit &apos;Replan my day&apos; to get started.</p>
                )}
                {historyRecords.map((record) => (
                  <div key={record._id} className="history-record">
                    <div className="history-record-top">
                      <span className="history-energy-emoji">{['☁','◔','◑','◕','☀'][record.energyAtReplan - 1]}</span>
                      <span className="history-energy-label">{record.energyLabel}</span>
                      <span className="history-time">{new Date(record.replanAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <p className="history-diagnosis">{record.diagnosis}</p>
                    <button
                      className="view-snapshot-button"
                      onClick={() => setSelectedSnapshot(record)}
                    >
                      View snapshot →
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </main>

    </div>

  );

}

export default App;
