import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { auth } from "../firebase/firebase";

function DoctorLogin() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();

    setError("");
    setLoading(true);

    try {
      await signInWithEmailAndPassword(
        auth,
        email,
        password
      );

      navigate("/doctor/dashboard");
    } catch (error) {
      console.error(error);

      if (
        error.code === "auth/invalid-credential" ||
        error.code === "auth/wrong-password" ||
        error.code === "auth/user-not-found"
      ) {
        setError("Invalid email or password.");
      } else {
        setError("Unable to login. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="doctor-login-page">
      <div className="doctor-login-card">

        <div className="doctor-login-left">
          <div className="doctor-logo">
            Cardio<span>Care</span>
          </div>

          <div className="doctor-login-content">
            <p className="doctor-label">
              DOCTOR PORTAL
            </p>

            <h1>
              Welcome back,
              <br />
              Doctor.
            </h1>

            <p className="doctor-description">
              Sign in to review patient consultation
              requests and access cardiac assessment
              reports.
            </p>

            <form onSubmit={handleSubmit}>

              <label>Email Address</label>

              <input
                type="email"
                placeholder="doctor@gmail.com"
                value={email}
                onChange={(e) =>
                  setEmail(e.target.value)
                }
                required
              />

              <label>Password</label>

              <input
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) =>
                  setPassword(e.target.value)
                }
                required
              />

              {error && (
                <div className="doctor-login-error">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
              >
                {loading
                  ? "Signing in..."
                  : "Sign In"}
              </button>

            </form>
          </div>
        </div>

        <div className="doctor-login-right">

          <div className="doctor-login-circle">
            ♥
          </div>

          <h2>
            Cardiac Care,
            <br />
            Connected.
          </h2>

          <p>
            Review patient health reports,
            respond to consultations and
            provide better cardiac care.
          </p>

        </div>

      </div>
    </div>
  );
}

export default DoctorLogin;