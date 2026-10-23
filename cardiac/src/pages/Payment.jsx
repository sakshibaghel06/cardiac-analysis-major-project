import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useAuth } from "../context/useAuth";

import {
  PRESCRIPTION_STATE,
  watchConsultation,
} from "../services/consultationService";

import {
  getPaymentConfig,
  payForConsultation,
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

  due       issued, unpaid. Fee summary and Razorpay.

  paid      unlocked. Straight through to the
            prescription.

The amount shown comes from the consultation record, and
the server re-checks it against the same record before
creating an order - a price in the browser is a
suggestion, not a fact.

Emergency help is reachable from here regardless of
payment. Nothing about money may stand between a patient
and urgent care.
=====================================================
*/

function Payment() {
  const { requestId } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [consultation, setConsultation] = useState(null);
  const [config, setConfig] = useState(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cancelled, setCancelled] = useState(false);

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

        setError(
          watchError?.code === "permission-denied"
            ? "You do not have access to this consultation."
            : "Could not load this consultation. Please try again."
        );

        setLoading(false);
      }
    );

    return unsubscribe;
  }, [authLoading, user, requestId]);

  // ---------------------------------------------------
  // IS PAYMENT EVEN SET UP?
  // ---------------------------------------------------

  /*
    The await comes before any setState, so the effect body does
    not set state synchronously - which is what the cascading
    render rule is guarding against.
  */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const result = await getPaymentConfig();

      if (!cancelled) setConfig(result);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ---------------------------------------------------
  // PAY
  // ---------------------------------------------------

  const pay = async () => {
    setError("");
    setCancelled(false);

    try {
      setBusy(true);

      const result = await payForConsultation({
        requestId,
        doctorName: consultation.doctorName,
      });

      if (result.status === "cancelled") {
        setCancelled(true);
        return;
      }

      /*
        No local "paid" flag is set here. The listener above
        picks the change up only once the SERVER has verified
        the signature and written paymentStatus. A success
        callback in the browser proves nothing.
      */
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

  const fee = Number(consultation?.fee) || 0;
  const paid = consultation?.paymentStatus === "paid";
  const prescriptionIssued =
    consultation?.prescriptionStatus === PRESCRIPTION_STATE.ISSUED;

  return (
    <div className="pay-page">
      <div className="pay-shell">
        <header className="pay-header">
          <span className="pay-eyebrow">CONSULTATION COMPLETE</span>

          <h1>
            {paid
              ? "Payment received"
              : prescriptionIssued
              ? "Your prescription is ready"
              : "Thank you for your consultation"}
          </h1>
        </header>

        {/* ==========================================
            PAID
        ========================================== */}

        {paid && (
          <div className="pay-card pay-done">
            <div className="pay-icon" aria-hidden="true">
              ✓
            </div>

            <h2>Payment complete</h2>

            <p>
              Your consultation fee has been received and your prescription
              is unlocked.
            </p>

            <button
              className="pay-primary"
              onClick={() => navigate(`/prescription/${requestId}`)}
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
                  <dd>{consultation?.doctorName || "-"}</dd>
                </div>

                {consultation?.hospitalName && (
                  <div>
                    <dt>Hospital</dt>
                    <dd>{consultation.hospitalName}</dd>
                  </div>
                )}

                <div>
                  <dt>Consultation reference</dt>
                  <dd className="pay-ref">{requestId}</dd>
                </div>

                <div>
                  <dt>Date</dt>
                  <dd>
                    {consultation?.completedAt?.toDate
                      ? consultation.completedAt.toDate().toLocaleDateString()
                      : "-"}
                  </dd>
                </div>
              </dl>

              {/*
                Consultation fee only. No platform fee or tax line
                is shown, because none is configured - inventing a
                charge the project has not actually set up would be
                fabricating a number on an invoice.
              */}
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
              <h2>Pay to unlock your prescription</h2>

              {config && !config.configured ? (
                <div className="pay-notice" role="status">
                  <strong>Online payment is not set up on this server.</strong>

                  <p>
                    {config.unreachable
                      ? "The payment service could not be reached. Start the API, or try again shortly."
                      : "Razorpay test keys have not been configured. Your prescription cannot be unlocked until payment is available."}
                  </p>
                </div>
              ) : (
                <>
                  <p className="pay-muted">
                    You will be taken to Razorpay to pay by card, UPI, net
                    banking or wallet. CardioCare never sees or stores your
                    card details.
                  </p>

                  {config?.mode === "test" && (
                    <div className="pay-testmode">
                      <strong>Test mode</strong> - no real money will be
                      taken.
                    </div>
                  )}
                </>
              )}

              {cancelled && (
                <div className="pay-notice" role="status">
                  <strong>Payment cancelled.</strong>

                  <p>
                    Nothing has been charged, and your prescription is safe.
                    You can try again whenever you are ready.
                  </p>
                </div>
              )}

              {error && (
                <div className="pay-error" role="alert">
                  {error}
                </div>
              )}

              <button
                className="pay-primary"
                onClick={pay}
                disabled={busy || (config && !config.configured)}
              >
                {busy ? "Opening payment..." : `Pay ₹${fee} & Unlock Prescription`}
              </button>

              <button
                className="pay-secondary"
                onClick={() => navigate("/patient/dashboard")}
              >
                Pay Later
              </button>

              <p className="pay-fineprint">
                Your prescription has been issued and is stored safely. Paying
                later does not lose it.
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
