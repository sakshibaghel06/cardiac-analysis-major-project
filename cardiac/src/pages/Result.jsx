import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { getRiskHistory } from "../services/riskService";

import {
  PREVENTIVE_GUIDANCE,
  RISK,
  guidanceFor,
  normaliseRisk,
} from "../services/riskGuidance";

/*
=====================================================
RISK RESULT
=====================================================

Branches three ways. Previously this screen showed a
"Consult Doctor" button regardless of the result, which
pushed low-risk patients into a paid consultation they
did not need and gave high-risk patients the same
unhurried path as everyone else.

  LOW       lifestyle guidance, no consultation pushed
  MODERATE  consultation offered
  HIGH      urgent-care warning first, consultation second

Wording never claims a diagnosis, and a LOW result is
never presented as an all-clear - measured recall is
about 0.69, so roughly three in ten true cases are
missed. See services/riskGuidance.js.
=====================================================
*/

function Result() {
  const location = useLocation();
  const navigate = useNavigate();

  const stateRisk = location.state?.risk;
  const stateProbability = location.state?.probability;
  const stateFeatures = location.state?.features;
  const stateAssessmentId = location.state?.assessmentId;
  const stateDisclaimer = location.state?.disclaimer;
  const stateEmergency = location.state?.emergencySymptoms || [];

  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ---------------------------------------------------
  // LOAD HISTORY
  // ---------------------------------------------------

  const fetchHistory = useCallback(() => getRiskHistory(), []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const records = await fetchHistory();

        if (!cancelled) setHistory(records);
      } catch (loadError) {
        if (cancelled) return;

        console.error(loadError);

        setError(
          loadError?.code === "permission-denied"
            ? "You do not have permission to view these assessments."
            : "Could not load your assessment history."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchHistory]);

  // ---------------------------------------------------
  // WHICH RESULT ARE WE SHOWING?
  // ---------------------------------------------------

  /*
    Prefer what the assessment just produced. Falling back to
    the newest stored record means a refresh, or arriving from
    the dashboard, still shows something real rather than a
    placeholder.
  */
  const latest = history.length > 0 ? history[0] : null;

  const risk = normaliseRisk(stateRisk ?? latest?.risk);

  const probability =
    stateProbability ?? latest?.probability ?? null;

  const features = stateFeatures ?? latest?.features ?? null;

  // Prefer the assessment just completed; fall back to the newest stored.
  const assessmentId = stateAssessmentId ?? latest?.id ?? null;

  const emergencySymptoms =
    stateEmergency.length > 0
      ? stateEmergency
      : latest?.emergencySymptoms || [];

  const guidance = guidanceFor(risk);

  const hasResult = Boolean(stateRisk || latest);

  // ---------------------------------------------------
  // READABLE ANSWERS
  // ---------------------------------------------------

  const readable = () => {
    if (!features) return [];

    return [
      ["Age", `${features.age} years`],
      ["Sex", features.sex === 1 ? "Male" : "Female"],
      [
        "Chest pain",
        { 1: "Typical angina", 2: "Atypical angina", 3: "Non-anginal pain" }[
          features.cp
        ] || "None",
      ],
      ["Resting blood pressure", `${features.trestbps} mm Hg`],
      ["Cholesterol", `${features.chol} mg/dL`],
      ["Fasting blood sugar > 120", features.fbs === 1 ? "Yes" : "No"],
      [
        "Resting ECG",
        { 1: "ST-T abnormality", 2: "Left ventricular hypertrophy" }[
          features.restecg
        ] || "Normal",
      ],
      ["Maximum heart rate", `${features.thalach} bpm`],
      ["Exercise-induced angina", features.exang === 1 ? "Yes" : "No"],
    ];
  };

  // ---------------------------------------------------
  // STATES
  // ---------------------------------------------------

  if (loading) {
    return (
      <div className="result-page">
        <div className="result-shell">
          <p className="result-loading">Loading your result...</p>
        </div>
      </div>
    );
  }

  if (!hasResult) {
    return (
      <div className="result-page">
        <div className="result-shell">
          <div className="result-empty">
            <h1>No assessment yet</h1>

            <p>
              Complete a cardiac risk assessment to see your estimated risk
              level here.
            </p>

            <button onClick={() => navigate("/risk")}>
              Start an Assessment
            </button>
          </div>
        </div>
      </div>
    );
  }

  const riskClass = risk.toLowerCase();

  return (
    <div className="result-page">
      <div className="result-shell">
        {/* ==========================================
            EMERGENCY - outranks the model entirely
        ========================================== */}

        {emergencySymptoms.length > 0 && (
          <section className="result-emergency" role="alert">
            <h2>Seek emergency medical help now</h2>

            <p>
              You reported: {emergencySymptoms.join(", ")}.
            </p>

            <p>
              Call your local emergency number or go to the nearest emergency
              department immediately. Do not wait for this assessment, and do
              not use it to decide whether to seek help.
            </p>

            <button onClick={() => navigate("/emergency")}>
              Emergency Information
            </button>
          </section>
        )}

        {/* ==========================================
            THE ESTIMATE
        ========================================== */}

        <section className={`result-hero risk-${riskClass}`}>
          <span className="result-eyebrow">
            AI-ESTIMATED CARDIOVASCULAR RISK
          </span>

          <h1>{risk}</h1>

          <p className="result-headline">{guidance.heading}</p>

          {probability != null && (
            <p className="result-probability">
              Model probability: {(probability * 100).toFixed(1)}%
            </p>
          )}
        </section>

        {error && (
          <div className="result-error" role="alert">
            {error}
          </div>
        )}

        {/* ==========================================
            WHAT IT MEANS
        ========================================== */}

        <section className="result-card">
          <h2>What this means</h2>

          <p className="result-summary">{guidance.summary}</p>

          <p>{guidance.detail}</p>

          <p className="result-caveat">{guidance.caveat}</p>
        </section>

        {/* ==========================================
            HIGH RISK - urgent care comes FIRST
        ========================================== */}

        {risk === RISK.HIGH && (
          <section className="result-card result-urgent">
            <h2>Please be seen promptly</h2>

            <p>
              A higher estimated risk means a doctor should review you
              sooner rather than later. If you develop severe chest pain,
              breathlessness at rest or fainting, treat that as an
              emergency and call your local emergency number.
            </p>

            <div className="result-actions">
              <button onClick={() => navigate("/emergency")}>
                Find Nearby Hospitals
              </button>

              <button
                className="result-secondary"
                onClick={() =>
                  navigate("/consult-doctor", {
                    state: { risk, features, assessmentId },
                  })
                }
              >
                Book an Online Consultation
              </button>
            </div>
          </section>
        )}

        {/* ==========================================
            LOW RISK - preventive guidance, no push
        ========================================== */}

        {risk === RISK.LOW && (
          <section className="result-card">
            <h2>Keeping your heart healthy</h2>

            <p className="result-muted">
              General preventive guidance. None of this is tailored to your
              individual numbers.
            </p>

            <ul className="result-guidance">
              {PREVENTIVE_GUIDANCE.map((item) => (
                <li key={item.title}>
                  <strong>{item.title}</strong>

                  <span>{item.body}</span>
                </li>
              ))}
            </ul>

            <div className="result-actions">
              <button onClick={() => navigate("/patient/dashboard")}>
                Back to Dashboard
              </button>

              <button
                className="result-secondary"
                onClick={() =>
                  navigate("/consult-doctor", {
                    state: { risk, features, assessmentId },
                  })
                }
              >
                I would still like to consult a doctor
              </button>
            </div>
          </section>
        )}

        {/* ==========================================
            MODERATE RISK
        ========================================== */}

        {risk === RISK.MODERATE && (
          <section className="result-card">
            <h2>Next step</h2>

            <p>
              A cardiologist can review your assessment and decide whether
              any further tests are worthwhile.
            </p>

            <div className="result-actions">
              <button
                onClick={() =>
                  navigate("/consult-doctor", {
                    state: { risk, features, assessmentId },
                  })
                }
              >
                Consult a Doctor
              </button>

              <button
                className="result-secondary"
                onClick={() => navigate("/patient/dashboard")}
              >
                Back to Dashboard
              </button>
            </div>
          </section>
        )}

        {/* ==========================================
            WHAT YOU ENTERED
        ========================================== */}

        {features && (
          <section className="result-card">
            <h2>What you entered</h2>

            <dl className="result-values">
              {readable().map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {/* ==========================================
            HISTORY
        ========================================== */}

        {history.length > 0 && (
          <section className="result-card">
            <h2>Assessment history</h2>

            <div className="result-history">
              {history.map((record) => (
                <div key={record.id} className="result-history-row">
                  <span>
                    {record.createdAt?.toDate
                      ? record.createdAt.toDate().toLocaleString()
                      : "Recent"}
                  </span>

                  <span
                    className={`result-chip risk-${normaliseRisk(
                      record.risk
                    ).toLowerCase()}`}
                  >
                    {normaliseRisk(record.risk)}
                  </span>

                  <span className="result-history-probability">
                    {record.probability != null
                      ? `${(record.probability * 100).toFixed(1)}%`
                      : "-"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <p className="result-disclaimer">
          {stateDisclaimer ||
            "This result is an AI-based screening and decision-support " +
              "assessment. It is not a medical diagnosis and cannot rule " +
              "heart disease in or out. Always speak to a qualified doctor " +
              "about your health."}
        </p>
      </div>
    </div>
  );
}

export default Result;
