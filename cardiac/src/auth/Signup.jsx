import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { registerUser, describeAuthError } from "../services/authService";

function Signup() {
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("Please choose a password of at least 6 characters.");
      return;
    }

    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    try {
      setLoading(true);

      // Also creates users/{uid} so the profile actually exists.
      await registerUser(email, password, name.trim());

      navigate("/patient/dashboard");
    } catch (signupError) {
      setError(describeAuthError(signupError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-left">
          <h1>Create Account</h1>

          <p>Create your CardioCare account.</p>

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <input
              type="text"
              placeholder="Full name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />

            <input
              type="email"
              placeholder="Email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />

            <input
              type="password"
              placeholder="Password (at least 6 characters)"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />

            <input
              type="password"
              placeholder="Confirm password"
              required
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />

            {error && (
              <div className="auth-error" role="alert">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}>
              {loading ? "Creating account..." : "Sign Up"}
            </button>
          </form>

          <p className="auth-link">
            Already have an account? <Link to="/">Login</Link>
          </p>
        </div>

        <div className="auth-right">
          <div className="auth-image">❤️</div>
        </div>
      </div>
    </div>
  );
}

export default Signup;
