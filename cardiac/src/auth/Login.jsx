import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { loginUser } from "../services/authService";

function Login() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      await loginUser(email, password);

      alert("Login successful");

      navigate("/patient/dashboard");
    } catch (error) {
      alert(error.message);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-left">
          <h1>CardioCare</h1>

          <p>
            AI-powered cardiac monitoring and
            teleconsultation platform.
          </p>

          <form
            className="auth-form"
            onSubmit={handleSubmit}
          >
            <input
              type="email"
              placeholder="Email"
              required
              value={email}
              onChange={(e) =>
                setEmail(e.target.value)
              }
            />

            <input
              type="password"
              placeholder="Password"
              required
              value={password}
              onChange={(e) =>
                setPassword(e.target.value)
              }
            />

            <button type="submit">
              Login
            </button>
          </form>

          <p className="auth-link">
            Don't have an account?{" "}
            <Link to="/signup">
              Sign Up
            </Link>
          </p>
        </div>

        <div className="auth-right">
          <div className="auth-image">
            🩺
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;