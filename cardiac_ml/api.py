from fastapi import FastAPI
from pydantic import BaseModel
import joblib
import uvicorn

app = FastAPI()

model = joblib.load("model.pkl")


class Patient(BaseModel):
    age: float
    sex: float
    cp: float
    trestbps: float
    chol: float
    fbs: float
    restecg: float
    thalach: float
    exang: float
    oldpeak: float
    slope: float
    ca: float
    thal: float


@app.post("/predict")
def predict(patient: Patient):

    data = [[
        patient.age,
        patient.sex,
        patient.cp,
        patient.trestbps,
        patient.chol,
        patient.fbs,
        patient.restecg,
        patient.thalach,
        patient.exang,
        patient.oldpeak,
        patient.slope,
        patient.ca,
        patient.thal
    ]]

    prediction = model.predict(data)[0]

    risk = "HIGH" if prediction == 1 else "LOW"

    return {
        "risk": risk
    }


if __name__ == "__main__":
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000
    )