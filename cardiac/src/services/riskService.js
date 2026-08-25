import {
  collection,
  addDoc,
  getDocs,
} from "firebase/firestore";

import { auth, db } from "../firebase/firebase";


// Save complete risk assessment
export const saveRiskData = async (formData, risk) => {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("User is not logged in.");
  }

  const docData = {
    uid: user.uid,

    age: Number(formData.age),
    gender: Number(formData.gender),
    chestPain: Number(formData.chestPain),
    bloodPressure: Number(formData.bloodPressure),
    cholesterol: Number(formData.cholesterol),
    bloodSugar: Number(formData.bloodSugar),
    heartRate: Number(formData.heartRate),
    ecg: Number(formData.ecg),
    exerciseAngina: Number(
      formData.exerciseAngina
    ),

    risk: risk,

    createdAt: new Date(),
  };

  const docRef = await addDoc(
    collection(db, "risk_assessments"),
    docData
  );

  return docRef.id;
};


// Get patient's previous risk assessments
export const getRiskHistory = async () => {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("User is not logged in.");
  }

  const snapshot = await getDocs(
    collection(db, "risk_assessments")
  );

  const records = [];

  snapshot.forEach((doc) => {
    const data = doc.data();

    if (data.uid === user.uid) {
      records.push({
        id: doc.id,
        ...data,
      });
    }
  });

  // Newest first
  records.sort((a, b) => {
    const dateA =
      a.createdAt?.toDate?.() ||
      new Date(a.createdAt);

    const dateB =
      b.createdAt?.toDate?.() ||
      new Date(b.createdAt);

    return dateB - dateA;
  });

  return records;
};


// Send consultation request to doctor
export const createConsultationRequest = async (
  report
) => {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("User is not logged in.");
  }

  const request = {
    patientId: user.uid,

    patientEmail:
      user.email || "",

    risk: report.risk,

    report: {
      age: report.age,
      gender: report.gender,
      chestPain: report.chestPain,
      bloodPressure:
        report.bloodPressure,
      cholesterol:
        report.cholesterol,
      bloodSugar:
        report.bloodSugar,
      heartRate:
        report.heartRate,
      ecg: report.ecg,
      exerciseAngina:
        report.exerciseAngina,
    },

    status: "pending",

    requestedAt: new Date(),
  };

  const docRef = await addDoc(
    collection(db, "consultation_requests"),
    request
  );

  return docRef.id;
};