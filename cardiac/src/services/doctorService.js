import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";

import { db } from "../firebase/firebase";

/*
====================================================
GET DOCTOR PROFILE
====================================================

The logged-in Firebase doctor gives us their email.

We search Firestore:
doctors
   ↓
email
   ↓
doctor profile
*/

export const getDoctorProfile = async (email) => {
  try {
    const doctorsRef = collection(db, "doctors");

    const q = query(
      doctorsRef,
      where("email", "==", email)
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return null;
    }

    const doctorDoc = snapshot.docs[0];

    return {
      id: doctorDoc.id,
      ...doctorDoc.data(),
    };
  } catch (error) {
    console.error(
      "Error fetching doctor profile:",
      error
    );

    throw error;
  }
};


/*
====================================================
GET DOCTOR CONSULTATION REQUESTS
====================================================

Every consultation request should contain:

doctorId

The doctor's Firebase Authentication UID.

Example:

{
  doctorId: "abc123",
  patientName: "Patient",
  patientEmail: "...",
  risk: "MEDIUM",
  status: "pending"
}

We use doctorId so every doctor
only sees THEIR requests.
*/

export const getDoctorRequests = async (
  doctorId
) => {
  try {
    const requestsRef = collection(
      db,
      "consultation_requests"
    );

    const q = query(
      requestsRef,
      where("doctorId", "==", doctorId)
    );

    const snapshot = await getDocs(q);

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  } catch (error) {
    console.error(
      "Error fetching doctor requests:",
      error
    );

    throw error;
  }
};


/*
====================================================
GET ALL DOCTORS
====================================================

Used later for the patient side.

Patient:
City
 ↓
Hospital
 ↓
Doctor
*/

export const getAllDoctors = async () => {
  try {
    const doctorsRef = collection(
      db,
      "doctors"
    );

    const snapshot =
      await getDocs(doctorsRef);

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  } catch (error) {
    console.error(
      "Error fetching doctors:",
      error
    );

    throw error;
  }
};


/*
====================================================
GET DOCTORS BY HOSPITAL
====================================================
*/

export const getDoctorsByHospital = async (
  hospitalId
) => {
  try {
    const doctorsRef = collection(
      db,
      "doctors"
    );

    const q = query(
      doctorsRef,
      where(
        "hospitalId",
        "==",
        hospitalId
      )
    );

    const snapshot =
      await getDocs(q);

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  } catch (error) {
    console.error(
      "Error fetching hospital doctors:",
      error
    );

    throw error;
  }
};


/*
====================================================
GET DOCTORS BY CITY
====================================================
*/

export const getDoctorsByCity = async (
  city
) => {
  try {
    const doctorsRef = collection(
      db,
      "doctors"
    );

    const q = query(
      doctorsRef,
      where(
        "location",
        "==",
        city
      )
    );

    const snapshot =
      await getDocs(q);

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  } catch (error) {
    console.error(
      "Error fetching doctors by city:",
      error
    );

    throw error;
  }
};