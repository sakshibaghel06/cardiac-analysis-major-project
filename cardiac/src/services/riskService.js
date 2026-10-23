import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "../firebase/firebase";

/*
=====================================================
RISK ASSESSMENT SERVICE
=====================================================

Stores the EXACT values that were sent to the model,
alongside the result the model returned.

Previously this saved a different shape from the one
the API received (raw blood sugar instead of the 0/1
flag, chest pain 0-3 instead of 1-4), so the record a
doctor reviewed did not match the inputs behind the
prediction. They are now the same object.

createConsultationRequest used to live here as well,
duplicating the copy in consultationService.js. The
duplicate has been removed - consultationService is
the single owner of consultation requests.
=====================================================
*/

export const saveRiskData = async ({
  features,
  answers,
  result,
  emergencySymptoms = [],
}) => {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("You must be signed in to save an assessment.");
  }

  const record = {
    uid: user.uid,

    // Exactly what the model received.
    features,

    // The human-readable answers behind those features,
    // so a doctor can see what the patient actually reported.
    answers,

    // Exactly what the model returned.
    risk: result.risk,
    probability: result.probability,
    prediction: result.prediction,
    modelType: result.modelType,
    modelVersion: result.modelVersion,
    thresholds: result.thresholds,

    // Reported separately - these are NOT model inputs.
    emergencySymptoms,

    createdAt: serverTimestamp(),
  };

  const docRef = await addDoc(collection(db, "risk_assessments"), record);

  return docRef.id;
};

/*
Returns this patient's own assessments, newest first.

The previous version called getDocs() on the WHOLE
risk_assessments collection and filtered by uid in the
browser. That downloaded every patient's medical data to
every client, and would fail outright once security rules
are enforced. It now queries by uid so the database only
ever returns this user's records.

Sorting is done client-side deliberately: combining
where() with orderBy() on a different field would require
a composite Firestore index, and the result sets here are
small.
*/
export const getRiskHistory = async () => {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("You must be signed in to view your assessments.");
  }

  const snapshot = await getDocs(
    query(
      collection(db, "risk_assessments"),
      where("uid", "==", user.uid)
    )
  );

  const records = snapshot.docs.map((docSnapshot) => ({
    id: docSnapshot.id,
    ...docSnapshot.data(),
  }));

  const toMillis = (value) => {
    if (!value) return 0;
    if (typeof value.toMillis === "function") return value.toMillis();
    return new Date(value).getTime() || 0;
  };

  records.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

  return records;
};

/*
Reads one patient's assessments on behalf of a DOCTOR.

Access is governed by Firestore rules: a doctor may only
read assessments belonging to a patient who has an
accepted consultation with them.
*/
export const getRiskHistoryForPatient = async (patientId) => {
  if (!patientId) return [];

  const snapshot = await getDocs(
    query(
      collection(db, "risk_assessments"),
      where("uid", "==", patientId)
    )
  );

  return snapshot.docs.map((docSnapshot) => ({
    id: docSnapshot.id,
    ...docSnapshot.data(),
  }));
};
