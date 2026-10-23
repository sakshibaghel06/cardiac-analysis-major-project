import { useEffect, useState } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";

import {
  doc,
  onSnapshot,
} from "firebase/firestore";

import { db } from "../firebase/firebase";

import {
  STATUS,
  isJoinable,
  joinLabel,
  normaliseStatus,
  statusHelp,
  statusLabel,
} from "../services/consultationService";

function ConsultationStatus() {
  const location = useLocation();
  const navigate = useNavigate();
  const { requestId: urlRequestId } = useParams();

  // =====================================================
  // GET DATA FROM NAVIGATION
  // =====================================================

  /*
    risk used to default to the literal "MEDIUM" here, so opening
    this page directly displayed a fabricated risk level next to a
    real consultation. It now stays null until the actual value
    arrives from the consultation document below.
  */
  const {
    requestId: stateRequestId = "",
    risk = null,
    doctor: initialDoctor = {},
    hospital: initialHospital = {},
    city: initialCity = "",
  } = location.state || {};

  // =====================================================
  // REQUEST ID
  //
  // Prefer URL requestId.
  // Otherwise use navigation state requestId.
  // =====================================================

  const requestId =
    urlRequestId || stateRequestId;

  // =====================================================
  // STATE
  // =====================================================

  const [status, setStatus] =
    useState("pending");

  const [doctor, setDoctor] =
    useState(initialDoctor);

  const [hospital, setHospital] =
    useState(initialHospital);

  const [city, setCity] =
    useState(initialCity);

  const [currentRisk, setCurrentRisk] =
    useState(risk);

  const [requestData, setRequestData] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  // =====================================================
  // FIREBASE REAL-TIME LISTENER
  // =====================================================

  useEffect(() => {

    console.log(
      "================================="
    );

    console.log(
      "PATIENT CONSULTATION STATUS"
    );

    console.log(
      "REQUEST ID:",
      requestId
    );

    console.log(
      "================================="
    );

    /*
      A missing requestId means this route was reached with a bad
      URL. Returning early avoids a synchronous setState in the
      effect body; the render below already treats "no request"
      as the not-found state.
    */
    if (!requestId) {
      console.error("No consultation request id in the URL");

      return undefined;
    }

    const requestRef = doc(
      db,
      "consultation_requests",
      requestId
    );

    console.log(
      "LISTENING TO FIREBASE:",
      `consultation_requests/${requestId}`
    );

    const unsubscribe = onSnapshot(
      requestRef,

      (snapshot) => {

        if (!snapshot.exists()) {

          console.error(
            "CONSULTATION REQUEST NOT FOUND IN FIREBASE"
          );

          setLoading(false);

          return;
        }

        const data =
          snapshot.data();

        console.log(
          "================================="
        );

        console.log(
          "LIVE FIREBASE DATA:"
        );

        console.log(
          data
        );

        console.log(
          "CURRENT STATUS:",
          data.status
        );

        console.log(
          "================================="
        );

        setRequestData(data);

        // =================================================
        // STATUS
        // =================================================

        setStatus(
          data.status || "pending"
        );

        // =================================================
        // RISK
        // =================================================

        setCurrentRisk(
          data.risk ||
          risk ||
          "MEDIUM"
        );

        // =================================================
        // DOCTOR
        // =================================================

        setDoctor(
          (previous) => ({
            ...previous,

            name:
              data.doctorName ||
              previous.name ||
              "Selected Doctor",

            email:
              data.doctorEmail ||
              previous.email ||
              "",

            specialization:
              data.specialization ||
              previous.specialization ||
              "Cardiologist",

            experience:
              data.experience ||
              previous.experience ||
              "",
          })
        );

        // =================================================
        // HOSPITAL
        // =================================================

        setHospital(
          (previous) => ({
            ...previous,

            name:
              data.hospitalName ||
              previous.name ||
              "Selected Hospital",

            id:
              data.hospitalId ||
              previous.id ||
              "",
          })
        );

        // =================================================
        // CITY
        // =================================================

        setCity(
          data.city ||
          data.location ||
          initialCity ||
          ""
        );

        setLoading(false);
      },

      (error) => {

        console.error(
          "FIREBASE LISTENER ERROR:",
          error
        );

        setLoading(false);
      }
    );

    // Cleanup listener
    return () => {
      console.log(
        "STOPPING FIREBASE LISTENER"
      );

      unsubscribe();
    };

  }, [
    requestId,
    initialCity,
    risk,
  ]);

  // =====================================================
  // DATE
  // =====================================================

  const createdAt =
    requestData?.createdAt?.toDate?.() ||
    new Date();

  const requestDate =
    createdAt.toLocaleDateString(
      "en-IN",
      {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }
    );

  const requestTime =
    createdAt.toLocaleTimeString(
      "en-IN",
      {
        hour: "2-digit",
        minute: "2-digit",
      }
    );

  // =====================================================
  // DISPLAY VALUES
  // =====================================================

  const doctorName =
    doctor.name ||
    "Selected Doctor";

  const hospitalName =
    hospital.name ||
    "Selected Hospital";

  // =====================================================
  // STATUS
  // =====================================================

  /*
    These used to be an if-chain over "accepted" and "rejected",
    defaulting to PENDING.

    That default was the bug the patient saw. When the doctor joined
    the call the consultation moved to "in_progress" - a status this
    page had never heard of - so no branch matched and it fell back
    to "PENDING". The doctor had not un-accepted anything and the
    database still said in_progress; only this page misread it.

    The labels now come from consultationService, which is also what
    sets the status in the first place, so a status cannot exist
    without a label here.
  */
  const statusTitle = statusLabel(status).toUpperCase();
  const statusMessage = statusHelp(status);

  /* accepted and in_progress are both joinable - see isJoinable. */
  const canJoin = isJoinable(status);

  const isRejected = normaliseStatus(status) === STATUS.REJECTED;

  const live = normaliseStatus(status) === STATUS.IN_PROGRESS;

  /* One palette keyed by state, rather than nested ternaries that
     each had to be remembered separately. */
  const tone = canJoin
    ? { background: "#e3f8ef", accent: "#42c59b" }
    : isRejected
    ? { background: "#ffe8e8", accent: "#e66b6b" }
    : { background: "#fff4df", accent: "#f4b04f" };

  // =====================================================
  // LOADING
  // =====================================================

  if (loading) {

    return (
      <div className="consult-page">

        <section className="consult-header">

          <div className="consult-label">
            CONSULTATION REQUEST
          </div>

          <h1>
            Loading Consultation...
          </h1>

          <p>
            Connecting to your consultation
            request.
          </p>

        </section>

        <section className="consult-submit">

          <div>

            <strong>
              Connecting securely
            </strong>

            <p>
              Please wait while we retrieve
              your consultation status.
            </p>

          </div>

        </section>

      </div>
    );
  }

  // =====================================================
  // UI
  // =====================================================

  return (
    <div className="consult-page">

      {/* =================================================
          HEADER
      ================================================= */}

      <section className="consult-header">

        <div className="consult-label">
          CONSULTATION REQUEST
        </div>

        <h1>

          {live
            ? "Consultation In Progress"

            : canJoin
            ? "Consultation Accepted"

            : isRejected
            ? "Consultation Request Declined"

            : "Request Sent Successfully"}

        </h1>

        <p>

          {canJoin

            ? statusHelp(status)

            : isRejected

            ? "The selected doctor has declined this consultation request."

            : "Your cardiac assessment report has been securely shared with your selected doctor."}

        </p>

      </section>


      {/* =================================================
          STATUS CARD
      ================================================= */}

      <section
        className="consult-risk-card"
        style={{
          background: tone.background,
          borderLeft: `10px solid ${tone.accent}`,
        }}
      >

        <div>

          <span>
            CONSULTATION STATUS
          </span>

          <h2>
            {statusTitle}
          </h2>

        </div>

        <p>
          {statusMessage}
        </p>

      </section>


      {/* =================================================
          DOCTOR
      ================================================= */}

      <section className="consult-section">

        <div className="step-number">
          ✓
        </div>

        <div className="section-content">

          <h2>
            Your Selected Doctor
          </h2>

          <p>
            This is the doctor who received
            your consultation request.
          </p>

          <div className="doctor-grid">

            <div
              className="doctor-card selected"
              style={{
                cursor: "default",
              }}
            >

              <div className="doctor-avatar">

                {doctorName
                  .replace("Dr.", "")
                  .trim()
                  .charAt(0)
                  .toUpperCase()}

              </div>

              <div className="doctor-info">

                <strong>
                  {doctorName}
                </strong>

                <span>
                  {doctor.specialization ||
                    "Cardiologist"}
                </span>

                {doctor.experience && (

                  <small>

                    {doctor.experience}
                    {" "}
                    years experience

                  </small>

                )}

              </div>

            </div>

          </div>

        </div>

      </section>


      {/* =================================================
          CONSULTATION DETAILS
      ================================================= */}

      <section className="consult-section">

        <div className="step-number">
          02
        </div>

        <div className="section-content">

          <h2>
            Consultation Details
          </h2>

          <p>
            Your consultation request information.
          </p>

          <div className="hospital-grid">

            {/* HOSPITAL */}

            <div className="hospital-card">

              <div className="hospital-icon">
                +
              </div>

              <div className="hospital-info">

                <strong>
                  Hospital
                </strong>

                <span>
                  {hospitalName}
                </span>

              </div>

            </div>


            {/* LOCATION */}

            <div className="hospital-card">

              <div className="hospital-icon">
                ◉
              </div>

              <div className="hospital-info">

                <strong>
                  Location
                </strong>

                <span>
                  {city || "Not available"}
                </span>

              </div>

            </div>


            {/* RISK */}

            <div className="hospital-card">

              <div className="hospital-icon">
                ♥
              </div>

              <div className="hospital-info">

                <strong>
                  Cardiac Risk
                </strong>

                <span>
                  {currentRisk || "Not recorded"}
                </span>

              </div>

            </div>


            {/* REQUESTED */}

            <div className="hospital-card">

              <div className="hospital-icon">
                ◷
              </div>

              <div className="hospital-info">

                <strong>
                  Requested
                </strong>

                <span>
                  {requestDate}
                  {" · "}
                  {requestTime}
                </span>

              </div>

            </div>

          </div>

        </div>

      </section>


      {/* =================================================
          ACCEPTED
      ================================================= */}

      {/*
          Gated on canJoin, NOT on status === "accepted".

          The literal comparison was what made the Join button
          disappear the moment the doctor joined: the consultation
          became "in_progress" and this block stopped rendering, so
          the patient was locked out of a call that was running and
          waiting for them.
      */}
      {canJoin && (

        <section className="consult-submit">

          <div>

            <strong>
              {live
                ? "Your doctor is waiting in the consultation room"
                : "Your doctor is ready"}
            </strong>

            <p>
              {live
                ? `${doctorName} has already joined. Join now to start
                   your consultation.`
                : `${doctorName} has accepted your consultation
                   request. You can now join the video
                   consultation.`}
            </p>

          </div>

          <button
            type="button"
            onClick={() =>
                        navigate(
            `/video-consultation/${requestId}`,
            {
              state: {
                doctor,
                hospital,
                city,
                risk: currentRisk,
              },
            }
          )
            }
          >
            {joinLabel(status)} →
          </button>

        </section>

      )}


      {/* =================================================
          PENDING
      ================================================= */}

      {normaliseStatus(status) === STATUS.PENDING && (

        <section className="consult-submit">

          <div>

            <strong>
              What happens next?
            </strong>

            <p>
              Your doctor will review your
              cardiac assessment report.
              This page will automatically
              update when the doctor responds.
            </p>

          </div>

          <button
            type="button"
            onClick={() =>
              navigate("/result", {
                state: {
                  risk: currentRisk,
                },
              })
            }
          >
            Back to Report
          </button>

        </section>

      )}


      {/* =================================================
          REJECTED
      ================================================= */}

      {isRejected && (

        <section className="consult-submit">

          <div>

            <strong>
              Consultation not accepted
            </strong>

            <p>
              You can return to the consultation
              page and choose another doctor.
            </p>

          </div>

          <button
            type="button"
            onClick={() =>
              navigate("/consult-doctor")
            }
          >
            Choose Another Doctor →
          </button>

        </section>

      )}

    </div>
  );
}

export default ConsultationStatus;