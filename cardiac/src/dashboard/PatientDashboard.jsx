import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../context/useAuth";

import { getRiskHistory } from "../services/riskService";
import {
  getPatientConsultations,
  isActive,
  isJoinable,
  normaliseStatus,
  statusLabel,
} from "../services/consultationService";
import { getMyPrescriptions } from "../services/prescriptionService";
import { normaliseRisk } from "../services/riskGuidance";
import { patientNotifications } from "../services/notificationService";
import NotificationsPanel from "../components/NotificationsPanel";

/*
=====================================================
PATIENT DASHBOARD
=====================================================

Everything on this screen now comes from Firebase.

The previous version was entirely static: a hero banner,
emoji service cards, and four dead <a href="#"> links. It
showed no patient name, no risk result, no consultation
status and no prescription - none of it was connected to
anything.

Nothing here is hardcoded except UI labels. Counts are
computed from the documents actually returned, never
typed in.
=====================================================
*/

function PatientDashboard() {
  const navigate = useNavigate();
  const {
    user,
    profile,
    displayName,
    loading: authLoading,
    logout,
    refreshProfile,
  } = useAuth();

  const [assessments, setAssessments] = useState([]);
  const [consultations, setConsultations] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ---------------------------------------------------
  // LOAD
  // ---------------------------------------------------

  /*
    allSettled, not all.

    Promise.all rejects the moment ANY query fails, so a single
    permission problem in one collection wiped the whole dashboard -
    the patient saw "You do not have permission to view this data"
    and every count read zero, including the assessments they could
    perfectly well read.

    Each section now stands on its own: whatever loaded is shown,
    and only the part that actually failed is reported.
  */
  const fetchAll = useCallback(async () => {
    const [risk, consults, scripts] = await Promise.allSettled([
      getRiskHistory(),
      getPatientConsultations(),
      getMyPrescriptions(),
    ]);

    const failures = [];

    const unwrap = (settled, label) => {
      if (settled.status === "fulfilled") return settled.value;

      console.error(`${label} failed`, {
        code: settled.reason?.code || "none",
        message: settled.reason?.message,
      });

      failures.push(label);

      return [];
    };

    return {
      risk: unwrap(risk, "assessments"),
      consults: unwrap(consults, "consultations"),
      scripts: unwrap(scripts, "prescriptions"),
      failures,
    };
  }, []);

  useEffect(() => {
    if (authLoading || !user) return undefined;

    let cancelled = false;

    (async () => {
      try {
        const { risk, consults, scripts, failures } = await fetchAll();

        if (cancelled) return;

        setAssessments(risk);
        setConsultations(consults);
        setPrescriptions(scripts);

        if (failures.length > 0) {
          // Name what actually failed, not a blanket denial.
          setError(
            `Could not load your ${failures.join(" or ")}. ` +
              "Everything else on this page is up to date. " +
              "Please refresh to try again."
          );
        }
      } catch (loadError) {
        if (cancelled) return;

        console.error(loadError);

        setError(
          loadError?.code === "permission-denied"
            ? "You do not have permission to view this data."
            : "Could not load your dashboard. Please refresh to try again."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, fetchAll]);

  // ---------------------------------------------------
  // DERIVED - all computed, never hardcoded
  // ---------------------------------------------------

  const latestAssessment = assessments[0] || null;

  const latestRisk = latestAssessment
    ? normaliseRisk(latestAssessment.risk)
    : null;

  const activeConsultation = consultations.find((consultation) =>
    isActive(consultation.status)
  );

  const completedCount = consultations.filter(
    (consultation) => consultation.status === "completed"
  ).length;

  /*
    Derived from the consultations and prescriptions already
    loaded above - no extra read, no duplicated state.
  */
  const notifications = patientNotifications({
    consultations,
    prescriptions,
  });

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  // ---------------------------------------------------
  // RENDER
  // ---------------------------------------------------

  if (authLoading || loading) {
    return (
      <div className="pd-page">
        <div className="pd-shell">
          <p className="pd-loading">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pd-page">
      {/* ============================================
          TOP BAR
      ============================================ */}

      <header className="pd-topbar">
        <div className="pd-brand">
          Cardio<span>Care</span>
        </div>

        <nav className="pd-nav">
          <NotificationsPanel
            items={notifications}
            lastSeenAt={profile?.lastSeenNotificationsAt}
            role="patient"
            onSeen={refreshProfile}
          />

          <button onClick={() => navigate("/profile")}>Profile</button>
          <button onClick={() => navigate("/risk")}>Assessment</button>
          <button onClick={() => navigate("/consultations")}>
            Consultations
          </button>
          <button onClick={() => navigate("/emergency")}>Emergency</button>
          <button className="pd-logout" onClick={handleLogout}>
            Log out
          </button>
        </nav>
      </header>

      <div className="pd-shell">
        {error && (
          <div className="pd-error" role="alert">
            {error}
          </div>
        )}

        {/* ============================================
            WELCOME  -  real name from Firestore
        ============================================ */}

        <section className="pd-welcome">
          <div>
            <span className="pd-eyebrow">PATIENT DASHBOARD</span>

            <h1>
              Welcome{displayName ? `, ${displayName}` : ""}
            </h1>

            <p>{user?.email}</p>
          </div>

          <button className="pd-primary" onClick={() => navigate("/risk")}>
            Start Assessment
          </button>
        </section>

        {/* ============================================
            AT A GLANCE  -  counts computed from data
        ============================================ */}

        <section className="pd-stats">
          <article className="pd-stat">
            <span>Assessments</span>
            <strong>{assessments.length}</strong>
          </article>

          <article className="pd-stat">
            <span>Consultations</span>
            <strong>{consultations.length}</strong>
          </article>

          <article className="pd-stat">
            <span>Completed</span>
            <strong>{completedCount}</strong>
          </article>

          <article className="pd-stat">
            <span>Prescriptions</span>
            <strong>{prescriptions.length}</strong>
          </article>
        </section>

        <div className="pd-grid">
          {/* ==========================================
              LATEST RISK RESULT
          ========================================== */}

          <section className="pd-card">
            <header className="pd-card-head">
              <h2>Latest risk result</h2>

              {assessments.length > 0 && (
                <button onClick={() => navigate("/result")}>View</button>
              )}
            </header>

            {!latestAssessment ? (
              <div className="pd-empty">
                <p>You have not completed an assessment yet.</p>

                <button onClick={() => navigate("/risk")}>
                  Start your first assessment
                </button>
              </div>
            ) : (
              <>
                <div
                  className={`pd-risk risk-${latestRisk.toLowerCase()}`}
                >
                  <strong>{latestRisk}</strong>

                  <span>
                    {latestAssessment.probability != null
                      ? `Model probability ${(
                          latestAssessment.probability * 100
                        ).toFixed(1)}%`
                      : "AI-estimated risk"}
                  </span>
                </div>

                <p className="pd-muted">
                  Assessed{" "}
                  {latestAssessment.createdAt?.toDate
                    ? latestAssessment.createdAt.toDate().toLocaleString()
                    : "recently"}
                </p>

                <p className="pd-fineprint">
                  An AI-based screening estimate, not a medical diagnosis.
                </p>
              </>
            )}
          </section>

          {/* ==========================================
              CONSULTATION STATUS
          ========================================== */}

          <section className="pd-card">
            <header className="pd-card-head">
              <h2>Consultation</h2>

              {consultations.length > 0 && (
                <button onClick={() => navigate("/consultations")}>
                  All
                </button>
              )}
            </header>

            {!activeConsultation ? (
              <div className="pd-empty">
                <p>No consultation in progress.</p>

                {latestRisk && latestRisk !== "LOW" && (
                  <button onClick={() => navigate("/consult-doctor")}>
                    Consult a doctor
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="pd-consult">
                  <strong>
                    {activeConsultation.doctorName || "Your doctor"}
                  </strong>

                  <span className="pd-muted">
                    {[
                      activeConsultation.hospitalName,
                      activeConsultation.city,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>

                  <span
                    className={`pd-status ${normaliseStatus(
                      activeConsultation.status
                    )}`}
                  >
                    {statusLabel(activeConsultation.status)}
                  </span>
                </div>

                {isJoinable(activeConsultation.status) && (
                  <button
                    className="pd-primary pd-block"
                    onClick={() =>
                      navigate(
                        `/consultation-status/${activeConsultation.id}`
                      )
                    }
                  >
                    Open consultation
                  </button>
                )}

                {activeConsultation.status === "pending" && (
                  <p className="pd-muted">
                    Your request has been sent. You will see it here the
                    moment the doctor responds.
                  </p>
                )}
              </>
            )}
          </section>

          {/* ==========================================
              PRESCRIPTION
          ========================================== */}

          <section className="pd-card">
            <header className="pd-card-head">
              <h2>Prescriptions</h2>
            </header>

            {prescriptions.length === 0 ? (
              <div className="pd-empty">
                <p>
                  No prescriptions yet. Your doctor will issue one after a
                  consultation.
                </p>
              </div>
            ) : (
              <ul className="pd-list">
                {prescriptions.slice(0, 3).map((prescription) => (
                  <li key={prescription.id}>
                    <div>
                      <strong>
                        {prescription.diagnosis || "Prescription"}
                      </strong>

                      <span className="pd-muted">
                        {prescription.createdAt?.toDate
                          ? prescription.createdAt
                              .toDate()
                              .toLocaleDateString()
                          : ""}
                      </span>
                    </div>

                    <button
                      onClick={() =>
                        navigate(`/prescription/${prescription.requestId}`)
                      }
                    >
                      View
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ==========================================
              ASSESSMENT HISTORY
          ========================================== */}

          <section className="pd-card">
            <header className="pd-card-head">
              <h2>Assessment history</h2>
            </header>

            {assessments.length === 0 ? (
              <div className="pd-empty">
                <p>Your past assessments will appear here.</p>
              </div>
            ) : (
              <ul className="pd-list">
                {assessments.slice(0, 5).map((record) => (
                  <li key={record.id}>
                    <div>
                      <strong>
                        {record.createdAt?.toDate
                          ? record.createdAt.toDate().toLocaleDateString()
                          : "Recent"}
                      </strong>

                      <span className="pd-muted">
                        {record.probability != null
                          ? `${(record.probability * 100).toFixed(1)}%`
                          : ""}
                      </span>
                    </div>

                    <span
                      className={`pd-chip risk-${normaliseRisk(
                        record.risk
                      ).toLowerCase()}`}
                    >
                      {normaliseRisk(record.risk)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ============================================
            EMERGENCY
        ============================================ */}

        <section className="pd-emergency">
          <div>
            <strong>Feeling unwell right now?</strong>

            <p>
              Severe chest pain, breathlessness at rest or fainting need
              emergency care - whatever a screening result says.
            </p>
          </div>

          <button onClick={() => navigate("/emergency")}>
            Emergency Information
          </button>
        </section>
      </div>
    </div>
  );
}

export default PatientDashboard;
