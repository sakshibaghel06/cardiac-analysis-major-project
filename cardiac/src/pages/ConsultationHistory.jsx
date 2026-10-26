import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../context/useAuth";

import {
  STATUS,
  cancelConsultation,
  getPatientConsultations,
  isJoinable,
  joinLabel,
  statusHelp,
  statusLabel,
} from "../services/consultationService";

import { getMyPrescriptions } from "../services/prescriptionService";
import { getDemoPayment } from "../services/paymentService";

/*
=====================================================
CONSULTATION HISTORY  (patient)
=====================================================

Every consultation this patient has ever requested, with
its live status, what they can do next, and any
prescription that came out of it.

This is also where Part 14's notifications live: rather
than adding push messaging, the status on each card IS
the notification - it updates the moment the doctor acts,
because the status is read straight from Firestore.
=====================================================
*/

/*
  Labels and help text come from consultationService, so this page
  cannot drift out of step with the status it is being handed - two
  local copies of these maps are exactly how the in_progress bug
  spread across screens.

  Only the lines this page says MORE than elsewhere are overridden.
  On the history page a finished consultation is also the place the
  fee gets settled and the prescription collected, which the generic
  wording has no reason to mention.
*/
const EXTRA_HELP = {
  [STATUS.COMPLETED]:
    "This consultation has finished. Your prescription is available, and " +
    "the consultation fee can now be paid.",
  [STATUS.IN_PROGRESS]:
    "Your consultation is under way. Rejoin the call if you were " +
    "disconnected.",
};

const helpFor = (status) => EXTRA_HELP[status] || statusHelp(status);

function ConsultationHistory() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [consultations, setConsultations] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  /*
    fetch() never touches state before its first await, so the
    effect below does not set state synchronously. `loading`
    already starts true, so the initial render needs no spinner
    toggle. refresh() is the manual version, which does.
  */
  const fetch = useCallback(async () => {
    const [myConsultations, myPrescriptions] = await Promise.all([
      getPatientConsultations(),
      getMyPrescriptions(),
    ]);

    return { myConsultations, myPrescriptions };
  }, []);

  const describe = (loadError) =>
    loadError?.code === "permission-denied"
      ? "You do not have permission to view these consultations."
      : "Could not load your consultations. Please try again.";

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const { myConsultations, myPrescriptions } = await fetch();

      setConsultations(myConsultations);
      setPrescriptions(myPrescriptions);
    } catch (loadError) {
      console.error(loadError);
      setError(describe(loadError));
    } finally {
      setLoading(false);
    }
  }, [fetch]);

  useEffect(() => {
    if (authLoading || !user) return undefined;

    let cancelled = false;

    (async () => {
      try {
        const { myConsultations, myPrescriptions } = await fetch();

        if (cancelled) return;

        setConsultations(myConsultations);
        setPrescriptions(myPrescriptions);
      } catch (loadError) {
        if (cancelled) return;

        console.error(loadError);
        setError(describe(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, fetch]);

  const prescriptionFor = (requestId) =>
    prescriptions.find(
      (prescription) => prescription.requestId === requestId
    );

  // ---------------------------------------------------
  // ACTIONS
  // ---------------------------------------------------

  const handleCancel = async (consultation) => {
    if (
      !window.confirm(
        "Cancel this consultation request? This cannot be undone."
      )
    ) {
      return;
    }

    try {
      setBusyId(consultation.id);
      await cancelConsultation(consultation.id);
      await refresh();
    } catch (cancelError) {
      console.error(cancelError);
      setError("Could not cancel this request. Please try again.");
    } finally {
      setBusyId(null);
    }
  };


  // ---------------------------------------------------
  // RENDER
  // ---------------------------------------------------

  if (authLoading || loading) {
    return (
      <div className="history-page">
        <div className="history-shell">
          <p>Loading your consultations...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="history-page">
      <div className="history-shell">
        <header className="history-header">
          <div>
            <span className="history-eyebrow">CARDIOCARE</span>
            <h1>My Consultations</h1>
            <p>Every consultation you have requested, and what happened next.</p>
          </div>

          <button
            className="history-secondary"
            onClick={() => navigate("/patient/dashboard")}
          >
            Back to Dashboard
          </button>
        </header>

        {error && (
          <div className="history-error" role="alert">
            {error}
          </div>
        )}

        {consultations.length === 0 ? (
          <div className="history-empty">
            <h2>No consultations yet</h2>

            <p>
              Complete a cardiac risk assessment, then choose a doctor to
              request your first consultation.
            </p>

            <button onClick={() => navigate("/risk")}>
              Start a Risk Assessment
            </button>
          </div>
        ) : (
          <ul className="history-list">
            {consultations.map((consultation) => {
              const status = consultation.status;
              const prescription = prescriptionFor(consultation.id);
              const busy = busyId === consultation.id;
              let localDemoPayment = null;
              try {
                localDemoPayment = getDemoPayment(consultation.id);
              } catch (storageError) {
                console.error("Could not read local demo payment:", storageError);
              }
              const localDemoPaid = localDemoPayment?.status === "PAID";
              const paid =
                consultation.paymentStatus === "paid" || localDemoPaid;
              const hasIssuedPrescription =
                consultation.prescriptionStatus === "issued";

              /*
                Payment is the LAST step:

                  accepted -> video call -> prescription -> payment

                So the fee is only requested once the consultation is
                completed, which is what issuing a prescription does.
                It never blocks the call.
              */
              const needsPayment =
                consultation.status === STATUS.COMPLETED &&
                !paid &&
                Number(consultation.fee) > 0;

              return (
                <li key={consultation.id} className="history-item">
                  <div className="history-item-main">
                    <div>
                      <h3>{consultation.doctorName || "Doctor"}</h3>

                      <p className="history-meta">
                        {[consultation.hospitalName, consultation.city]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>

                      <p className="history-meta">
                        Requested{" "}
                        {consultation.createdAt?.toDate
                          ? consultation.createdAt.toDate().toLocaleString()
                          : "recently"}
                      </p>
                    </div>

                    <div className="history-badges">
                      <span className={`history-status ${status}`}>
                        {statusLabel(status)}
                      </span>

                      {consultation.risk && (
                        <span
                          className={`history-risk risk-${String(
                            consultation.risk
                          ).toLowerCase()}`}
                        >
                          {consultation.risk} RISK
                        </span>
                      )}

                      {consultation.fee != null && (
                        <span
                          className={`history-payment ${
                            paid ? "paid" : "unpaid"
                          }`}
                        >
                          {localDemoPaid
                            ? "PAID · DEMO (this browser)"
                            : paid
                            ? "Paid"
                            : `₹${consultation.fee} due`}
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="history-help">{helpFor(status)}</p>
                  {localDemoPaid && (
                    <p className="history-help">
                      Demo payment is saved only in this browser; Firebase
                      payment status has not changed.
                    </p>
                  )}

                  <div className="history-actions">
                    {isJoinable(status) && (
                      <button
                        onClick={() =>
                          navigate(`/video-consultation/${consultation.id}`)
                        }
                      >
                        {joinLabel(status)}
                      </button>
                    )}

                    {/* Last step: settle the fee after the consultation. */}
                    {needsPayment && (
                      <button
                        onClick={() =>
                          navigate(`/payment/${consultation.id}`, {
                            state: { consultation },
                          })
                        }
                        disabled={busy}
                      >
                        {busy
                          ? "Opening payment..."
                          : `Pay ₹${consultation.fee}`}
                      </button>
                    )}

                    {status === STATUS.PENDING && (
                      <button
                        className="history-danger"
                        onClick={() => handleCancel(consultation)}
                        disabled={busy}
                      >
                        {busy ? "Cancelling..." : "Cancel Request"}
                      </button>
                    )}

                    {(prescription ||
                      (localDemoPaid && hasIssuedPrescription)) && (
                      <button
                        className="history-secondary"
                        onClick={() =>
                          navigate(`/prescription/${consultation.id}`, {
                            state: { consultation },
                          })
                        }
                      >
                        View Prescription
                      </button>
                    )}

                    {status === STATUS.REJECTED && (
                      <button
                        className="history-secondary"
                        onClick={() => navigate("/consult-doctor")}
                      >
                        Choose Another Doctor
                      </button>
                    )}

                    <button
                      className="history-secondary"
                      onClick={() =>
                        navigate(`/consultation-status/${consultation.id}`)
                      }
                    >
                      Details
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ConsultationHistory;
