import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { getRiskHistory } from "../services/riskService";

function Result() {
  const location = useLocation();
  const navigate = useNavigate();

  const currentRisk = location.state?.risk || null;
  const reportFromState = location.state?.report || {};

  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const data = await getRiskHistory();
        setHistory(data);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    loadHistory();
  }, []);

  const latestReport =
    history.length > 0
      ? history[0]
      : reportFromState;

  const finalRisk =
    currentRisk ||
    latestReport?.risk ||
    "--";

  const getRiskClass = (risk) => {
    if (risk === "HIGH") {
      return "risk-high";
    }

    if (risk === "MEDIUM") {
      return "risk-medium";
    }

    return "risk-low";
  };

  const handleConsultDoctor = () => {
    navigate("/consult-doctor", {
      state: {
        risk: finalRisk,
        report: latestReport,
      },
    });
  };

  return (
    <div className="health-dashboard">

      {/* ============================= */}
      {/* SIDEBAR */}
      {/* ============================= */}

      <aside className="health-sidebar">

        <div className="health-logo">
          Health<span>+</span>
        </div>

        <div className="sidebar-menu">

          <div
            className="menu-item"
            onClick={() => navigate("/risk")}
          >
            ←
            <span>Back to Assessment</span>
          </div>

          <div className="menu-item active">
            ▤
            <span>Health Report</span>
          </div>

          <div
            className="menu-item"
            onClick={() => {
              window.scrollTo({
                top: 450,
                behavior: "smooth",
              });
            }}
          >
            ◷
            <span>Report History</span>
          </div>

          <div className="menu-item">
            ?
            <span>Support</span>
          </div>

          <div className="menu-item">
            ◯
            <span>Profile</span>
          </div>

        </div>

        <div
          className="menu-item exit"
          onClick={() => navigate("/")}
        >
          ⇥
          <span>Logout</span>
        </div>

      </aside>

      {/* ============================= */}
      {/* MAIN */}
      {/* ============================= */}

      <main className="health-main">

        {/* TOP BAR */}

        <header className="health-topbar">

          <div className="search-box">
            Search
          </div>

          <div className="top-profile">

            <div className="profile-circle">
              P
            </div>

            <span>
              Patient
            </span>

            <span>
              ˅
            </span>

          </div>

        </header>

        {/* ============================= */}
        {/* CONTENT */}
        {/* ============================= */}

        <section className="health-content">

          {/* WELCOME */}

          <div className="welcome-section">

            <div>

              <span className="section-label">
                HEALTH DIAGNOSIS
              </span>

              <h1>
                Your Cardiac Health
              </h1>

              <p>
                Here is your latest cardiac
                risk assessment report.
              </p>

            </div>

            <div className="date-pill">
              {new Date().toLocaleDateString(
                "en-IN",
                {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                }
              )}
            </div>

          </div>

          {/* ============================= */}
          {/* REPORT GRID */}
          {/* ============================= */}

          <div className="report-grid">

            {/* RISK */}

            <div
              className={`current-risk-card ${
                finalRisk !== "--"
                  ? getRiskClass(finalRisk)
                  : ""
              }`}
            >

              <span>
                TODAY'S CARDIAC RISK
              </span>

              <h2>
                {finalRisk}
              </h2>

              <p>
                AI-powered cardiac risk
                assessment
              </p>

            </div>

            {/* HEART RATE */}

            <div className="metric-card">

              <span>
                Heart Rate
              </span>

              <strong>
                {latestReport?.heartRate ||
                  "--"}
              </strong>

              <small>
                bpm
              </small>

            </div>

            {/* BLOOD PRESSURE */}

            <div className="metric-card">

              <span>
                Blood Pressure
              </span>

              <strong>
                {latestReport?.bloodPressure ||
                  "--"}
              </strong>

              <small>
                mmHg
              </small>

            </div>

            {/* CHOLESTEROL */}

            <div className="metric-card">

              <span>
                Cholesterol
              </span>

              <strong>
                {latestReport?.cholesterol ||
                  "--"}
              </strong>

              <small>
                mg/dL
              </small>

            </div>

          </div>

          {/* ============================= */}
          {/* HISTORY + CALENDAR */}
          {/* ============================= */}

          <div className="health-two-column">

            {/* HISTORY */}

            <div className="health-panel">

              <div className="panel-heading">

                <h2>
                  Risk History
                </h2>

                <span>
                  Recent
                </span>

              </div>

              {loading ? (

                <p>
                  Loading history...
                </p>

              ) : history.length === 0 ? (

                <p>
                  No previous assessments.
                </p>

              ) : (

                <div className="history-list">

                  {history
                    .slice(0, 5)
                    .map((item) => {

                      const date =
                        item.createdAt?.toDate
                          ? item.createdAt.toDate()
                          : new Date(
                              item.createdAt
                            );

                      return (

                        <div
                          className="history-row"
                          key={item.id}
                        >

                          <div className="history-date">

                            <strong>
                              {date.toLocaleDateString(
                                "en-IN",
                                {
                                  day: "2-digit",
                                  month: "short",
                                }
                              )}
                            </strong>

                            <small>
                              {date.toLocaleTimeString(
                                "en-IN",
                                {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                }
                              )}
                            </small>

                          </div>

                          <div className="history-bar">

                            <div
                              className={`history-risk ${getRiskClass(
                                item.risk
                              )}`}
                            >
                              {item.risk}
                            </div>

                          </div>

                        </div>

                      );
                    })}

                </div>
              )}

            </div>

            {/* CALENDAR */}

            <div className="health-panel">

              <div className="panel-heading">

                <h2>
                  Assessment Calendar
                </h2>

                <span>
                  {new Date().toLocaleDateString(
                    "en-IN",
                    {
                      month: "long",
                      year: "numeric",
                    }
                  )}
                </span>

              </div>

              <div className="calendar-grid">

                {[
                  "MON",
                  "TUE",
                  "WED",
                  "THU",
                  "FRI",
                  "SAT",
                  "SUN",
                ].map((day) => (

                  <span
                    key={day}
                    className="calendar-day-name"
                  >
                    {day}
                  </span>

                ))}

                {Array.from(
                  { length: 7 },
                  (_, index) => {

                    const record =
                      history[index];

                    return (

                      <div
                        className={`calendar-day ${
                          record
                            ? getRiskClass(
                                record.risk
                              )
                            : ""
                        }`}
                        key={index}
                      >

                        <strong>
                          {index + 1}
                        </strong>

                        {record && (
                          <small>
                            {record.risk}
                          </small>
                        )}

                      </div>

                    );
                  }
                )}

              </div>

            </div>

          </div>

          {/* ============================= */}
          {/* FULL CARDIAC REPORT */}
          {/* ============================= */}

          {latestReport && (

            <div className="full-report">

              <div className="panel-heading">

                <div>

                  <span className="section-label">
                    CARDIAC REPORT
                  </span>

                  <h2>
                    Latest Assessment
                  </h2>

                </div>

                <span className="report-status">
                  AI ANALYZED
                </span>

              </div>

              {/* REPORT VALUES */}

              <div className="report-details">

                <div>
                  <span>
                    Age
                  </span>

                  <strong>
                    {latestReport.age || "--"}
                  </strong>
                </div>

                <div>
                  <span>
                    Blood Pressure
                  </span>

                  <strong>
                    {latestReport.bloodPressure ||
                      "--"}{" "}
                    mmHg
                  </strong>
                </div>

                <div>
                  <span>
                    Cholesterol
                  </span>

                  <strong>
                    {latestReport.cholesterol ||
                      "--"}{" "}
                    mg/dL
                  </strong>
                </div>

                <div>
                  <span>
                    Heart Rate
                  </span>

                  <strong>
                    {latestReport.heartRate ||
                      "--"}{" "}
                    bpm
                  </strong>
                </div>

                <div>
                  <span>
                    ECG
                  </span>

                  <strong>
                    {latestReport.ecg === 0 ||
                    latestReport.ecg === "0"
                      ? "Normal"
                      : "Abnormal"}
                  </strong>
                </div>

                <div>
                  <span>
                    Exercise Angina
                  </span>

                  <strong>
                    {latestReport.exerciseAngina ===
                      1 ||
                    latestReport.exerciseAngina ===
                      "1"
                      ? "Yes"
                      : "No"}
                  </strong>
                </div>

              </div>

              {/* ============================= */}
              {/* MEDIUM RISK */}
              {/* ============================= */}

              {finalRisk === "MEDIUM" && (

                <div className="consult-section">

                  <div>

                    <h3>
                      Would you like to
                      consult a doctor?
                    </h3>

                    <p>
                      Choose your city, hospital
                      and preferred doctor. Your
                      cardiac report will be shared
                      securely with the selected
                      doctor.
                    </p>

                  </div>

                  <button
                    className="doctor-btn"
                    onClick={
                      handleConsultDoctor
                    }
                  >
                    Consult a Doctor
                  </button>

                </div>

              )}

              {/* ============================= */}
              {/* HIGH RISK */}
              {/* ============================= */}

              {finalRisk === "HIGH" && (

                <div className="emergency-section">

                  <div>

                    <h3>
                      High cardiac risk
                      detected
                    </h3>

                    <p>
                      Your assessment indicates
                      a high level of cardiac risk.
                      Please seek medical attention
                      promptly.
                    </p>

                  </div>

                  <button
                    className="emergency-btn"
                    onClick={() =>
                      navigate(
                        "/consult-doctor",
                        {
                          state: {
                            risk: finalRisk,
                            report:
                              latestReport,
                          },
                        }
                      )
                    }
                  >
                    Find a Doctor
                  </button>

                </div>

              )}

              {/* ============================= */}
              {/* LOW RISK */}
              {/* ============================= */}

              {finalRisk === "LOW" && (

                <div className="low-result-section">

                  <div>

                    <h3>
                      Your current risk level
                      is low
                    </h3>

                    <p>
                      Your assessment does not
                      indicate an elevated cardiac
                      risk at this time.
                    </p>

                  </div>

                  <button
                    className="secondary-btn"
                    onClick={() =>
                      navigate("/risk")
                    }
                  >
                    New Assessment
                  </button>

                </div>

              )}

            </div>

          )}

        </section>

      </main>

    </div>
  );
}

export default Result;