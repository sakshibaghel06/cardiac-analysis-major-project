import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  STATUS,
  acceptConsultation,
  rejectConsultation,
  getConsultationRequest,
  isJoinable,
  joinLabel,
  normaliseStatus,
  statusHelp,
  statusLabel,
} from "../services/consultationService";

function DoctorRequest() {
  const { requestId } = useParams();
  const navigate = useNavigate();

  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [actionError, setActionError] = useState("");

  // =====================================================
  // LOAD CONSULTATION REQUEST
  // =====================================================

  useEffect(() => {
    const loadRequest = async () => {
      try {
        if (!requestId) {
          console.error("No request ID found");
          return;
        }

        /*
          getConsultationRequest lowercases the status on the way
          out. Some existing records were saved as "PENDING", and
          the accept/reject buttons below only render for
          status === "pending", so without this those requests
          could never be actioned.
        */
        const data = await getConsultationRequest(requestId);

        if (!data) {
          console.error("Consultation request not found");

          setRequest(null);
          return;
        }

        setRequest(data);

      } catch (error) {
        console.error(
          "Error loading consultation request:",
          error
        );
      } finally {
        setLoading(false);
      }
    };

    loadRequest();
  }, [requestId]);


  // =====================================================
  // UPDATE REQUEST STATUS
  // =====================================================

  /*
    `nextStatus` is the status the doctor is MOVING TO. It used to be
    called `status`, which shadowed the render-scope `status` holding
    the stored value - the two mean opposite things, and a parameter
    that silently hides the stored status is how the in_progress bug
    went unnoticed for so long.
  */
  const updateRequestStatus = async (nextStatus) => {
  try {
    if (!requestId) {
      return;
    }

    setUpdating(true);
    setActionError("");

    /*
      Accepting also creates the care link that grants this doctor
      read access to the patient's profile and assessment history.
      Without it the security rules have no way to tell this doctor
      apart from any other, so the patient's records stay closed.

      Rejecting removes that link again.
    */
    if (nextStatus === STATUS.ACCEPTED) {
      await acceptConsultation(requestId);
    } else {
      await rejectConsultation(requestId);
    }

    setRequest((previous) => ({
      ...previous,
      status: nextStatus,
    }));

    if (nextStatus === STATUS.ACCEPTED) {
      /*
        Do NOT jump straight into the call. The patient has to be
        told the request was accepted and join from their own
        screen; sending the doctor into an empty room first was
        what made the old flow feel broken.
      */
      navigate("/doctor/dashboard");

      return;
    }

    navigate("/doctor/dashboard");

  } catch (error) {
    /*
      The real Firebase error code, so a permission problem is
      distinguishable from a network one. Deliberately logs the
      code and the consultation id ONLY - never the patient's
      health data, name or email.
    */
    console.error("Consultation update failed", {
      requestId,
      attemptedStatus: nextStatus,
      code: error?.code || "none",
      message: error?.message,
    });

    /*
      A safe, specific message. "Unable to update the consultation
      request" told the doctor nothing and hid which of the three
      writes had actually failed.
    */
    const friendly =
      error?.code === "permission-denied"
        ? /*
             Name the step and the code. One generic sentence for three
             different writes made this impossible to diagnose from a
             screenshot - a care-link denial looked identical to a
             status denial.
           */
          `The database refused this change at the "${
            error?.step || "unknown"
          }" step (permission-denied). This usually means the deployed ` +
          "Firestore rules are older than the app. Deploy them with: " +
          "firebase deploy --only firestore:rules,firestore:indexes"
        : error?.code === "unavailable" ||
          error?.code === "deadline-exceeded"
        ? "Could not reach the server. Check your connection and try again."
        : error?.code === "not-found"
        ? "This consultation no longer exists."
        : error?.message ||
          "Could not update this consultation. Please try again.";

    setActionError(friendly);

  } finally {
    setUpdating(false);
  }
};


  // =====================================================
  // LOADING
  // =====================================================

  if (loading) {
    return (
      <div className="doctor-request-page">
        <div className="doctor-request-loading">
          Loading consultation request...
        </div>
      </div>
    );
  }


  // =====================================================
  // REQUEST NOT FOUND
  // =====================================================

  if (!request) {
    return (
      <div className="doctor-request-page">

        <div className="doctor-request-empty">

          <h2>
            Request Not Found
          </h2>

          <p>
            This consultation request could not
            be found.
          </p>

          <button
            onClick={() =>
              navigate("/doctor/dashboard")
            }
          >
            Back to Dashboard
          </button>

        </div>

      </div>
    );
  }


  // =====================================================
  // PATIENT DETAILS
  // =====================================================

  const patientName =
    request.patientName ||
    "Patient";

  const patientEmail =
    request.patientEmail ||
    "Not available";


  // =====================================================
  // DOCTOR DETAILS
  // =====================================================

  const doctorName =
    request.doctorName ||
    "Selected Doctor";


  // =====================================================
  // LOCATION DETAILS
  // =====================================================

  const city =
    request.city ||
    request.location ||
    "Not available";

  const hospital =
    request.hospitalName ||
    request.hospital?.name ||
    "Not available";


  // =====================================================
  // RISK
  // =====================================================

  const risk =
    request.risk ||
    request.riskLevel ||
    request.cardiacRisk ||
    "Not available";


  // =====================================================
  // REPORT
  // =====================================================

  /*
    IMPORTANT:

    The patient sends:

        report: report

    Therefore we read:

        request.report

    first.

    The extra fallbacks make this compatible with
    older requests that may have used assessment
    or prediction.
  */

  const report =
    request.report ||
    request.assessment ||
    request.prediction ||
    {};


  /*
    The report contains patient health data, so it is never logged.
    Which KEYS arrived is enough to diagnose a mapping problem.
  */
  if (import.meta.env.DEV) {
    console.debug("Consultation report keys:", Object.keys(report));
  }

  /*
    Requests created before the assessment snapshot was wired up
    carry an empty report. Saying so plainly is better than a grid
    of "Not provided", which looks like a loading failure.
  */
  const reportMissing = Object.keys(report).length === 0;


  // =====================================================
  // HELPER TO FIND REPORT VALUES
  // =====================================================

  const getReportValue = (
    ...keys
  ) => {

    /*
      Check directly inside report
    */

    for (const key of keys) {

      if (
        report[key] !== undefined &&
        report[key] !== null &&
        report[key] !== ""
      ) {
        return report[key];
      }

    }


    /*
      Some reports may be nested.
    */

    const nestedObjects = [
      report.data,
      report.input,
      report.inputs,
      report.assessment,
      report.prediction,
      report.result,
    ];


    for (const nested of nestedObjects) {

      if (!nested) {
        continue;
      }

      for (const key of keys) {

        if (
          nested[key] !== undefined &&
          nested[key] !== null &&
          nested[key] !== ""
        ) {
          return nested[key];
        }

      }

    }


    /*
      Genuinely absent, rather than a failed lookup. The brief asks
      for "Not provided" so a doctor can tell "the patient did not
      give us this" from "we could not load it".
    */
    return "Not provided";
  };


  // =====================================================
  // CARDIAC VALUES
  // =====================================================

  const age =
    getReportValue(
      // model feature name first, then legacy spellings
      "age",
      "Age"
    );


  const heartRate =
    getReportValue(
      // thalach is the model feature; the rest are legacy records
      "thalach",
      "heartRate",
      "heart_rate",
      "HeartRate",
      "Heart Rate",
      "pulse",
      "Pulse"
    );


  const bloodPressure =
    getReportValue(
      "trestbps",
      "bloodPressure",
      "blood_pressure",
      "BloodPressure",
      "Blood Pressure",
      "bp"
    );


  const cholesterol =
    getReportValue(
      "chol",
      "cholesterol",
      "Cholesterol"
    );


  const ecg =
    getReportValue(
      "restecg",
      "ecg",
      "ECG",
      "ecgResult",
      "ecg_result"
    );


  const exerciseAngina =
    getReportValue(
      "exang",
      "exerciseAngina",
      "exercise_angina",
      "ExerciseAngina",
      "Exercise Angina"
    );


  const status = normaliseStatus(request.status);

  /*
    The doctor's own join button had the same defect as the
    patient's: gated on status === "accepted", it vanished as soon
    as the doctor joined and the consultation became "in_progress".
    A doctor who navigated back here mid-call could not get back in.

    isJoinable covers both states for both roles, so the two
    dashboards agree about the same stored status.
  */
  const canJoin = isJoinable(status);

  const live = status === STATUS.IN_PROGRESS;


  // =====================================================
  // UI
  // =====================================================

  return (
    <div className="doctor-request-page">

      {/* =================================================
          HEADER
      ================================================= */}

      <div className="doctor-request-header">

        <div>

          <span className="doctor-request-label">
            PATIENT CONSULTATION
          </span>

          <h1>
            Consultation Request
          </h1>

          <p>
            Review the patient's cardiac
            assessment before responding to
            the consultation request.
          </p>

        </div>


        <button
          className="doctor-request-back"
          onClick={() =>
            navigate("/doctor/dashboard")
          }
        >
          ← Back to Dashboard
        </button>

      </div>


      {/* =================================================
          STATUS
      ================================================= */}

      <div
        className={`doctor-request-status ${status}`}
      >

        <div>

          <span>
            CONSULTATION STATUS
          </span>

          <h2>
            {statusLabel(status).toUpperCase()}
          </h2>

        </div>

        <p>

          {status === STATUS.PENDING
            ? "This request is waiting for your review."
            : canJoin
            ? statusHelp(status)
            : statusHelp(status)}

        </p>

      </div>


      {/* =================================================
          PATIENT INFORMATION
      ================================================= */}

      <div className="doctor-request-card">

        <div className="doctor-request-section-title">

          <div className="doctor-request-number">
            01
          </div>

          <div>

            <h2>
              Patient Information
            </h2>

            <p>
              Patient details associated with
              this consultation request.
            </p>

          </div>

        </div>


        {/* PATIENT PROFILE */}

        <div className="doctor-patient-profile">

          <div className="doctor-patient-avatar">

            {patientName
              .charAt(0)
              .toUpperCase()}

          </div>

          <div>

            <h3>
              {patientName}
            </h3>

            <span>
              {patientEmail}
            </span>

          </div>

        </div>


        {/* LOCATION */}

        <div className="doctor-info-grid">

          <div>

            <span>
              City
            </span>

            <strong>
              {city}
            </strong>

          </div>


          <div>

            <span>
              Hospital
            </span>

            <strong>
              {hospital}
            </strong>

          </div>


          <div>

            <span>
              Doctor
            </span>

            <strong>
              {doctorName}
            </strong>

          </div>

        </div>

      </div>


      {/* =================================================
          CARDIAC ASSESSMENT
      ================================================= */}

      <div className="doctor-request-card">

        <div className="doctor-request-section-title">

          <div className="doctor-request-number">
            02
          </div>

          <div>

            <h2>
              Cardiac Assessment
            </h2>

            <p>
              AI-generated assessment attached
              to the patient's request.
            </p>

          </div>

        </div>


        {/* RISK */}

        <div className="doctor-risk-box">

          <div>

            <span>
              CURRENT CARDIAC RISK
            </span>

            <h2>
              {String(risk).toUpperCase()}
            </h2>

          </div>

          <p>
            Review the assessment values before
            accepting the consultation.
          </p>

        </div>


        {/* ASSESSMENT VALUES */}

        {reportMissing && (
          <div className="doctor-report-missing" role="status">
            <strong>No assessment values were saved with this request.</strong>

            <p>
              This consultation was created before the assessment
              snapshot was captured, so there is nothing to display
              here. Ask the patient to complete a new assessment, or
              accept the request and review their history.
            </p>
          </div>
        )}

        <div className="doctor-assessment-grid">

          <div>

            <span>
              Age
            </span>

            <strong>
              {age}
            </strong>

          </div>


          <div>

            <span>
              Heart Rate
            </span>

            <strong>

              {heartRate}

              {heartRate !== "Not provided"
                ? " bpm"
                : ""}

            </strong>

          </div>


          <div>

            <span>
              Blood Pressure
            </span>

            <strong>
              {bloodPressure}
            </strong>

          </div>


          <div>

            <span>
              Cholesterol
            </span>

            <strong>
              {cholesterol}
            </strong>

          </div>


          <div>

            <span>
              ECG
            </span>

            <strong>
              {ecg}
            </strong>

          </div>


          <div>

            <span>
              Exercise Angina
            </span>

            <strong>
              {exerciseAngina}
            </strong>

          </div>

        </div>

      </div>


      {/* =================================================
          ACTIONS
      ================================================= */}

      {/* =================================================
    ACTIONS
================================================= */}

{status === STATUS.PENDING && (
  <div className="doctor-request-actions">

    <div className="doctor-action-text">

      <span className="doctor-request-label">
        REVIEW REQUEST
      </span>

      <h3>
        Respond to Consultation
      </h3>

      <p>
        Review the patient's cardiac assessment
        and choose whether to accept or reject
        this consultation.
      </p>

    </div>

    {/*
      The real reason, not a generic "unable to update". The
      console carries the Firebase error code alongside it for
      diagnosis - without any patient health data.
    */}
    {actionError && (
      <div className="doctor-action-error" role="alert">
        {actionError}
      </div>
    )}

    <div className="doctor-action-buttons">

      {/* REJECT */}

      <button
        type="button"
        className="doctor-reject-btn"
        disabled={updating}
        onClick={() =>
          updateRequestStatus(STATUS.REJECTED)
        }
      >
        Reject Request
      </button>


      {/* ACCEPT */}

      <button
        type="button"
        className="doctor-accept-btn"
        disabled={updating}
        onClick={() =>
          updateRequestStatus(STATUS.ACCEPTED)
        }
      >
        {updating
          ? "Updating..."
          : "Accept Consultation"}
      </button>

    </div>

  </div>
)}


{/* =================================================
    ACCEPTED → VIDEO CONSULTATION
================================================= */}

{canJoin && (
  <div className="video-ready-card">

    <div>

      <span className="video-ready-label">
        {live ? "CONSULTATION IN PROGRESS" : "CONSULTATION ACCEPTED"}
      </span>

      <h2>
        {live
          ? "This consultation is still open"
          : "Patient consultation is ready"}
      </h2>

      <p>
        {live
          ? `This consultation is already in progress. Rejoin if you
             were disconnected.`
          : `You have accepted this patient's consultation request.
             You can now join the secure video consultation.`}
      </p>

    </div>

    <button
      type="button"
      className="video-ready-button"
      onClick={() =>
        navigate(
          `/video-consultation/${requestId}`
        )
      }
    >
      {joinLabel(status)}
    </button>

  </div>
)}

    </div>
  );
}

export default DoctorRequest;