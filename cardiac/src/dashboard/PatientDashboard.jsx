import { Link } from "react-router-dom";
function PatientDashboard() {
  return (
    <div className="dashboard">
      <nav className="navbar">
        <h2>CardioCare</h2>

        <div className="nav-links">
          <a href="#">Home</a>

          <a href="#">Prediction</a>

          <a href="#">Doctors</a>

          <a href="#">Emergency</a>

          <button>Book Appointment</button>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-left">
          <h1>
            Your Heart,
            <br />
            Our Priority
          </h1>

          <p>
            Smart health monitoring for
            early detection of cardiac
            anomalies.
          </p>

          <Link to="/risk">
            <button>
                Start Risk Assessment
            </button>
            </Link>
        </div>

        <div className="hero-right">
          <div className="doctor-image">
            👨‍⚕️
          </div>
        </div>
      </section>

      <section className="departments">
        <h2>Services</h2>

        <div className="cards">
          <div className="service-card">
            🚑
            <h3>Emergency</h3>
          </div>

          <div className="service-card">
            ❤️
            <h3>Cardiac Risk</h3>
          </div>

          <div className="service-card">
            👩‍⚕️
            <h3>Consultation</h3>
          </div>
        </div>
      </section>
    </div>
  );
}

export default PatientDashboard;