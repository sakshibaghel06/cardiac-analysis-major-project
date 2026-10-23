import { Link } from "react-router-dom";

/*
=====================================================
LANDING
=====================================================

Two clearly separated entry points.

The SPLIT IS PRESENTATIONAL ONLY. Both routes run the
same Firebase sign-in and the same role resolution, and
the role in Firestore still decides which dashboard you
reach. Choosing "Doctor" does not grant anything: a
patient who signs in there lands on the patient
dashboard, and vice versa.

That matters because an entry point which actually
determined your role would be a privilege escalation
waiting to happen - the user controls which link they
click, and must never control their own permissions.
=====================================================
*/

function Landing() {
  return (
    <div className="landing">
      <header className="landing-head">
        <div className="landing-brand">
          Cardio<span>Care</span>
        </div>

        <p className="landing-tagline">
          AI-based cardiovascular risk assessment and teleconsultation
        </p>
      </header>

      <main className="landing-main">
        <h1>How would you like to sign in?</h1>

        <div className="landing-choices">
          {/* ---------- PATIENT ---------- */}

          <article className="landing-card">
            <div className="landing-icon" aria-hidden="true">
              ♥
            </div>

            <h2>I am a patient</h2>

            <p>
              Complete a short cardiac screening, get an AI-estimated risk
              level, and consult a cardiologist by video if you need one.
            </p>

            <ul className="landing-points">
              <li>Free cardiac risk assessment</li>
              <li>Results explained in plain language</li>
              <li>Video consultation and prescriptions</li>
            </ul>

            <Link className="landing-primary" to="/login">
              Patient Sign In
            </Link>

            <Link className="landing-link" to="/signup">
              New here? Create an account
            </Link>
          </article>

          {/* ---------- DOCTOR ---------- */}

          <article className="landing-card landing-card-doctor">
            <div className="landing-icon" aria-hidden="true">
              ⚕
            </div>

            <h2>I am a doctor</h2>

            <p>
              Review consultation requests, read each patient&apos;s cardiac
              assessment, hold the consultation and issue a prescription.
            </p>

            <ul className="landing-points">
              <li>Requests with the patient&apos;s risk result attached</li>
              <li>Video consultations</li>
              <li>Prescriptions and consultation history</li>
            </ul>

            <Link className="landing-primary" to="/doctor/login">
              Doctor Sign In
            </Link>

            <span className="landing-note">
              Doctor accounts are issued by your hospital administrator
            </span>
          </article>
        </div>

        <p className="landing-disclaimer">
          CardioCare provides an AI-based cardiovascular risk estimate for
          screening and decision support. It is <strong>not</strong> a medical
          diagnosis and does not replace professional medical evaluation. In an
          emergency, contact your local emergency services immediately.
        </p>
      </main>
    </div>
  );
}

export default Landing;
