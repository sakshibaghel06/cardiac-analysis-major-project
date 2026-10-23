import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getAllHospitals } from "../services/hospitalService";

/*
=====================================================
EMERGENCY INFORMATION
=====================================================

Shown for a high-risk result, or when the patient reports
symptoms that need urgent attention.

What this screen is careful NOT to do:

  - it does not say "you are having a heart attack"
  - it does not diagnose an emergency from the ML output
  - it does not present itself as an emergency service

The model is a screening tool. Acute symptoms need
emergency services whatever the model said, and a low
model score is never a reason to delay calling for help.

Hospitals come from Firestore. Nothing here is hardcoded
except the UI labels.
=====================================================
*/

function Emergency() {
  const navigate = useNavigate();

  const [hospitals, setHospitals] = useState([]);
  const [city, setCity] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchHospitals = useCallback(() => getAllHospitals(), []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const all = await fetchHospitals();

        if (!cancelled) setHospitals(all);
      } catch (loadError) {
        if (cancelled) return;

        console.error(loadError);

        setError(
          "Could not load hospital information. If this is urgent, call " +
            "your local emergency number now rather than waiting."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchHospitals]);

  const cities = [
    ...new Set(hospitals.map((hospital) => hospital.location).filter(Boolean)),
  ].sort();

  const visible = city
    ? hospitals.filter((hospital) => hospital.location === city)
    : hospitals;

  return (
    <div className="emergency-page">
      <div className="emergency-shell">
        {/* ==========================================
            THE WARNING
        ========================================== */}

        <section className="emergency-banner" role="alert">
          <h1>Get medical help now if this is urgent</h1>

          <p>
            If you have severe chest pain or pressure, difficulty breathing
            at rest, fainting, or pain spreading to your arm, jaw, neck or
            back, contact your local emergency services immediately.
          </p>

          <p className="emergency-strong">
            Do not wait for this app, and do not use a screening result to
            decide whether to seek help.
          </p>

          <a className="emergency-call" href="tel:112">
            Call Emergency Services
          </a>

          <p className="emergency-note">
            In India dial <strong>112</strong> (all emergencies) or{" "}
            <strong>108</strong> (ambulance). If you are elsewhere, use your
            local emergency number.
          </p>
        </section>

        {/* ==========================================
            WHAT THIS APP IS NOT
        ========================================== */}

        <section className="emergency-card emergency-scope">
          <h2>What CardioCare can and cannot do</h2>

          <p>
            CardioCare is a screening and decision-support tool. It is{" "}
            <strong>not</strong> an emergency medical service, it cannot
            dispatch an ambulance, and it cannot diagnose a heart attack.
          </p>

          <p>
            A risk estimate is based only on the values you typed in. It does
            not know how you feel right now.
          </p>
        </section>

        {/* ==========================================
            HOSPITALS
        ========================================== */}

        <section className="emergency-card">
          <h2>Hospitals</h2>

          {loading ? (
            <p className="emergency-muted">Loading hospitals...</p>
          ) : error ? (
            <div className="emergency-error">{error}</div>
          ) : hospitals.length === 0 ? (
            <p className="emergency-muted">
              No hospitals are listed yet. Please use your local emergency
              number or search for the nearest emergency department.
            </p>
          ) : (
            <>
              {cities.length > 1 && (
                <div className="emergency-filter">
                  <label htmlFor="emergency-city">Filter by city</label>

                  <select
                    id="emergency-city"
                    value={city}
                    onChange={(event) => setCity(event.target.value)}
                  >
                    <option value="">All cities</option>

                    {cities.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <ul className="emergency-hospitals">
                {visible.map((hospital) => (
                  <li key={hospital.id}>
                    <div>
                      <h3>{hospital.name}</h3>

                      {hospital.address && <p>{hospital.address}</p>}

                      {hospital.location && (
                        <p className="emergency-muted">{hospital.location}</p>
                      )}
                    </div>

                    <div className="emergency-hospital-actions">
                      {hospital.phone && (
                        <a href={`tel:${hospital.phone}`}>
                          Call {hospital.phone}
                        </a>
                      )}

                      {/*
                        Uses a plain maps search rather than the Places
                        API - no extra key, no extra dependency, and it
                        works on every device.
                      */}
                      <a
                        href={
                          hospital.latitude && hospital.longitude
                            ? `https://www.google.com/maps/search/?api=1&query=${hospital.latitude},${hospital.longitude}`
                            : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                                `${hospital.name} ${hospital.location || ""}`
                              )}`
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        Directions
                      </a>
                    </div>
                  </li>
                ))}
              </ul>

              {visible.length === 0 && (
                <p className="emergency-muted">
                  No hospitals listed for {city}.
                </p>
              )}
            </>
          )}
        </section>

        <div className="emergency-actions">
          <button
            className="emergency-secondary"
            onClick={() => navigate("/patient/dashboard")}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}

export default Emergency;
