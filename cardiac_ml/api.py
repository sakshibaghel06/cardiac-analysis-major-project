"""
=====================================================================
CardioCare - prediction API
=====================================================================

Serves the Random Forest pipeline trained by train_model.py.

Run:
    uvicorn api:app --reload --host 127.0.0.1 --port 8001
or:
    python api.py

There used to be a second file, app.py, that also bound port 8000 but
returned a hardcoded age rule instead of using the model. It has been
deleted. This is now the only prediction service.

Endpoints
    GET  /health     liveness + which model is loaded
    GET  /model      feature schema, thresholds, dataset provenance
    POST /predict    risk assessment
=====================================================================
"""

import json
import os
from pathlib import Path

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

HERE = Path(__file__).parent
MODEL_PATH = HERE / "model.pkl"
META_PATH = HERE / "model_meta.json"

# ---------------------------------------------------------------------
# LOAD MODEL
# ---------------------------------------------------------------------

if not MODEL_PATH.exists() or not META_PATH.exists():
    raise SystemExit(
        "model.pkl / model_meta.json not found. Run:  python train_model.py"
    )

model = joblib.load(MODEL_PATH)
meta = json.loads(META_PATH.read_text(encoding="utf-8"))

FEATURES = meta["features"]
THRESHOLDS = meta["risk_thresholds"]

app = FastAPI(
    title="CardioCare Prediction API",
    version="2.0.0",
    description="Cardiovascular risk screening. Not a diagnostic device.",
)

# ---------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------
#
# The browser calls this API directly from the React app, so CORS is
# mandatory. The previous api.py had no CORS middleware at all, which
# is why every call from the frontend failed and the fake app.py ended
# up being used instead.

allowed_origins = os.environ.get(
    "CARDIAC_ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,"
    "http://localhost:5174,http://127.0.0.1:5174,"
    "https://localhost:5173",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in allowed_origins if origin.strip()],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------
# REQUEST SCHEMA
# ---------------------------------------------------------------------
#
# Ranges are enforced here as well as in the UI. A user cannot bypass
# the form validation by calling the API directly, and out-of-range
# values never silently reach the model.

class PatientInput(BaseModel):
    age: int = Field(..., ge=18, le=120, description="Years")

    sex: int = Field(..., ge=0, le=1, description="1 = male, 0 = female")

    cp: int = Field(
        ..., ge=1, le=4,
        description="1 typical angina, 2 atypical angina, "
                    "3 non-anginal pain, 4 asymptomatic",
    )

    trestbps: int = Field(
        ..., ge=70, le=250, description="Resting systolic BP, mm Hg"
    )

    chol: int = Field(
        ..., ge=100, le=600, description="Serum cholesterol, mg/dl"
    )

    fbs: int = Field(
        ..., ge=0, le=1,
        description="1 if fasting blood sugar > 120 mg/dl, else 0",
    )

    restecg: int = Field(
        ..., ge=0, le=2,
        description="0 normal, 1 ST-T abnormality, 2 left ventricular hypertrophy",
    )

    thalach: int = Field(
        ..., ge=60, le=230, description="Maximum heart rate achieved, bpm"
    )

    exang: int = Field(
        ..., ge=0, le=1, description="1 = exercise-induced angina"
    )


class RiskResponse(BaseModel):
    risk: str
    probability: float
    prediction: int
    thresholds: dict
    modelType: str
    modelVersion: str
    disclaimer: str


DISCLAIMER = (
    "This is an automated screening estimate produced by a machine "
    "learning model trained on the UCI Heart Disease (Cleveland) "
    "dataset. It is not a medical diagnosis and cannot rule heart "
    "disease in or out. Discuss any concerns with a qualified doctor. "
    "If you have severe chest pain, difficulty breathing, fainting or "
    "other emergency symptoms, contact your local emergency services "
    "immediately."
)


# ---------------------------------------------------------------------
# RISK BAND
# ---------------------------------------------------------------------

def band_for(probability: float) -> str:
    """
    Map the model probability onto Low / Moderate / High.

    The thresholds were measured in train_model.py from out-of-fold
    predictions - see derive_risk_thresholds() there and
    FEATURE_ANALYSIS.md for the reasoning. They are not hand-picked.
    """
    if probability < THRESHOLDS["low_max"]:
        return "LOW"

    if probability < THRESHOLDS["high_min"]:
        return "MODERATE"

    return "HIGH"


# ---------------------------------------------------------------------
# ENDPOINTS
# ---------------------------------------------------------------------

@app.get("/health")
def health():
    return {
        "status": "ok",
        "modelLoaded": True,
        "modelType": meta["model_type"],
        "features": FEATURES,
    }


@app.get("/model")
def model_info():
    """Schema and provenance - lets the frontend stay in sync."""
    return meta


@app.post("/predict", response_model=RiskResponse)
def predict(patient: PatientInput):
    try:
        # Column ORDER and NAMES must match training exactly. Building
        # the frame from the metadata feature list guarantees that,
        # rather than relying on the order of a hand-written list.
        payload = patient.model_dump()

        frame = pd.DataFrame([[payload[name] for name in FEATURES]], columns=FEATURES)

        probability = float(model.predict_proba(frame)[0][1])
        prediction = int(model.predict(frame)[0])

    except Exception as error:  # noqa: BLE001
        raise HTTPException(
            status_code=500,
            detail=f"Prediction failed: {error}",
        ) from error

    return RiskResponse(
        risk=band_for(probability),
        probability=round(probability, 4),
        prediction=prediction,
        thresholds=THRESHOLDS,
        modelType=meta["model_type"],
        modelVersion=app.version,
        disclaimer=DISCLAIMER,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8001)
