import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { useAuth } from "../context/useAuth";

import {
  EMPTY_MEDICINE,
  PRESCRIPTION_STATUS,
  getPrescriptionsForRequest,
  savePrescription,
  validatePrescription,
  watchPrescriptionsForRequest,
} from "../services/prescriptionService";

import {
  PRESCRIPTION_STATE,
  completeConsultation,
  getConsultationRequest,
  linkIssuedPrescription,
  setPrescriptionState,
} from "../services/consultationService";

import { downloadPrescriptionPdf } from "../services/prescriptionPdf";
import {
  getDemoPaymentSnapshot,
  parseDemoPayment,
  subscribeDemoPayments,
} from "../services/paymentService";

/*
=====================================================
PRESCRIPTION
=====================================================

Doctor  - writes it. Saves a draft, reviews, then
          explicitly issues.
Patient - sees it once it is issued AND the fee is
          settled. Before that they get an honest status,
          never a half-written draft.

Nothing here is generated. The risk model never suggests
a diagnosis or a medicine; every word is the doctor's.
=====================================================
*/

function Prescription() {
  const { requestId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, role, profile, loading: authLoading } = useAuth();

  const isDoctor = role === "doctor";

  const [request, setRequest] = useState(null);
  const [existing, setExisting] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [prescriptionLoadError, setPrescriptionLoadError] = useState("");
  const [flash, setFlash] = useState("");
  const storedPayment = useSyncExternalStore(
    subscribeDemoPayments,
    () => getDemoPaymentSnapshot(requestId),
    () => null
  );
  let localDemoPaid = false;
  let demoPaymentError = "";
  try {
    localDemoPaid = parseDemoPayment(storedPayment, requestId)?.status === "PAID";
  } catch (storageError) {
    demoPaymentError = storageError.message;
  }

  const [diagnosis, setDiagnosis] = useState("");
  const [notes, setNotes] = useState("");
  const [precautions, setPrecautions] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [medicines, setMedicines] = useState([{ ...EMPTY_MEDICINE }]);
  const [errors, setErrors] = useState({});
  const [draftId, setDraftId] = useState(null);

  const issued = existing.find((p) => p.status === PRESCRIPTION_STATUS.ISSUED);

  // ---------------------------------------------------
  // LOAD
  // ---------------------------------------------------

  const fetchAll = useCallback(async () => {
    let consultation;
    let consultationReadError;

    try {
      consultation = await getConsultationRequest(requestId);
    } catch (readError) {
      consultationReadError = readError;
      const routeConsultation = location.state?.consultation;
      if (
        routeConsultation?.id === requestId &&
        routeConsultation.patientId === user?.uid
      ) {
        consultation = routeConsultation;
      } else if (role === "patient" && localDemoPaid) {
        consultation = { id: requestId, patientId: user.uid };
      } else {
        throw new Error(
          "Consultation details could not be loaded from Firebase. Return to My Consultations and open this prescription from its record.",
          { cause: readError }
        );
      }
    }

    if (!consultation) throw new Error("This consultation could not be found.");

    const party =
      user &&
      (consultation.patientId === user.uid ||
        consultation.doctorId === user.uid);

    if (!party) {
      throw new Error("You are not a participant in this consultation.");
    }

    /*
      The role decides which ownership field constrains the
      query. Without it Firestore refuses the read outright -
      rules are not filters. See prescriptionService.
    */
    let prescriptions = [];
    let prescriptionReadError = null;
    try {
      prescriptions = await getPrescriptionsForRequest(requestId, role);
    } catch (readError) {
      prescriptionReadError = readError;
    }
    let linkedConsultation = consultation;

    if (
      role === "doctor" &&
      consultation.prescriptionStatus === PRESCRIPTION_STATE.ISSUED &&
      !consultation.prescriptionId
    ) {
      const issuedPrescriptions = prescriptions.filter(
        (prescription) =>
          prescription.status === PRESCRIPTION_STATUS.ISSUED
      );

      if (issuedPrescriptions.length === 1) {
        await linkIssuedPrescription(requestId, issuedPrescriptions[0].id);
        linkedConsultation = {
          ...consultation,
          prescriptionId: issuedPrescriptions[0].id,
        };
      }
    }

    return {
      consultation: linkedConsultation,
      prescriptions,
      prescriptionReadError,
      consultationReadError,
    };
  }, [requestId, user, role, location.state, localDemoPaid]);

  useEffect(() => {
    if (authLoading || !user || !role) return undefined;

    let cancelled = false;

    (async () => {
      try {
        const {
          consultation,
          prescriptions,
          prescriptionReadError,
          consultationReadError,
        } = await fetchAll();

        if (cancelled) return;

        setRequest(consultation);
        setExisting(prescriptions);
        if (prescriptionReadError) {
          console.error(prescriptionReadError);
          setPrescriptionLoadError(
            "The prescription record could not be loaded from Firebase. Your local demo payment does not change Firebase permissions or unlock the stored prescription."
          );
        } else if (consultationReadError) {
          setPrescriptionLoadError(
            consultation.patientId === user.uid &&
              location.state?.consultation?.id === requestId
              ? "Firebase consultation details could not be loaded. Showing the consultation details passed from My Consultations."
              : "Firebase consultation details could not be loaded. The local demo payment is visible, but it does not provide or unlock consultation or prescription records."
          );
        }

        // Reopen an unfinished draft rather than starting blank.
        const openDraft = prescriptions.find(
          (p) => p.status === PRESCRIPTION_STATUS.DRAFT
        );

        if (openDraft) {
          setDraftId(openDraft.id);
          setDiagnosis(openDraft.diagnosis || "");
          setNotes(openDraft.notes || "");
          setPrecautions(openDraft.precautions || "");
          setFollowUp(openDraft.followUp || "");
          setMedicines(
            openDraft.medicines?.length
              ? openDraft.medicines
              : [{ ...EMPTY_MEDICINE }]
          );
        }
      } catch (loadError) {
        if (cancelled) return;

        console.error(loadError);

        setError(
          loadError?.code === "permission-denied"
            ? "You do not have permission to view this prescription."
            : loadError.message || "Could not load this prescription."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    authLoading,
    user,
    role,
    fetchAll,
    requestId,
    location.state?.consultation?.id,
  ]);

  /*
    Live updates, so a patient sitting on this page sees the
    prescription the moment the doctor issues it rather than
    having to refresh.
  */
  useEffect(() => {
    if (authLoading || !user || !role) return undefined;

    return watchPrescriptionsForRequest(
      requestId,
      role,
      (items) => setExisting(items),
      (watchError) => {
        console.warn("Prescription listener:", watchError.code || watchError);
        setPrescriptionLoadError(
          "The prescription record could not be loaded from Firebase. Your local demo payment does not change Firebase permissions or unlock the stored prescription."
        );
      }
    );
  }, [authLoading, user, role, requestId]);

  // ---------------------------------------------------
  // MEDICINE ROWS
  // ---------------------------------------------------

  const updateMedicine = (index, field, value) =>
    setMedicines((previous) =>
      previous.map((medicine, i) =>
        i === index ? { ...medicine, [field]: value } : medicine
      )
    );

  const addMedicine = () =>
    setMedicines((previous) => [...previous, { ...EMPTY_MEDICINE }]);

  const removeMedicine = (index) =>
    setMedicines((previous) =>
      previous.length === 1
        ? [{ ...EMPTY_MEDICINE }]
        : previous.filter((_, i) => i !== index)
    );

  // ---------------------------------------------------
  // SAVE  /  ISSUE
  // ---------------------------------------------------

  const persist = async (issue) => {
    const found = validatePrescription({ medicines, diagnosis });

    setErrors(found);

    if (Object.keys(found).length > 0) {
      setError("Please complete the highlighted fields.");
      return;
    }

    const count = medicines.filter((m) =>
      Object.values(m).some((v) => v && v.trim())
    ).length;

    if (issue) {
      const confirmed = window.confirm(
        `Issue this prescription to ${request.patientName || "the patient"}?` +
          `\n\n${count} medicine${count === 1 ? "" : "s"} will be recorded.` +
          "\n\nOnce issued it cannot be edited - a correction has to go out " +
          "as a new prescription. The consultation will be marked completed."
      );

      if (!confirmed) return;
    }

    try {
      setSaving(true);
      setError("");

      const id = await savePrescription({
        prescriptionId: draftId,
        requestId,
        patientId: request.patientId,
        patientName: request.patientName,
        medicines,
        diagnosis,
        notes,
        precautions,
        followUp,
        doctorProfile: profile,
        issue,
      });

      setDraftId(id);

      if (issue) {
        await completeConsultation(requestId, PRESCRIPTION_STATE.ISSUED, id);
        setFlash("Prescription issued. Your patient can now see it.");
      } else {
        await setPrescriptionState(requestId, PRESCRIPTION_STATE.DRAFT);
        setFlash("Draft saved. Only you can see it until you issue it.");
      }

      const refreshed = await fetchAll();
      setRequest(refreshed.consultation);
      setExisting(refreshed.prescriptions);
    } catch (saveError) {
      console.error(saveError);

      setError(
        saveError?.code === "permission-denied"
          ? "You are not allowed to write a prescription for this consultation."
          : saveError.message || "Could not save. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------
  // STATES
  // ---------------------------------------------------

  if (authLoading || loading) {
    return (
      <div className="rx-page">
        <div className="rx-card">
          <p className="rx-muted">Loading prescription...</p>
        </div>
      </div>
    );
  }

  if (error && !request) {
    return (
      <div className="rx-page">
        <div className="rx-card">
          <h1>Prescription</h1>

          <div className="rx-error" role="alert">
            {error}
          </div>

          <button className="rx-secondary" onClick={() => navigate(-1)}>
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const paid =
    request?.paymentStatus === "paid" ||
    (role === "patient" && localDemoPaid);
  const feeDue = Number(request?.fee) > 0;
  const issuedButLocked =
    !isDoctor &&
    !issued &&
    !paid &&
    request?.prescriptionStatus === PRESCRIPTION_STATE.ISSUED;

  return (
    <div className="rx-page">
      <div className="rx-card">
        <header className="rx-header">
          <span className="rx-eyebrow">CARDIOCARE</span>

          <h1>{isDoctor ? "Write Prescription" : "Your Prescription"}</h1>

          {request && (
            <p>
              {isDoctor
                ? `Patient: ${request.patientName || request.patientEmail}`
                : `Doctor: ${request.doctorName || request.doctorEmail}`}
              {request.createdAt?.toDate
                ? ` · ${request.createdAt.toDate().toLocaleDateString()}`
                : ""}
            </p>
          )}
        </header>

        {flash && (
          <div className="rx-success" role="status">
            {flash}
          </div>
        )}

        {(prescriptionLoadError || demoPaymentError) && (
          <div className="rx-error" role="status">
            {prescriptionLoadError || demoPaymentError}
          </div>
        )}

        {/* ==========================================
            ISSUED  -  visible to the doctor always,
            to the patient once paid
        ========================================== */}

        {issued && (
          <article className="rx-issued">
            <div className="rx-issued-head">
              <strong>Diagnosis / clinical assessment</strong>

              <time>
                {issued.issuedAt?.toDate
                  ? issued.issuedAt.toDate().toLocaleString()
                  : ""}
              </time>
            </div>

            <p className="rx-diagnosis">{issued.diagnosis}</p>

            {issued.medicines?.length > 0 ? (
              <div className="rx-table-wrap">
                <table className="rx-table">
                  <thead>
                    <tr>
                      <th>Medicine</th>
                      <th>Dosage</th>
                      <th>Frequency</th>
                      <th>Duration</th>
                      <th>Instructions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {issued.medicines.map((medicine, index) => (
                      <tr key={index}>
                        <td>{medicine.name}</td>
                        <td>{medicine.dosage}</td>
                        <td>{medicine.frequency}</td>
                        <td>{medicine.duration}</td>
                        <td>{medicine.instructions || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rx-muted">No medicines were prescribed.</p>
            )}

            {issued.precautions && (
              <>
                <strong>Precautions</strong>
                <p className="rx-notes">{issued.precautions}</p>
              </>
            )}

            {issued.notes && (
              <>
                <strong>Additional notes</strong>
                <p className="rx-notes">{issued.notes}</p>
              </>
            )}

            {issued.followUp && (
              <>
                <strong>Follow-up</strong>
                <p className="rx-notes">{issued.followUp}</p>
              </>
            )}

            <footer className="rx-issued-foot">
              <span>
                Issued by {issued.doctorName || issued.doctorEmail} via
                CardioCare. This reproduces exactly what the doctor submitted.
              </span>

              <button
                type="button"
                className="rx-download"
                onClick={() =>
                  downloadPrescriptionPdf({
                    prescription: issued,
                    consultation: request,
                  })
                }
              >
                Download PDF
              </button>
            </footer>
          </article>
        )}

        {/* ==========================================
            PATIENT  -  issued but not yet paid for
        ========================================== */}

        {issuedButLocked && (
          <div className="rx-locked">
            <div className="rx-locked-icon" aria-hidden="true">
              ✓
            </div>

            <h2>Your prescription is ready</h2>

            <p>
              Your doctor has issued your prescription. Settle the
              consultation fee to view and download it.
            </p>

            <button
              className="rx-pay"
              onClick={() => navigate(`/payment/${requestId}`)}
            >
              Pay &amp; Unlock Prescription
            </button>

            <button
              className="rx-secondary"
              onClick={() => navigate("/patient/dashboard")}
            >
              Back to Dashboard
            </button>
          </div>
        )}

        {!isDoctor && paid && !issued && (
          <div className="rx-locked">
            <h2>Demo payment status: PAID</h2>
            {localDemoPaid && (
              <p>
                This payment is stored only in this browser. It does not
                update Firebase or change its prescription access rules.
              </p>
            )}
            <p>
              {prescriptionLoadError ||
                "No unlocked prescription record was returned from Firebase. A local demo payment cannot unlock the stored prescription, so no prescription content is available to show here."}
            </p>
            <button
              className="rx-secondary"
              onClick={() => navigate("/consultations")}
            >
              Back to My Consultations
            </button>
          </div>
        )}

        {/* ==========================================
            PATIENT  -  nothing issued yet
        ========================================== */}

        {!isDoctor && !issued && !issuedButLocked && (
          <div className="rx-waiting">
            <div className="rx-waiting-icon" aria-hidden="true">
              ◷
            </div>

            <h2>
              {request?.prescriptionStatus === PRESCRIPTION_STATE.DRAFT
                ? "Your doctor is writing your prescription"
                : "Waiting for your doctor to issue the prescription"}
            </h2>

            <p>
              Your consultation is complete. Your doctor will issue your
              prescription shortly. This page updates on its own - there is
              no need to refresh it.
            </p>

            {feeDue && !paid && (
              <p className="rx-muted">
                Once it is issued you will be able to unlock and download it
                after settling the consultation fee.
              </p>
            )}

            <button
              className="rx-secondary"
              onClick={() => navigate("/patient/dashboard")}
            >
              Back to Dashboard
            </button>
          </div>
        )}

        {/* ==========================================
            DOCTOR  -  the writing form
        ========================================== */}

        {isDoctor && !issued && (
          <form
            className="rx-form"
            onSubmit={(event) => {
              event.preventDefault();
              persist(true);
            }}
            noValidate
          >
            <h2>{draftId ? "Continue your draft" : "Write the prescription"}</h2>

            <p className="rx-muted">
              Everything here is yours to decide. CardioCare never suggests a
              diagnosis or a medicine.
            </p>

            <label className="rx-field">
              <span>Diagnosis / clinical assessment</span>

              <textarea
                rows={3}
                value={diagnosis}
                onChange={(event) => setDiagnosis(event.target.value)}
                placeholder="Your clinical impression from this consultation"
                aria-invalid={Boolean(errors.diagnosis)}
              />

              {errors.diagnosis && (
                <em className="rx-field-error">{errors.diagnosis}</em>
              )}
            </label>

            <div className="rx-medicines">
              <div className="rx-medicines-head">
                <strong>Medicines</strong>

                <button type="button" className="rx-add" onClick={addMedicine}>
                  + Add medicine
                </button>
              </div>

              {medicines.map((medicine, index) => (
                <div key={index} className="rx-medicine-row">
                  {["name", "dosage", "frequency", "duration"].map((field) => (
                    <label key={field} className="rx-field">
                      <span>
                        {field.charAt(0).toUpperCase() + field.slice(1)}
                      </span>

                      <input
                        value={medicine[field]}
                        onChange={(event) =>
                          updateMedicine(index, field, event.target.value)
                        }
                        placeholder={
                          {
                            name: "e.g. Atorvastatin",
                            dosage: "e.g. 10 mg",
                            frequency: "e.g. once daily",
                            duration: "e.g. 30 days",
                          }[field]
                        }
                        aria-invalid={Boolean(
                          errors.medicines?.[index]?.[field]
                        )}
                      />

                      {errors.medicines?.[index]?.[field] && (
                        <em className="rx-field-error">
                          {errors.medicines[index][field]}
                        </em>
                      )}
                    </label>
                  ))}

                  <label className="rx-field rx-field-wide">
                    <span>Instructions</span>

                    <input
                      value={medicine.instructions}
                      onChange={(event) =>
                        updateMedicine(index, "instructions", event.target.value)
                      }
                      placeholder="e.g. after food"
                    />
                  </label>

                  <button
                    type="button"
                    className="rx-remove"
                    onClick={() => removeMedicine(index)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <label className="rx-field">
              <span>Precautions (optional)</span>

              <textarea
                rows={2}
                value={precautions}
                onChange={(event) => setPrecautions(event.target.value)}
                placeholder="Anything the patient should avoid or watch for"
              />
            </label>

            <label className="rx-field">
              <span>Follow-up (optional)</span>

              <textarea
                rows={2}
                value={followUp}
                onChange={(event) => setFollowUp(event.target.value)}
                placeholder="e.g. Review in 4 weeks, or sooner if symptoms worsen"
              />
            </label>

            <label className="rx-field">
              <span>Additional notes (optional)</span>

              <textarea
                rows={2}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Anything else to record"
              />
            </label>

            {error && (
              <div className="rx-error" role="alert">
                {error}
              </div>
            )}

            <div className="rx-actions">
              <button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Issue Prescription"}
              </button>

              <button
                type="button"
                className="rx-secondary"
                onClick={() => persist(false)}
                disabled={saving}
              >
                Save Draft
              </button>

              <button
                type="button"
                className="rx-secondary"
                onClick={() => navigate("/doctor/dashboard")}
              >
                Back to Dashboard
              </button>
            </div>

            <p className="rx-fineprint">
              A draft is visible only to you. Issuing it records it
              permanently and makes it available to your patient.
            </p>
          </form>
        )}

        {isDoctor && issued && (
          <div className="rx-actions">
            <button
              className="rx-secondary"
              onClick={() => navigate("/doctor/dashboard")}
            >
              Back to Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default Prescription;
