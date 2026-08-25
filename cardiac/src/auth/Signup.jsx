import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { registerUser } from "../services/authService";

function Signup() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] =
    useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      await registerUser(email, password);

      alert("Registration successful");

      navigate("/");
    } catch (error) {
      alert(error.message);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-left">
          <h1>Create Account</h1>

          <p>
            Create your CardioCare account.
          </p>

          <form
            className="auth-form"
            onSubmit={handleSubmit}
          >
            <input
              type="email"
              placeholder="Email"
              required
              onChange={(e) =>
                setEmail(e.target.value)
              }
            />

            <input
              type="password"
              placeholder="Password"
              required
              onChange={(e) =>
                setPassword(e.target.value)
              }
            />

            <button type="submit">
              Sign Up
            </button>
          </form>

          <p className="auth-link">
            Already have an account?{" "}
            <Link to="/">
              Login
            </Link>
          </p>
        </div>

        <div className="auth-right">
          <div className="auth-image">
            ❤️
          </div>
        </div>
      </div>
    </div>
  );
}

export default Signup;