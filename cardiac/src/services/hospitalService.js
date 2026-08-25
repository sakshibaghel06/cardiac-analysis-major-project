import {
  collection,
  getDocs,
} from "firebase/firestore";

import { db } from "../firebase/firebase";

// =====================================================
// GET ALL HOSPITALS
// =====================================================

export const getAllHospitals = async () => {
  try {
    const hospitalsRef = collection(
      db,
      "hospitals"
    );

    const snapshot = await getDocs(
      hospitalsRef
    );

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  } catch (error) {
    console.error(
      "Error fetching hospitals:",
      error
    );

    throw error;
  }
};

// =====================================================
// NORMALIZE CITY NAME
// =====================================================

const normalizeLocation = (location) => {
  if (!location) return "";

  const value = location
    .toLowerCase()
    .trim();

  // Treat Bengaluru and Bangalore as same city
  if (
    value === "bengaluru" ||
    value === "bangalore"
  ) {
    return "bangalore";
  }

  return value;
};

// =====================================================
// GET HOSPITALS BY LOCATION
// =====================================================

export const getHospitalsByLocation = async (
  location
) => {
  try {
    console.log(
      "Searching hospitals for:",
      location
    );

    const allHospitals =
      await getAllHospitals();

    const normalizedSelectedLocation =
      normalizeLocation(location);

    const filteredHospitals =
      allHospitals.filter((hospital) => {
        const hospitalLocation =
          normalizeLocation(
            hospital.location
          );

        return (
          hospitalLocation ===
          normalizedSelectedLocation
        );
      });

    console.log(
      "Hospitals found:",
      filteredHospitals
    );

    return filteredHospitals;
  } catch (error) {
    console.error(
      "Error fetching hospitals by location:",
      error
    );

    throw error;
  }
};