import { useEffect, useState } from "react";

import {
  onAuthStateChanged,
  signOut,
} from "firebase/auth";

import { useNavigate } from "react-router-dom";

import { auth } from "../firebase/firebase";

import {
  getDoctorProfile,
  getDoctorRequests,
} from "../services/doctorService";


function DoctorDashboard() {

  const navigate = useNavigate();

  const [doctor, setDoctor] =
    useState(null);

  const [requests, setRequests] =
    useState([]);

  const [loading, setLoading] =
    useState(true);


  useEffect(() => {

    const unsubscribe =
      onAuthStateChanged(
        auth,
        async (user) => {

          if (!user) {

            navigate("/doctor/login");

            return;
          }


          try {

            /*
            ==========================================
            GET DOCTOR PROFILE
            ==========================================

            Firebase Authentication gives us:

            user.email
            user.uid

            Our doctors collection currently
            stores the doctor's email.

            Therefore profile is searched by email.
            */

            const profile =
              await getDoctorProfile(
                user.email
              );


            if (!profile) {

              console.log(
                "Doctor profile not found for:",
                user.email
              );

              /*
              Do NOT create a fake doctor profile.

              This is important because we want
              every doctor to come from Firebase.
              */

              setDoctor({
                uid: user.uid,
                name: "Doctor",
                email: user.email,
                specialization:
                  "Cardiologist",
                hospital:
                  "CardioCare Hospital",
                city:
                  "Bangalore",
              });

            } else {

              setDoctor({
                uid: user.uid,
                ...profile,
              });

            }


            /*
            ==========================================
            GET THIS DOCTOR'S REQUESTS
            ==========================================

            IMPORTANT:

            We use user.uid.

            Therefore:

            Doctor A
               ↓
            only Doctor A requests

            Doctor B
               ↓
            only Doctor B requests
            */

            const doctorRequests =
              await getDoctorRequests(
                user.uid
              );


            setRequests(
              doctorRequests
            );


          } catch (error) {

            console.error(
              "Doctor dashboard error:",
              error
            );

          } finally {

            setLoading(false);

          }

        }
      );


    return () => unsubscribe();

  }, [navigate]);


  /*
  ================================================
  LOGOUT
  ================================================
  */

  const handleLogout = async () => {

    try {

      await signOut(auth);

      navigate(
        "/doctor/login"
      );

    } catch (error) {

      console.error(
        "Logout error:",
        error
      );

    }
  };


  /*
  ================================================
  LOADING SCREEN
  ================================================
  */

  if (loading) {

    return (

      <div className="doctor-loading">

        <div className="doctor-loader"></div>

        <p>
          Loading doctor portal...
        </p>

      </div>

    );

  }


  /*
  ================================================
  REQUEST COUNTS
  ================================================
  */

  const pendingRequests =
    requests.filter(
      (request) =>
        request.status ===
        "pending"
    );


  const acceptedRequests =
    requests.filter(
      (request) =>
        request.status ===
        "accepted"
    );


  const rejectedRequests =
    requests.filter(
      (request) =>
        request.status ===
        "rejected"
    );


  /*
  ================================================
  DOCTOR DASHBOARD
  ================================================
  */

  return (

    <div className="doctor-dashboard">


      {/* =========================================
          SIDEBAR
      ========================================= */}

      <aside className="doctor-sidebar">


        <div className="doctor-brand">

          Cardio<span>Care</span>

        </div>


        <div className="doctor-profile-small">


          <div className="doctor-avatar">

            {doctor?.name
              ?.charAt(0)
              ?.toUpperCase()}

          </div>


          <div>

            <strong>
              {doctor?.name}
            </strong>

            <span>
              {doctor?.specialization}
            </span>

          </div>


        </div>


        <nav className="doctor-nav">


          <button
            className="active"
            onClick={() =>
              navigate(
                "/doctor/dashboard"
              )
            }
          >

            <span>
              ▦
            </span>

            Dashboard

          </button>


          <button
            onClick={() =>
              navigate(
                "/doctor/consultations"
              )
            }
          >

            <span>
              ◷
            </span>

            Consultations

          </button>


          <button
            onClick={() =>
              navigate(
                "/doctor/patients"
              )
            }
          >

            <span>
              ♡
            </span>

            Patients

          </button>


          <button
            onClick={() =>
              navigate(
                "/doctor/profile"
              )
            }
          >

            <span>
              ○
            </span>

            Profile

          </button>


        </nav>


        <button
          className="doctor-logout"
          onClick={handleLogout}
        >

          <span>
            →
          </span>

          Logout

        </button>


      </aside>


      {/* =========================================
          MAIN CONTENT
      ========================================= */}

      <main className="doctor-main">


        {/* =======================================
            TOP BAR
        ======================================= */}

        <header className="doctor-topbar">


          <input
            type="text"
            placeholder="Search patients or consultations"
          />


          <div className="doctor-top-profile">


            <div className="doctor-avatar">

              {doctor?.name
                ?.charAt(0)
                ?.toUpperCase()}

            </div>


            <div>

              <strong>
                {doctor?.name}
              </strong>

              <span>
                {doctor?.email}
              </span>

            </div>


          </div>


        </header>


        {/* =======================================
            WELCOME
        ======================================= */}

        <section className="doctor-welcome">


          <div>


            <p>
              DOCTOR PORTAL
            </p>


            <h1>

              Good day,

              <br />

              {doctor?.name ||
                "Doctor"}

            </h1>


            <span>

              Review and respond to your
              patient consultation requests.

            </span>


          </div>


          <div className="doctor-date">

            {new Date()
              .toLocaleDateString(
                "en-IN",
                {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                }
              )}

          </div>


        </section>


        {/* =======================================
            STATISTICS
        ======================================= */}

        <section className="doctor-stats">


          <div className="doctor-stat-card">

            <span>
              Pending Requests
            </span>

            <strong>
              {pendingRequests.length}
            </strong>

            <small>
              Need your attention
            </small>

          </div>


          <div className="doctor-stat-card">

            <span>
              Accepted
            </span>

            <strong>
              {acceptedRequests.length}
            </strong>

            <small>
              Active consultations
            </small>

          </div>


          <div className="doctor-stat-card">

            <span>
              Total Requests
            </span>

            <strong>
              {requests.length}
            </strong>

            <small>
              Patient requests
            </small>

          </div>


          <div className="doctor-stat-card">

            <span>
              Rejected
            </span>

            <strong>
              {rejectedRequests.length}
            </strong>

            <small>
              Previous requests
            </small>

          </div>


        </section>


        {/* =======================================
            CONSULTATION REQUESTS
        ======================================= */}

        <section className="doctor-requests">


          <div className="section-heading">


            <div>

              <p>
                PATIENT REQUESTS
              </p>

              <h2>
                Consultation Requests
              </h2>

            </div>


            <span>

              {pendingRequests.length}
              {" "}
              requests

            </span>


          </div>


          {/* =====================================
              NO REQUESTS
          ===================================== */}

          {pendingRequests.length === 0 ? (

            <div className="empty-doctor-state">


              <div className="empty-icon">
                ✓
              </div>


              <h3>
                No pending requests
              </h3>


              <p>

                New patient consultation
                requests will appear here.

              </p>


            </div>


          ) : (


            /* ===================================
               REQUEST LIST
            =================================== */

            <div className="request-list">


              {pendingRequests.map(
                (request) => (


                  <div
                    className="request-card"
                    key={request.id}
                  >


                    {/* PATIENT */}

                    <div className="request-patient">


                      <div className="patient-avatar">

                        {request.patientName
                          ?.charAt(0)
                          ?.toUpperCase() ||
                          "P"}

                      </div>


                      <div>

                        <h3>

                          {
                            request.patientName ||
                            "Patient"
                          }

                        </h3>


                        <p>

                          {
                            request.patientEmail
                          }

                        </p>

                      </div>


                    </div>


                    {/* RISK */}

                    <div className="request-risk">


                      <span>
                        Cardiac Risk
                      </span>


                      <strong
                        className={
                          request.risk
                            ?.toLowerCase()
                        }
                      >

                        {request.risk ||
                          "UNKNOWN"}

                      </strong>


                    </div>


                    {/* DATE */}

                    <div className="request-date">


                      <span>
                        Requested
                      </span>


                      <strong>

                        {request.createdAt
                          ?.toDate
                          ? request.createdAt
                              .toDate()
                              .toLocaleDateString()
                          : "Recently"}

                      </strong>


                    </div>


                    {/* VIEW */}

                    <button
                      className="view-request-btn"
                      onClick={() =>
                        navigate(
                          `/doctor/request/${request.id}`
                        )
                      }
                    >

                      View Request

                    </button>


                  </div>


                )
              )}


            </div>

          )}


        </section>


      </main>


    </div>

  );

}


export default DoctorDashboard;