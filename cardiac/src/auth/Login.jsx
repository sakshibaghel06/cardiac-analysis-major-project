import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import {
  loginUser,
  resetPassword,
  describeAuthError,
} from "../services/authService";

import { homeRouteFor, resolveRole } from "../services/roleService";

/*
=====================================================
LOGIN  -  one component, two portals
=====================================================

`portal` changes the WORDING ONLY. Both portals run the
identical Firebase sign-in and the identical Firestore
role resolution, and the resolved role decides where the
user lands.

So signing in at the doctor portal does not make anyone a
doctor. A patient who uses it is sent to the patient
dashboard, with a note explaining why. If the entry point
actually determined the role, the user would be choosing
their own permissions - which is precisely what the
Firestore rules exist to prevent.
=====================================================
*/

const COPY = {
  patient: {
    eyebrow: "PATIENT PORTAL",
    heading: "Sign in",
    blurb:
      "Check your cardiac risk, consult a doctor and view your prescriptions.",
    panelHeading: "Know your risk.\nTalk to a doctor.",
    panelBody:
      "Complete a short cardiac screening, get an AI-estimated risk level, " +
      "and consult a cardiologist by video if you need one.",
    icon: "♥",
  },
  doctor: {
    eyebrow: "DOCTOR PORTAL",
    heading: "Doctor sign in",
    blurb:
      "Review consultation requests, hold consultations and issue prescriptions.",
    panelHeading: "Cardiac care,\nconnected.",
    panelBody:
      "Every request arrives with the patient's cardiac assessment attached, " +
      "so you can review before you accept.",
    icon: "⚕",
  },
};

function Login({ portal = "patient" }) {
  const navigate = useNavigate();
  const location = useLocation();

  const copy = COPY[portal] || COPY.patient;
  const isDoctorPortal = portal === "doctor";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();

    setError("");
    setNotice("");

    try {
      setLoading(true);

      const credential = await loginUser(email, password);

      // The database decides the role, not the portal they chose.
      const { role } = await resolveRole(credential.user);

      /*
        Using the wrong portal is a harmless mistake, so say so
        rather than silently landing them somewhere unexpected.
      */
      if (isDoctorPortal && role !== "doctor") {
        setNotice(
          "That account is a patient account, so we have taken you to " +
            "the patient dashboard."
        );
      }

      // Return them to a guarded page they were bounced from, but
      // only if it belongs to the role they turned out to have.
      const intended = location.state?.from;
      const wantsDoctorRoute = intended?.startsWith("/doctor");

      const matchesRole =
        intended && (role === "doctor") === Boolean(wantsDoctorRoute);

      navigate(matchesRole ? intended : homeRouteFor(role), { replace: true });
    } catch (loginError) {
      setError(describeAuthError(loginError));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setError("");
    setNotice("");

    if (!email) {
      setError("Enter your email address first, then choose Forgot password.");
      return;
    }

    try {
      await resetPassword(email);

      /*
        Deliberately identical whether or not the account exists -
        otherwise this form confirms which email addresses are
        registered.
      */
      setNotice(
        "If an account exists for that address, a password reset link is on its way."
      );
    } catch (resetError) {
      setError(describeAuthError(resetError));
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-left">
          <span className="auth-eyebrow">{copy.eyebrow}</span>

          <h1>{copy.heading}</h1>

          <p>{copy.blurb}</p>

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <label className="auth-field">
              <span>Email</span>

              <input
                type="email"
                placeholder={
                  isDoctorPortal ? "doctor@hospital.com" : "you@example.com"
                }
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            <label className="auth-field">
              <span>Password</span>

              <input
                type="password"
                placeholder="Your password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>

            {error && (
              <div className="auth-error" role="alert">
                {error}
              </div>
            )}

            {notice && (
              <div className="auth-notice" role="status">
                {notice}
              </div>
            )}

            <button type="submit" disabled={loading}>
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>

          <button
            type="button"
            className="auth-text-button"
            onClick={handleForgotPassword}
          >
            Forgot password?
          </button>

          {isDoctorPortal ? (
            <>
              <p className="auth-footnote">
                Doctor accounts are created by your hospital administrator
                and cannot be registered here.
              </p>

              <p className="auth-link">
                Are you a patient? <Link to="/login">Patient sign in</Link>
              </p>
            </>
          ) : (
            <>
              <p className="auth-link">
                New patient? <Link to="/signup">Create an account</Link>
              </p>

              <p className="auth-link">
                Are you a doctor?{" "}
                <Link to="/doctor/login">Doctor sign in</Link>
              </p>
            </>
          )}
        </div>

        <div className={`auth-right ${isDoctorPortal ? "auth-right-doctor" : ""}`}>
          <div className="auth-image" aria-hidden="true">
            {copy.icon}
          </div>

          <h2>
            {copy.panelHeading.split("\n").map((line) => (
              <span key={line}>{line}</span>
            ))}
          </h2>

          <p>{copy.panelBody}</p>
        </div>
      </div>
    </div>
  );
}

export default Login;
