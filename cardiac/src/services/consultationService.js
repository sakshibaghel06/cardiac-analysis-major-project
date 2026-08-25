import {
  collection,
  addDoc,
  serverTimestamp,
  doc,
  updateDoc,
  getDoc,
} from "firebase/firestore";

import { db } from "../firebase/firebase";


// =====================================================
// CREATE CONSULTATION REQUEST
// =====================================================

export const createConsultationRequest = async ({
  patientId,
  patientEmail,
  patientName,

  doctorId,
  doctorName,
  doctorEmail,

  hospitalId,
  hospitalName,

  city,

  risk,
  report,
}) => {

  if (!patientId) {
    throw new Error(
      "Patient is not logged in."
    );
  }

  if (!doctorId) {
    throw new Error(
      "Please select a doctor."
    );
  }

  const requestData = {

    // =================================================
    // PATIENT
    // =================================================

    patientId:
      patientId,

    patientEmail:
      patientEmail || "",

    patientName:
      patientName || "Patient",


    // =================================================
    // DOCTOR
    // =================================================

    doctorId:
      doctorId,

    doctorName:
      doctorName || "",

    doctorEmail:
      doctorEmail || "",


    // =================================================
    // HOSPITAL
    // =================================================

    hospitalId:
      hospitalId || "",

    hospitalName:
      hospitalName || "",


    // =================================================
    // CITY
    // =================================================

    city:
      city || "",


    // =================================================
    // AI CARDIAC RESULT
    // =================================================

    risk:
      risk || "",

    report:
      report || {},


    // =================================================
    // CONSULTATION STATUS
    // =================================================

    status:
      "pending",


    // =================================================
    // TIMESTAMP
    // =================================================

    createdAt:
      serverTimestamp(),

  };


  const requestRef =
    await addDoc(
      collection(
        db,
        "consultation_requests"
      ),
      requestData
    );


  console.log(
    "Consultation created:",
    requestRef.id
  );


  return requestRef.id;
};


// =====================================================
// UPDATE CONSULTATION STATUS
// =====================================================

export const updateConsultationStatus =
  async (
    requestId,
    status
  ) => {

    if (!requestId) {
      throw new Error(
        "Consultation request ID is missing."
      );
    }

    const requestRef =
      doc(
        db,
        "consultation_requests",
        requestId
      );

    await updateDoc(
      requestRef,
      {
        status:
          status,

        updatedAt:
          serverTimestamp(),
      }
    );
  };


// =====================================================
// GET ONE CONSULTATION REQUEST
// =====================================================

export const getConsultationRequest =
  async (
    requestId
  ) => {

    if (!requestId) {
      return null;
    }

    const requestRef =
      doc(
        db,
        "consultation_requests",
        requestId
      );

    const snapshot =
      await getDoc(
        requestRef
      );

    if (!snapshot.exists()) {
      return null;
    }

    return {
      id:
        snapshot.id,

      ...snapshot.data(),
    };
  };