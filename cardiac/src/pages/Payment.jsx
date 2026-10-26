import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { useAuth } from "../context/useAuth";

import { PRESCRIPTION_STATE, watchConsultation } from "../services/consultationService";

import {
  DEMO_PAYMENT_FEE,
  downloadDemoReceipt,
  getDemoPaymentSnapshot,
  parseDemoPayment,
  payForConsultation,
  subscribeDemoPayments,
} from "../services/paymentService";

/*
=====================================================
PAYMENT
=====================================================

Where the patient lands when the video call ends.

Three honest states, driven by a LIVE listener on the
consultation so none of them needs a refresh:

  waiting   the doctor has not issued the prescription
            yet. No fee is requested, because there is
            nothing to unlock. It never pretends the
            prescription is ready.

  due       issued, unpaid. Fee summary and demo payment.

  paid      local demo receipt. The Firestore prescription
            remains subject to its existing access rules.

The demo amount is fixed at ₹500.

Emergency help is reachable from here regardless of
payment. Nothing about money may stand between a patient
and urgent care.
=====================================================
*/

function Payment() {
  const { requestId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();

  const routeConsultation =
    location.state?.consultation?.id === requestId &&
    location.state.consultation.patientId === user?.uid
      ? location.state.consultation
      : null;

  const [consultation, setConsultation] = useState(routeConsultation);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadNotice, setLoadNotice] = useState("");
  const storedPayment = useSyncExternalStore(
    subscribeDemoPayments,
    () => getDemoPaymentSnapshot(requestId),
    () => null
  );
  let demoPayment = null;
  let paymentStorageError = "";
  try {
    demoPayment = parseDemoPayment(storedPayment, requestId);
  } catch (storageError) {
    paymentStorageError = storageError.message;
  }

  // ---------------------------------------------------
  // LIVE CONSULTATION
  // ---------------------------------------------------

  useEffect(() => {
    if (authLoading || !user) return undefined;

    const unsubscribe = watchConsultation(
      requestId,
      (record) => {
        if (!record) {
          setError("This consultation could not be found.");
          setLoading(false);
          return;
        }

        if (record.patientId !== user.uid) {
          setError("This consultation does not belong to you.");
          setConsultation(null);
          setLoading(false);
          return;
        }

        setConsultation(record);
        setLoading(false);
      },
      (watchError) => {
        console.error(watchError);

        if (routeConsultation) {
          setConsultation(routeConsultation);
        } else {
          setConsultation({ id: requestId });
        }
        setLoadNotice(
          "Consultation details could not be loaded from Firebase. This local demo can still record payment for this reference; unavailable doctor details will not be invented."
        );
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [authLoading, user, requestId, location.state, routeConsultation]);

  // ---------------------------------------------------
  // PAY
  // ---------------------------------------------------

  const pay = async () => {
    setError("");

    try {
      setBusy(true);

      await payForConsultation({ requestId, consultation });
    } catch (payError) {
      console.error(payError);
      setError(payError.message);
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------
  // STATES
  // ---------------------------------------------------

  if (authLoading || loading) {
    return (
      <div className="pay-page">
        <div className="pay-shell">
          <p className="pay-loading">Loading...</p>
        </div>
      </div>
    );
  }

  if (error && !consultation) {
    return (
      <div className="pay-page">
        <div className="pay-shell">
          <div className="pay-card">
            <h1>Payment</h1>

            <div className="pay-error" role="alert">
              {error}
            </div>

            <button
              className="pay-secondary"
              onClick={() => navigate("/patient/dashboard")}
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  const fee = DEMO_PAYMENT_FEE;
  const paid =
    consultation?.paymentStatus === "paid" || demoPayment?.status === "PAID";
  const demoPaid = demoPayment?.status === "PAID";
  const prescriptionIssued =
    consultation?.prescriptionStatus === PRESCRIPTION_STATE.ISSUED ||
    !consultation?.prescriptionStatus;

  return (
    <div className="pay-page">
      <div className="pay-shell">
        <header className="pay-header">
          <span className="pay-eyebrow">CONSULTATION COMPLETE</span>

          <h1>
            {paid
              ? demoPaid
                ? "Demo Payment Successful!"
                : "Payment received"
              : prescriptionIssued
              ? "Your prescription is ready"
              : "Thank you for your consultation"}
          </h1>
        </header>

        {loadNotice && (
          <div className="pay-muted" role="status">
            {loadNotice}
          </div>
        )}

        {/* ==========================================
            PAID
        ========================================== */}

        {paid && (
          <div className="pay-card pay-done">
            <div className="pay-icon" aria-hidden="true">
              ✓
            </div>

            <h2>
              {demoPaid
                ? "Payment Successful!"
                : "Payment complete"}
            </h2>

            <p>
              {demoPaid
                ? "No real money was charged. The PAID status is local to this browser and is not synchronized with Firebase."
                : "The consultation is marked paid in Firebase."}
            </p>

            {demoPaid && (
              <>
                <dl className="pay-summary">
                  <div>
                    <dt>Consultation reference</dt>
                    <dd className="pay-ref">{requestId}</dd>
                  </div>
                  <div>
                    <dt>Fee</dt>
                    <dd>₹{DEMO_PAYMENT_FEE}</dd>
                  </div>
                  <div>
                    <dt>Paid at</dt>
                    <dd>{new Date(demoPayment.paidAt).toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Demo transaction reference</dt>
                    <dd>{demoPayment.transactionReference}</dd>
                  </div>
                </dl>
                <div className="pay-demo-notice" role="note">
                  DEMO PAYMENT — No real money will be charged. This status
                  is stored only in this browser and is not synchronized with
                  Firebase.
                </div>
                <p className="pay-fineprint">
                  Prescription contents remain protected by Firebase
                  permissions. If the prescription record is unavailable,
                  the prescription page will say so rather than invent details.
                </p>
                <button
                  className="pay-secondary"
                  onClick={() => downloadDemoReceipt(demoPayment)}
                >
                  Download Receipt
                </button>
              </>
            )}

            <button
              className="pay-primary"
              onClick={() =>
                navigate(`/prescription/${requestId}`, {
                  state: { consultation },
                })
              }
            >
              View &amp; Download Prescription
            </button>

            <button
              className="pay-secondary"
              onClick={() => navigate("/consultations")}
            >
              My Consultations
            </button>
          </div>
        )}

        {/* ==========================================
            WAITING  -  nothing to pay for yet
        ========================================== */}

        {!paid && !prescriptionIssued && (
          <div className="pay-card pay-waiting">
            <div className="pay-icon" aria-hidden="true">
              ◷
            </div>

            <h2>Waiting for your doctor to issue the prescription</h2>

            <p>
              Your consultation with{" "}
              <strong>{consultation?.doctorName || "your doctor"}</strong> is
              complete. They are writing up your prescription now.
            </p>

            <p className="pay-muted">
              This page updates on its own - you do not need to refresh it,
              and you are welcome to leave and come back. We will show it on
              your dashboard as soon as it is ready.
            </p>

            {fee > 0 && (
              <p className="pay-muted">
                A consultation fee of <strong>₹{fee}</strong> will be payable
                once your prescription is issued.
              </p>
            )}

            <button
              className="pay-secondary"
              onClick={() => navigate("/patient/dashboard")}
            >
              Back to Dashboard
            </button>
          </div>
        )}

        {/* ==========================================
            DUE
        ========================================== */}

        {!paid && prescriptionIssued && (
          <>
            <div className="pay-card">
              <h2>Consultation summary</h2>

              <dl className="pay-summary">
                <div>
                  <dt>Doctor</dt>
                  <dd>{consultation?.doctorName || "Not available"}</dd>
                </div>

                <div>
                  <dt>Hospital</dt>
                  <dd>{consultation?.hospitalName || "Not available"}</dd>
                </div>

                <div>
                  <dt>Consultation reference</dt>
                  <dd className="pay-ref">{requestId}</dd>
                </div>

                <div>
                  <dt>Date</dt>
                  <dd>
                    {consultation?.completedAt?.toDate
                      ? consultation.completedAt.toDate().toLocaleDateString()
                      : consultation?.createdAt?.toDate
                      ? consultation.createdAt.toDate().toLocaleDateString()
                      : "Not available"}
                  </dd>
                </div>
              </dl>
              <div className="pay-total">
                <div className="pay-total-row">
                  <span>Consultation fee</span>
                  <span>₹{fee}</span>
                </div>

                <div className="pay-total-row pay-total-final">
                  <span>Total payable</span>
                  <span>₹{fee}</span>
                </div>
              </div>
            </div>

            <div className="pay-card">
              <h2>Pay to Unlock Your Prescription</h2>

              <p className="pay-muted">
                Record a demo payment in this browser. This does not update
                Firebase or change prescription permissions.
              </p>

              <div className="pay-demo-notice" role="status">
                <strong>DEMO PAYMENT</strong> — No real money will be charged.
              </div>

              {(error || paymentStorageError) && (
                <div className="pay-error" role="alert">
                  {error || paymentStorageError}
                </div>
              )}

              <button
                className="pay-primary"
                onClick={pay}
                disabled={busy}
                aria-busy={busy}
              >
                {busy ? (
                  <>
                    <span className="pay-spinner" aria-hidden="true" />
                    Processing demo payment...
                  </>
                ) : (
                  `Pay ₹${fee} & Unlock Prescription`
                )}
              </button>

              <button
                className="pay-secondary"
                onClick={() => navigate("/patient/dashboard")}
                disabled={busy}
              >
                Pay Later
              </button>

              <p className="pay-fineprint">
                Pay Later does not mark this browser as paid. Prescription
                access remains subject to Firebase's existing rules.
              </p>
            </div>
          </>
        )}

        {/* ==========================================
            EMERGENCY  -  never behind payment
        ========================================== */}

        <div className="pay-emergency">
          <div>
            <strong>Feeling unwell right now?</strong>

            <p>
              Urgent help is never behind a payment. If you have severe chest
              pain, trouble breathing or fainting, get medical help
              immediately.
            </p>
          </div>

          <button onClick={() => navigate("/emergency")}>
            Emergency Help
          </button>
        </div>
      </div>
    </div>
  );
}

export default Payment;
