import { useEffect, useState } from "react";
import {
  useLocation,
  useNavigate,
} from "react-router-dom";

import {
  getAllHospitals,
  getHospitalsByLocation,
} from "../services/hospitalService";

import {
  getDoctorsByHospital,
} from "../services/doctorService";

import {
  createConsultationRequest,
} from "../services/consultationService";

import { auth } from "../firebase/firebase";

function ConsultDoctor() {
  const navigate = useNavigate();
  const location = useLocation();

  // =====================================================
  // DATA FROM RESULT PAGE
  // =====================================================

  const risk =
    location.state?.risk || "MEDIUM";

  const report =
    location.state?.report || {};

  const patient =
    location.state?.patient || {};

  // =====================================================
  // STATE
  // =====================================================

  const [cities, setCities] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [doctors, setDoctors] = useState([]);

  const [selectedCity, setSelectedCity] =
    useState("");

  const [selectedHospital, setSelectedHospital] =
    useState(null);

  const [selectedDoctor, setSelectedDoctor] =
    useState(null);

  const [loadingCities, setLoadingCities] =
    useState(true);

  const [loadingHospitals, setLoadingHospitals] =
    useState(false);

  const [loadingDoctors, setLoadingDoctors] =
    useState(false);

  const [sending, setSending] =
    useState(false);

  // =====================================================
  // LOAD CITIES
  // =====================================================

  useEffect(() => {
    const loadCities = async () => {
      try {
        setLoadingCities(true);

        const allHospitals =
          await getAllHospitals();

        const uniqueLocations = [
          ...new Set(
            allHospitals
              .map(
                (hospital) =>
                  hospital.location
              )
              .filter(Boolean)
          ),
        ];

        setCities(uniqueLocations);
      } catch (error) {
        console.error(
          "Error loading cities:",
          error
        );
      } finally {
        setLoadingCities(false);
      }
    };

    loadCities();
  }, []);

  // =====================================================
  // LOAD HOSPITALS
  // =====================================================

  useEffect(() => {
    if (!selectedCity) {
      setHospitals([]);
      return;
    }

    const loadHospitals = async () => {
      try {
        setLoadingHospitals(true);

        setSelectedHospital(null);
        setSelectedDoctor(null);
        setDoctors([]);

        const hospitalData =
          await getHospitalsByLocation(
            selectedCity
          );

        setHospitals(hospitalData);
      } catch (error) {
        console.error(
          "Error loading hospitals:",
          error
        );
      } finally {
        setLoadingHospitals(false);
      }
    };

    loadHospitals();
  }, [selectedCity]);

  // =====================================================
  // LOAD DOCTORS
  // =====================================================

  useEffect(() => {
    if (!selectedHospital) {
      setDoctors([]);
      return;
    }

    const loadDoctors = async () => {
      try {
        setLoadingDoctors(true);

        setSelectedDoctor(null);

        const doctorData =
          await getDoctorsByHospital(
            selectedHospital.id
          );

        setDoctors(doctorData);
      } catch (error) {
        console.error(
          "Error loading doctors:",
          error
        );
      } finally {
        setLoadingDoctors(false);
      }
    };

    loadDoctors();
  }, [selectedHospital]);

  // =====================================================
  // SELECT CITY
  // =====================================================

  const handleCitySelect = (city) => {
    setSelectedCity(city);

    setSelectedHospital(null);
    setSelectedDoctor(null);

    setHospitals([]);
    setDoctors([]);
  };

  // =====================================================
  // SELECT HOSPITAL
  // =====================================================

  const handleHospitalSelect = (hospital) => {
    setSelectedHospital(hospital);

    setSelectedDoctor(null);
    setDoctors([]);
  };

  // =====================================================
  // SELECT DOCTOR
  // =====================================================

  const handleDoctorSelect = (doctor) => {
    setSelectedDoctor(doctor);
  };

  // =====================================================
  // SEND CONSULTATION REQUEST
  // =====================================================

  const handleConsultDoctor = async () => {
    if (!selectedCity) {
      alert("Please select a city.");
      return;
    }

    if (!selectedHospital) {
      alert("Please select a hospital.");
      return;
    }

    if (!selectedDoctor) {
      alert("Please select a doctor.");
      return;
    }

    const currentUser =
      auth.currentUser;

    if (!currentUser) {
      alert(
        "Your session has expired. Please login again."
      );
      return;
    }

    try {
      setSending(true);

      // =================================================
      // CREATE CONSULTATION REQUEST
      // =================================================

      const requestId =
        await createConsultationRequest({

          // =============================================
          // PATIENT
          // =============================================

          patientId:
            currentUser.uid,

          patientEmail:
            currentUser.email || "",

          patientName:
            patient.name ||
            currentUser.displayName ||
            "Patient",

          // =============================================
          // DOCTOR
          // =============================================

          doctorId:
            selectedDoctor.id,

          doctorName:
            selectedDoctor.name || "",

          doctorEmail:
            selectedDoctor.email || "",

          // =============================================
          // HOSPITAL
          // =============================================

          hospitalId:
            selectedHospital.id,

          hospitalName:
            selectedHospital.name || "",

          // =============================================
          // CITY
          // =============================================

          city:
            selectedCity,

          // =============================================
          // RISK
          // =============================================

          risk:
            risk,

          // =============================================
          // COMPLETE REPORT
          // =============================================

          report:
            report,
        });

      console.log(
        "Consultation request ID:",
        requestId
      );

      // =================================================
      // OPEN CONSULTATION STATUS
      // =================================================

      navigate(
        `/consultation-status/${requestId}`,
        {
          state: {
            requestId,

            risk,

            doctor:
              selectedDoctor,

            hospital:
              selectedHospital,

            city:
              selectedCity,

            report,

            patient: {
              name:
                patient.name ||
                currentUser.displayName ||
                "Patient",

              email:
                currentUser.email || "",

              uid:
                currentUser.uid,
            },
          },
        }
      );

    } catch (error) {
      console.error(
        "Consultation request error:",
        error
      );

      alert(
        error.message ||
        "Unable to send consultation request."
      );

    } finally {
      setSending(false);
    }
  };

  // =====================================================
  // UI
  // =====================================================

  return (
    <div className="consult-page">

      {/* HEADER */}

      <section className="consult-header">

        <div className="consult-label">
          DOCTOR CONSULTATION
        </div>

        <h1>
          Choose Your Doctor
        </h1>

        <p>
          Select your city, choose a hospital,
          and then select the doctor you want
          to consult. Your cardiac assessment
          report will be shared securely with
          the selected doctor.
        </p>

      </section>

      {/* RISK */}

      <section className="consult-risk-card">

        <div>

          <span>
            YOUR CURRENT CARDIAC RISK
          </span>

          <h2>
            {risk}
          </h2>

        </div>

        <p>
          Your AI cardiac assessment will be
          securely attached to the consultation
          request.
        </p>

      </section>

      {/* =================================================
          CITY
      ================================================= */}

      <section className="consult-section">

        <div className="step-number">
          01
        </div>

        <div className="section-content">

          <h2>
            Choose Your City
          </h2>

          <p>
            Select the city where you would
            like to consult a cardiologist.
          </p>

          {loadingCities ? (

            <div className="loading-state">
              Loading cities...
            </div>

          ) : cities.length === 0 ? (

            <div className="empty-state">
              No cities are currently available.
            </div>

          ) : (

            <div className="city-grid">

              {cities.map((city) => (

                <button
                  key={city}
                  type="button"
                  className={
                    selectedCity === city
                      ? "city-card selected"
                      : "city-card"
                  }
                  onClick={() =>
                    handleCitySelect(city)
                  }
                >

                  <div className="city-icon">
                    ◉
                  </div>

                  <div>

                    <strong>
                      {city}
                    </strong>

                    <span>
                      Select this city
                    </span>

                  </div>

                  <div className="radio">
                    {selectedCity === city
                      ? "✓"
                      : ""}
                  </div>

                </button>

              ))}

            </div>

          )}

        </div>

      </section>

      {/* =================================================
          HOSPITAL
      ================================================= */}

      {selectedCity && (

        <section className="consult-section">

          <div className="step-number">
            02
          </div>

          <div className="section-content">

            <h2>
              Choose a Hospital
            </h2>

            <p>
              Select a hospital in{" "}
              <strong>
                {selectedCity}
              </strong>.
            </p>

            {loadingHospitals ? (

              <div className="loading-state">
                Loading hospitals...
              </div>

            ) : hospitals.length === 0 ? (

              <div className="empty-state">
                No hospitals are available
                in this city.
              </div>

            ) : (

              <div className="hospital-grid">

                {hospitals.map(
                  (hospital) => (

                    <button
                      key={hospital.id}
                      type="button"
                      className={
                        selectedHospital?.id ===
                        hospital.id
                          ? "hospital-card selected"
                          : "hospital-card"
                      }
                      onClick={() =>
                        handleHospitalSelect(
                          hospital
                        )
                      }
                    >

                      <div className="hospital-icon">
                        +
                      </div>

                      <div className="hospital-info">

                        <strong>
                          {hospital.name}
                        </strong>

                        <span>
                          {hospital.address ||
                            hospital.location ||
                            "Address unavailable"}
                        </span>

                        {hospital.emergencyAvailable && (
                          <small>
                            Emergency Available
                          </small>
                        )}

                      </div>

                      <div className="radio">
                        {selectedHospital?.id ===
                        hospital.id
                          ? "✓"
                          : ""}
                      </div>

                    </button>

                  )
                )}

              </div>

            )}

          </div>

        </section>

      )}

      {/* =================================================
          DOCTOR
      ================================================= */}

      {selectedHospital && (

        <section className="consult-section">

          <div className="step-number">
            03
          </div>

          <div className="section-content">

            <h2>
              Choose Your Doctor
            </h2>

            <p>
              Select the cardiologist you
              would like to consult at{" "}
              <strong>
                {selectedHospital.name}
              </strong>.
            </p>

            {loadingDoctors ? (

              <div className="loading-state">
                Loading doctors...
              </div>

            ) : doctors.length === 0 ? (

              <div className="empty-state">
                No available cardiologists
                are currently registered
                at this hospital.
              </div>

            ) : (

              <div className="doctor-grid">

                {doctors.map(
                  (doctor) => (

                    <button
                      key={doctor.id}
                      type="button"
                      className={
                        selectedDoctor?.id ===
                        doctor.id
                          ? "doctor-card selected"
                          : "doctor-card"
                      }
                      onClick={() =>
                        handleDoctorSelect(
                          doctor
                        )
                      }
                    >

                      <div className="doctor-avatar">

                        {doctor.name
                          ?.replace(
                            "Dr.",
                            ""
                          )
                          ?.trim()
                          ?.charAt(0)
                          ?.toUpperCase() ||
                          "D"}

                      </div>

                      <div className="doctor-info">

                        <strong>
                          {doctor.name}
                        </strong>

                        <span>
                          {doctor.specialization ||
                            "Cardiologist"}
                        </span>

                        {doctor.experience && (
                          <small>
                            {doctor.experience} years
                            experience
                          </small>
                        )}

                        {doctor.rating && (
                          <small>
                            ★ {doctor.rating}
                          </small>
                        )}

                      </div>

                      <div className="radio">

                        {selectedDoctor?.id ===
                        doctor.id
                          ? "✓"
                          : ""}

                      </div>

                    </button>

                  )
                )}

              </div>

            )}

          </div>

        </section>

      )}

      {/* =================================================
          SUBMIT
      ================================================= */}

      {selectedDoctor && (

        <section className="consult-submit">

          <div>

            <strong>
              Ready to send your request?
            </strong>

            <p>
              Your cardiac assessment report
              will be securely shared with{" "}
              <strong>
                {selectedDoctor.name}
              </strong>.
            </p>

          </div>

          <button
            type="button"
            onClick={
              handleConsultDoctor
            }
            disabled={sending}
          >
            {sending
              ? "Sending..."
              : "Consult Doctor →"}
          </button>

        </section>

      )}

    </div>
  );
}

export default ConsultDoctor;