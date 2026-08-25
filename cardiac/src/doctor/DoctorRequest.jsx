import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../firebase/firebase";

function DoctorRequest() {
  const { requestId } = useParams();
  const navigate = useNavigate();

  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

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

        const requestRef = doc(
          db,
          "consultation_requests",
          requestId
        );

        const snapshot = await getDoc(requestRef);

        if (!snapshot.exists()) {
          console.error(
            "Consultation request not found"
          );

          setRequest(null);
          return;
        }

        const data = snapshot.data();

        console.log(
          "FULL CONSULTATION REQUEST:",
          data
        );

        console.log(
          "REPORT FROM FIREBASE:",
          data.report
        );

        setRequest({
          id: snapshot.id,
          ...data,
        });

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

  const updateRequestStatus = async (status) => {
  try {
    if (!requestId) {
      return;
    }

    setUpdating(true);

    const requestRef = doc(
      db,
      "consultation_requests",
      requestId
    );

    await updateDoc(requestRef, {
      status: status,
      respondedAt: serverTimestamp(),
    });

    setRequest((previous) => ({
      ...previous,
      status: status,
    }));

    if (status === "accepted") {
      alert("Consultation accepted successfully.");

      // Go directly to video consultation
      navigate(
        `/video-consultation/${requestId}?role=doctor`
      );

      return;
    }

    if (status === "rejected") {
      alert("Consultation rejected.");

      // Rejected → back to dashboard
      navigate("/doctor/dashboard");
    }

  } catch (error) {
    console.error(
      "Error updating consultation:",
      error
    );

    alert(
      "Unable to update the consultation request."
    );

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


  console.log(
    "Doctor page report:",
    report
  );


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


    return "Not available";
  };


  // =====================================================
  // CARDIAC VALUES
  // =====================================================

  const age =
    getReportValue(
      "age",
      "Age"
    );


  const heartRate =
    getReportValue(
      "heartRate",
      "heart_rate",
      "HeartRate",
      "Heart Rate",
      "pulse",
      "Pulse"
    );


  const bloodPressure =
    getReportValue(
      "bloodPressure",
      "blood_pressure",
      "BloodPressure",
      "Blood Pressure",
      "bp"
    );


  const cholesterol =
    getReportValue(
      "cholesterol",
      "Cholesterol"
    );


  const ecg =
    getReportValue(
      "ecg",
      "ECG",
      "ecgResult",
      "ecg_result"
    );


  const exerciseAngina =
    getReportValue(
      "exerciseAngina",
      "exercise_angina",
      "ExerciseAngina",
      "Exercise Angina"
    );


  const status =
    request.status ||
    "pending";


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
            {status.toUpperCase()}
          </h2>

        </div>

        <p>

          {status === "pending"
            ? "This request is waiting for your review."
            : status === "accepted"
            ? "You have accepted this consultation request."
            : "You have rejected this consultation request."}

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

              {heartRate !== "Not available"
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

{status === "pending" && (
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

    <div className="doctor-action-buttons">

      {/* REJECT */}

      <button
        type="button"
        className="doctor-reject-btn"
        disabled={updating}
        onClick={() =>
          updateRequestStatus("rejected")
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
          updateRequestStatus("accepted")
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

{status === "accepted" && (
  <div className="video-ready-card">

    <div>

      <span className="video-ready-label">
        CONSULTATION ACCEPTED
      </span>

      <h2>
        Patient consultation is ready
      </h2>

      <p>
        You have accepted this patient's
        consultation request. You can now
        join the secure video consultation.
      </p>

    </div>

    <button
      type="button"
      className="video-ready-button"
      onClick={() =>
        navigate(
          `/video-consultation/${requestId}?role=doctor`
        )
      }
    >
      Join Video Consultation
    </button>

  </div>
)}

    </div>
  );
}

export default DoctorRequest;