import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { saveRiskData } from "../services/riskService";

function RiskAssessment() {
  const navigate = useNavigate();

  const [formData, setFormData] =
    useState({
      age: "",
      gender: "",
      chestPain: "",
      bloodPressure: "",
      cholesterol: "",
      bloodSugar: "",
      heartRate: "",
      ecg: "",
      exerciseAngina: "",
    });

  const [loading, setLoading] =
    useState(false);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      setLoading(true);

      const requestData = {
        age: Number(formData.age),

        sex: Number(
          formData.gender
        ),

        cp: Number(
          formData.chestPain
        ),

        trestbps: Number(
          formData.bloodPressure
        ),

        chol: Number(
          formData.cholesterol
        ),

        fbs: Number(
          formData.bloodSugar
        ),

        restecg: Number(
          formData.ecg
        ),

        thalach: Number(
          formData.heartRate
        ),

        exang: Number(
          formData.exerciseAngina
        ),

        oldpeak: 2.3,

        slope: 0,

        ca: 0,

        thal: 1,
      };

      const response = await fetch(
        "http://127.0.0.1:8000/predict",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify(
            requestData
          ),
        }
      );

      if (!response.ok) {
        throw new Error(
          "Prediction failed."
        );
      }

      const result =
        await response.json();

      // Save complete report
      await saveRiskData(
        formData,
        result.risk
      );

      // Open report page
      navigate("/result", {
        state: {
          risk: result.risk,
        },
      });

    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="risk-container">
      <div className="risk-card">

        <div className="risk-header">
          <span className="small-title">
            CARDIOCARE
          </span>

          <h1>
            Cardiac Risk Assessment
          </h1>

          <p>
            Enter your health information
            to generate your cardiac risk
            report.
          </p>
        </div>

        <form
          className="risk-form"
          onSubmit={handleSubmit}
        >

          <input
            type="number"
            name="age"
            placeholder="Age"
            required
            onChange={handleChange}
          />

          <select
            name="gender"
            required
            onChange={handleChange}
          >
            <option value="">
              Select Gender
            </option>

            <option value="0">
              Female
            </option>

            <option value="1">
              Male
            </option>
          </select>

          <select
            name="chestPain"
            required
            onChange={handleChange}
          >
            <option value="">
              Chest Pain Type
            </option>

            <option value="0">
              Typical Angina
            </option>

            <option value="1">
              Atypical Angina
            </option>

            <option value="2">
              Non-anginal Pain
            </option>

            <option value="3">
              Asymptomatic
            </option>
          </select>

          <input
            type="number"
            name="bloodPressure"
            placeholder="Resting Blood Pressure"
            required
            onChange={handleChange}
          />

          <input
            type="number"
            name="cholesterol"
            placeholder="Cholesterol"
            required
            onChange={handleChange}
          />

          <input
            type="number"
            name="bloodSugar"
            placeholder="Blood Sugar"
            required
            onChange={handleChange}
          />

          <input
            type="number"
            name="heartRate"
            placeholder="Maximum Heart Rate"
            required
            onChange={handleChange}
          />

          <select
            name="ecg"
            required
            onChange={handleChange}
          >
            <option value="">
              ECG Result
            </option>

            <option value="0">
              Normal
            </option>

            <option value="1">
              ST-T Wave Abnormality
            </option>

            <option value="2">
              Left Ventricular Hypertrophy
            </option>
          </select>

          <select
            name="exerciseAngina"
            required
            onChange={handleChange}
          >
            <option value="">
              Exercise-Induced Angina
            </option>

            <option value="0">
              No
            </option>

            <option value="1">
              Yes
            </option>
          </select>

          <button
            type="submit"
            disabled={loading}
          >
            {loading
              ? "Analyzing..."
              : "Generate Health Report"}
          </button>

        </form>

      </div>
    </div>
  );
}

export default RiskAssessment;