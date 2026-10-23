import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../context/useAuth";

import { doctorNotifications } from "../services/notificationService";
import NotificationsPanel from "../components/NotificationsPanel";

import {
  getDoctorConsultations,
  getDoctorPatients,
  getDoctorPrescriptions,
  getDoctorRiskAssessments,
} from "../services/doctorService";

import {
  STATUS,
  isJoinable,
  normaliseStatus,
  statusLabel,
} from "../services/consultationService";

/*
=====================================================
DOCTOR DASHBOARD
=====================================================

Seven sections, all reading real Firestore data:

  Dashboard              statistics, computed
  Consultation Requests  pending, needs a decision
  Patients               derived from this doctor's own
                         consultations - there is no
                         "all patients" query anywhere
  Risk Assessments       per patient, via care links
  Upcoming               accepted, not yet completed
  Prescriptions          issued by this doctor
  History                completed and rejected

Previously the sidebar linked to /doctor/consultations,
/doctor/patients and /doctor/profile. None of those
routes existed, so every one rendered a blank page.
They are now sections of this screen rather than routes,
which keeps all the data in one fetch.

NOTHING here is hardcoded. Every count is derived from
the documents returned; no number is typed in.
=====================================================
*/

const SECTIONS = [
  { id: "overview", label: "Dashboard", icon: "▦" },
  { id: "requests", label: "Consultation Requests", icon: "✉" },
  { id: "patients", label: "Patients", icon: "♡" },
  { id: "assessments", label: "Risk Assessments", icon: "◈" },
  { id: "upcoming", label: "Upcoming Consultations", icon: "◷" },
  { id: "prescriptions", label: "Prescriptions", icon: "℞" },
  { id: "history", label: "Consultation History", icon: "▤" },
];

/*
  Labels come from consultationService, with one override.

  The shared label for `pending` is "Waiting for doctor", which is
  written from the patient's point of view and reads oddly to the
  doctor who IS the one being waited on. Everything else is shared,
  so this dashboard cannot fall out of step with a new status -
  three separate copies of this map are how the in_progress bug
  reached every screen at once.
*/
const DOCTOR_LABEL = {
  [STATUS.PENDING]: "Pending",
};

const labelFor = (status) =>
  DOCTOR_LABEL[normaliseStatus(status)] || statusLabel(status);

const formatDate = (value) =>
  value?.toDate ? value.toDate().toLocaleString() : "-";

const formatDay = (value) =>
  value?.toDate ? value.toDate().toLocaleDateString() : "-";

const riskClass = (risk) =>
  `dd-risk ${String(risk || "").toLowerCase() === "high"
    ? "high"
    : String(risk || "").toLowerCase() === "low"
    ? "low"
    : "moderate"}`;

/*
Defined at module scope, not inside DoctorDashboard.

A component created during render is a brand new type on
every render, so React unmounts and remounts its whole
subtree each time - losing focus, scroll position and
state. The lint rule react-hooks/static-components exists
to catch exactly that.
*/

function Empty({ children }) {
  return (
    <div className="dd-empty">
      <p>{children}</p>
    </div>
  );
}

function ConsultationRow({ consultation, action }) {
  return (
    <li className="dd-row">
      <div className="dd-row-main">
        <strong>{consultation.patientName || "Patient"}</strong>

        <span className="dd-muted">{consultation.patientEmail}</span>

        <span className="dd-muted">
          Requested {formatDate(consultation.createdAt)}
        </span>
      </div>

      <div className="dd-row-tags">
        {consultation.risk && (
          <span className={riskClass(consultation.risk)}>
            {String(consultation.risk).toUpperCase()}
          </span>
        )}

        <span className={`dd-status ${consultation.status}`}>
          {labelFor(consultation.status)}
        </span>

        {consultation.fee != null && (
          <span
            className={`dd-pay ${
              consultation.paymentStatus === "paid" ? "paid" : "unpaid"
            }`}
          >
            {consultation.paymentStatus === "paid"
              ? "Paid"
              : `₹${consultation.fee} due`}
          </span>
        )}
      </div>

      <div className="dd-row-actions">{action}</div>
    </li>
  );
}

function DoctorDashboard() {
  const navigate = useNavigate();
  const {
    user,
    profile,
    displayName,
    loading: authLoading,
    logout,
    refreshProfile,
  } = useAuth();

  const [section, setSection] = useState("overview");

  const [consultations, setConsultations] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [assessments, setAssessments] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ---------------------------------------------------
  // LOAD
  // ---------------------------------------------------

  /*
    allSettled so one failing collection cannot blank the whole
    dashboard - see the note in PatientDashboard.
  */
  const fetchAll = useCallback(async (doctorUid) => {
    const [consultationsResult, prescriptionsResult] = await Promise.allSettled([
      getDoctorConsultations(doctorUid),
      getDoctorPrescriptions(doctorUid),
    ]);

    if (consultationsResult.status === "rejected") {
      console.error("Doctor consultations failed", {
        code: consultationsResult.reason?.code || "none",
        message: consultationsResult.reason?.message,
      });
    }

    if (prescriptionsResult.status === "rejected") {
      console.error("Doctor prescriptions failed", {
        code: prescriptionsResult.reason?.code || "none",
        message: prescriptionsResult.reason?.message,
      });
    }

    const myConsultations =
      consultationsResult.status === "fulfilled" ? consultationsResult.value : [];

    const myPrescriptions =
      prescriptionsResult.status === "fulfilled" ? prescriptionsResult.value : [];

    /*
      Assessments are fetched per patient because the rules
      authorise per care link - there is no single query that
      could return them all.
    */
    const patientIds = [
      ...new Set(
        myConsultations
          .filter((c) => ["accepted", "completed"].includes(c.status))
          .map((c) => c.patientId)
          .filter(Boolean)
      ),
    ];

    const myAssessments = await getDoctorRiskAssessments(patientIds);

    return { myConsultations, myPrescriptions, myAssessments };
  }, []);

  useEffect(() => {
    if (authLoading) return undefined;

    if (!user) {
      navigate("/", { replace: true });
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        const { myConsultations, myPrescriptions, myAssessments } =
          await fetchAll(user.uid);

        if (cancelled) return;

        setConsultations(myConsultations);
        setPrescriptions(myPrescriptions);
        setAssessments(myAssessments);
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
  }, [authLoading, user, fetchAll, navigate]);

  // ---------------------------------------------------
  // DERIVED  -  every count computed, never typed in
  // ---------------------------------------------------

  const byStatus = useMemo(
    () => ({
      pending: consultations.filter((c) => c.status === "pending"),
      // "Upcoming" covers both accepted and already under way.
      accepted: consultations.filter((c) => isJoinable(c.status)),
      completed: consultations.filter((c) => c.status === "completed"),
      rejected: consultations.filter((c) => c.status === "rejected"),
      cancelled: consultations.filter((c) => c.status === "cancelled"),
    }),
    [consultations]
  );

  const patients = useMemo(
    () => getDoctorPatients(consultations),
    [consultations]
  );

  const highRiskCount = useMemo(
    () =>
      consultations.filter(
        (c) =>
          String(c.risk || "").toUpperCase() === "HIGH" &&
          !["completed", "rejected", "cancelled"].includes(c.status)
      ).length,
    [consultations]
  );

  /*
    Derived from the consultations already loaded - no extra
    read and no second source of truth to drift.
  */
  const notifications = useMemo(
    () => doctorNotifications({ consultations }),
    [consultations]
  );

  const historyItems = useMemo(
    () =>
      consultations.filter((c) =>
        ["completed", "rejected", "cancelled"].includes(c.status)
      ),
    [consultations]
  );

  const handleLogout = async () => {
    await logout();
    navigate("/doctor/login", { replace: true });
  };

  // ---------------------------------------------------
  // RENDER
  // ---------------------------------------------------

  if (authLoading || loading) {
    return (
      <div className="dd-page">
        <div className="dd-loading">Loading your dashboard...</div>
      </div>
    );
  }

  return (
    <div className="dd-page">
      {/* ==========================================
          SIDEBAR
      ========================================== */}

      <aside className="dd-sidebar">
        <div className="dd-brand">
          Cardio<span>Care</span>
        </div>

        <div className="dd-me">
          <div className="dd-avatar">
            {(displayName || "D").charAt(0).toUpperCase()}
          </div>

          <div>
            <strong>{displayName || "Doctor"}</strong>

            <span>{profile?.specialization || "Doctor"}</span>
          </div>
        </div>

        <nav className="dd-nav">
          {SECTIONS.map((item) => {
            const badge =
              item.id === "requests"
                ? byStatus.pending.length
                : item.id === "upcoming"
                ? byStatus.accepted.length
                : 0;

            return (
              <button
                key={item.id}
                className={section === item.id ? "active" : ""}
                onClick={() => setSection(item.id)}
              >
                <span className="dd-nav-icon">{item.icon}</span>

                {item.label}

                {badge > 0 && <span className="dd-badge">{badge}</span>}
              </button>
            );
          })}
        </nav>

        <button
          className="dd-logout"
          onClick={() => navigate("/doctor/profile")}
        >
          My Profile
        </button>

        <button className="dd-logout" onClick={handleLogout}>
          Log out
        </button>
      </aside>

      {/* ==========================================
          MAIN
      ========================================== */}

      <main className="dd-main">
        <header className="dd-topbar">
          <div>
            <span className="dd-eyebrow">DOCTOR PORTAL</span>

            <h1>{SECTIONS.find((s) => s.id === section)?.label}</h1>
          </div>

          <div className="dd-topbar-meta">
            {profile?.hospitalName && <span>{profile.hospitalName}</span>}

            {profile?.location && <span>{profile.location}</span>}

            <NotificationsPanel
              items={notifications}
              lastSeenAt={profile?.lastSeenNotificationsAt}
              role="doctor"
              onSeen={refreshProfile}
            />
          </div>
        </header>

        {error && (
          <div className="dd-error" role="alert">
            {error}
          </div>
        )}

        {/* ---------- OVERVIEW ---------- */}

        {section === "overview" && (
          <>
            <div className="dd-stats">
              <article className="dd-stat">
                <span>Pending requests</span>
                <strong>{byStatus.pending.length}</strong>
              </article>

              <article className="dd-stat">
                <span>Accepted</span>
                <strong>{byStatus.accepted.length}</strong>
              </article>

              <article className="dd-stat">
                <span>Completed</span>
                <strong>{byStatus.completed.length}</strong>
              </article>

              <article className="dd-stat dd-stat-alert">
                <span>High risk needing attention</span>
                <strong>{highRiskCount}</strong>
              </article>

              <article className="dd-stat">
                <span>Patients</span>
                <strong>{patients.length}</strong>
              </article>

              <article className="dd-stat">
                <span>Prescriptions issued</span>
                <strong>{prescriptions.length}</strong>
              </article>
            </div>

            <section className="dd-card">
              <header className="dd-card-head">
                <h2>Needs your attention</h2>

                {byStatus.pending.length > 0 && (
                  <button onClick={() => setSection("requests")}>
                    View all
                  </button>
                )}
              </header>

              {byStatus.pending.length === 0 ? (
                <Empty>No consultation requests are waiting.</Empty>
              ) : (
                <ul className="dd-list">
                  {byStatus.pending.slice(0, 5).map((consultation) => (
                    <ConsultationRow
                      key={consultation.id}
                      consultation={consultation}
                      action={
                        <button
                          onClick={() =>
                            navigate(`/doctor/request/${consultation.id}`)
                          }
                        >
                          Review
                        </button>
                      }
                    />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {/* ---------- REQUESTS ---------- */}

        {section === "requests" && (
          <section className="dd-card">
            {byStatus.pending.length === 0 ? (
              <Empty>
                No pending requests. New consultation requests appear here.
              </Empty>
            ) : (
              <ul className="dd-list">
                {byStatus.pending.map((consultation) => (
                  <ConsultationRow
                    key={consultation.id}
                    consultation={consultation}
                    action={
                      <button
                        onClick={() =>
                          navigate(`/doctor/request/${consultation.id}`)
                        }
                      >
                        Accept or Decline
                      </button>
                    }
                  />
                ))}
              </ul>
            )}
          </section>
        )}

        {/* ---------- PATIENTS ---------- */}

        {section === "patients" && (
          <section className="dd-card">
            {patients.length === 0 ? (
              <Empty>
                No patients yet. A patient appears here once they request a
                consultation with you.
              </Empty>
            ) : (
              <div className="dd-table-wrap">
                <table className="dd-table">
                  <thead>
                    <tr>
                      <th>Patient</th>
                      <th>Email</th>
                      <th>Latest risk</th>
                      <th>Consultations</th>
                      <th>Status</th>
                    </tr>
                  </thead>

                  <tbody>
                    {patients.map((patient) => (
                      <tr key={patient.patientId}>
                        <td>{patient.name}</td>

                        <td className="dd-muted">{patient.email}</td>

                        <td>
                          {patient.latestRisk ? (
                            <span className={riskClass(patient.latestRisk)}>
                              {String(patient.latestRisk).toUpperCase()}
                            </span>
                          ) : (
                            <span className="dd-muted">-</span>
                          )}
                        </td>

                        <td>{patient.total}</td>

                        <td>
                          <span className={`dd-status ${patient.latestStatus}`}>
                            {labelFor(patient.latestStatus)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* ---------- RISK ASSESSMENTS ---------- */}

        {section === "assessments" && (
          <section className="dd-card">
            <p className="dd-note">
              Assessments belonging to patients whose consultation you have
              accepted. A doctor cannot read an unrelated patient&apos;s
              records.
            </p>

            {assessments.length === 0 ? (
              <Empty>
                No assessments visible yet. Accept a consultation request to
                see that patient&apos;s cardiac assessments.
              </Empty>
            ) : (
              <div className="dd-table-wrap">
                <table className="dd-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Risk</th>
                      <th>Probability</th>
                      <th>Age</th>
                      <th>BP</th>
                      <th>Chol</th>
                      <th>Max HR</th>
                    </tr>
                  </thead>

                  <tbody>
                    {assessments.map((assessment) => {
                      const f = assessment.features || {};

                      return (
                        <tr key={assessment.id}>
                          <td>{formatDay(assessment.createdAt)}</td>

                          <td>
                            <span className={riskClass(assessment.risk)}>
                              {String(assessment.risk || "-").toUpperCase()}
                            </span>
                          </td>

                          <td>
                            {assessment.probability != null
                              ? `${(assessment.probability * 100).toFixed(1)}%`
                              : "-"}
                          </td>

                          <td>{f.age ?? assessment.age ?? "-"}</td>

                          <td>
                            {f.trestbps ?? assessment.bloodPressure ?? "-"}
                          </td>

                          <td>{f.chol ?? assessment.cholesterol ?? "-"}</td>

                          <td>{f.thalach ?? assessment.heartRate ?? "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* ---------- UPCOMING ---------- */}

        {section === "upcoming" && (
          <section className="dd-card">
            {byStatus.accepted.length === 0 ? (
              <Empty>
                No upcoming consultations. Accept a request to schedule one.
              </Empty>
            ) : (
              <ul className="dd-list">
                {byStatus.accepted.map((consultation) => (
                  <ConsultationRow
                    key={consultation.id}
                    consultation={consultation}
                    action={
                      <>
                        <button
                          onClick={() =>
                            navigate(
                              `/video-consultation/${consultation.id}`
                            )
                          }
                        >
                          Join Call
                        </button>

                        <button
                          className="dd-secondary"
                          onClick={() =>
                            navigate(`/prescription/${consultation.id}`)
                          }
                        >
                          Prescription
                        </button>
                      </>
                    }
                  />
                ))}
              </ul>
            )}
          </section>
        )}

        {/* ---------- PRESCRIPTIONS ---------- */}

        {section === "prescriptions" && (
          <section className="dd-card">
            {prescriptions.length === 0 ? (
              <Empty>
                You have not issued any prescriptions yet. Write one from an
                accepted consultation.
              </Empty>
            ) : (
              <ul className="dd-list">
                {prescriptions.map((prescription) => (
                  <li key={prescription.id} className="dd-row">
                    <div className="dd-row-main">
                      <strong>
                        {prescription.patientName || "Patient"}
                      </strong>

                      <span className="dd-muted">
                        {prescription.diagnosis}
                      </span>

                      <span className="dd-muted">
                        {formatDate(prescription.createdAt)} ·{" "}
                        {prescription.medicines?.length || 0} medicine
                        {prescription.medicines?.length === 1 ? "" : "s"}
                      </span>
                    </div>

                    <div className="dd-row-actions">
                      <button
                        onClick={() =>
                          navigate(`/prescription/${prescription.requestId}`)
                        }
                      >
                        Open
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* ---------- HISTORY ---------- */}

        {section === "history" && (
          <section className="dd-card">
            {historyItems.length === 0 ? (
              <Empty>
                No past consultations yet. Completed and declined
                consultations appear here.
              </Empty>
            ) : (
              <ul className="dd-list">
                {historyItems.map((consultation) => (
                  <ConsultationRow
                    key={consultation.id}
                    consultation={consultation}
                    action={
                      consultation.status === "completed" ? (
                        <button
                          className="dd-secondary"
                          onClick={() =>
                            navigate(`/prescription/${consultation.id}`)
                          }
                        >
                          View Prescription
                        </button>
                      ) : null
                    }
                  />
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

export default DoctorDashboard;
