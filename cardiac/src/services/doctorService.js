import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";

import { doc, getDoc } from "firebase/firestore";

import { db } from "../firebase/firebase";

/*
====================================================
DOCTOR IDENTITY
====================================================

A Firebase Auth uid is 28 characters of [A-Za-z0-9].
An auto-generated Firestore document id is 20.

That distinction matters because the doctors collection
was populated inconsistently: some documents are keyed
by the doctor's Auth uid, others by an auto id. Only the
uid-keyed ones can ever be matched to a signed-in doctor.

The authoritative link is the `uid` FIELD. The document
id is only trusted when it is already uid-shaped.
*/

export const isAuthUid = (id) =>
  typeof id === "string" && /^[A-Za-z0-9]{28}$/.test(id);

/*
The uid to use when referring to this doctor from a
consultation request, a care link or a security rule.
Returns null when the record has no Auth account behind
it, which means no one can log in as that doctor.
*/
export const doctorUidOf = (doctor) => {
  if (!doctor) return null;
  if (doctor.uid) return doctor.uid;
  if (isAuthUid(doctor.id)) return doctor.id;
  return null;
};

/*
====================================================
GET DOCTOR PROFILE
====================================================

Resolution order:

  1. doctors/{uid}            - the intended convention
  2. where uid == <uid>       - explicitly linked record
  3. where email == <email>   - legacy records

Looking up by uid first means a doctor whose document is
correctly keyed costs one read instead of a query, and
works even if their email changes.
*/

export const getDoctorProfile = async (uid, email) => {
  try {
    // 1. direct hit on the conventional path
    if (uid) {
      const direct = await getDoc(doc(db, "doctors", uid));

      if (direct.exists()) {
        return { id: direct.id, ...direct.data() };
      }

      // 2. explicitly linked via the uid field
      const linked = await getDocs(
        query(collection(db, "doctors"), where("uid", "==", uid))
      );

      if (!linked.empty) {
        return { id: linked.docs[0].id, ...linked.docs[0].data() };
      }
    }

    // 3. legacy: match on email
    if (email) {
      const byEmail = await getDocs(
        query(collection(db, "doctors"), where("email", "==", email))
      );

      if (!byEmail.empty) {
        return { id: byEmail.docs[0].id, ...byEmail.docs[0].data() };
      }
    }

    return null;
  } catch (error) {
    console.error("Error fetching doctor profile:", error);

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

/*
====================================================
DOCTOR WORKSPACE DATA
====================================================

Everything the doctor dashboard renders, fetched from
Firestore. No counts are typed in - every number shown
is derived from the documents actually returned.

Access model: a doctor reaches a patient ONLY through a
consultation request naming them, and a care link created
when they accept. There is no query anywhere that returns
"all patients".
====================================================
*/

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  return new Date(value).getTime() || 0;
};

const newestFirst = (a, b) => toMillis(b.createdAt) - toMillis(a.createdAt);

/*
Every consultation request addressed to this doctor.
Status is lowercased on read because some legacy records
were written as "PENDING", which the dashboard's
status === "pending" filter silently ignored.
*/
export const getDoctorConsultations = async (doctorUid) => {
  if (!doctorUid) return [];

  const snapshot = await getDocs(
    query(
      collection(db, "consultation_requests"),
      where("doctorId", "==", doctorUid)
    )
  );

  return snapshot.docs
    .map((docSnapshot) => {
      const data = docSnapshot.data();

      return {
        id: docSnapshot.id,
        ...data,
        status: String(data.status || "pending").toLowerCase(),
      };
    })
    .sort(newestFirst);
};

/*
The doctor's patient list, derived from their own
consultations rather than from a patients collection -
which is why a doctor can never see an unrelated patient.

One entry per patient, carrying their most recent
consultation and how many they have had.
*/
export const getDoctorPatients = (consultations) => {
  const byPatient = new Map();

  consultations.forEach((consultation) => {
    const key = consultation.patientId;

    if (!key) return;

    const existing = byPatient.get(key);

    if (!existing) {
      byPatient.set(key, {
        patientId: key,
        name: consultation.patientName || "Patient",
        email: consultation.patientEmail || "",
        latestRisk: consultation.risk || null,
        latestStatus: consultation.status,
        latestAt: consultation.createdAt,
        total: 1,
        // Only an accepted consultation grants access to records.
        hasAccess: ["accepted", "completed"].includes(consultation.status),
      });

      return;
    }

    existing.total += 1;

    if (["accepted", "completed"].includes(consultation.status)) {
      existing.hasAccess = true;
    }

    // consultations arrive newest-first, so the first one wins.
  });

  return [...byPatient.values()];
};

/*
Prescriptions this doctor has issued.
*/
export const getDoctorPrescriptions = async (doctorUid) => {
  if (!doctorUid) return [];

  const snapshot = await getDocs(
    query(collection(db, "prescriptions"), where("doctorId", "==", doctorUid))
  );

  return snapshot.docs
    .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
    .sort(newestFirst);
};

/*
Risk assessments belonging to this doctor's patients.

Read one patient at a time rather than as a single query,
because the security rules authorise per patient via a
care link - there is no query that could return them all.

A refusal for one patient is not an error: it means the
care link is gone, so that patient is skipped.
*/
export const getDoctorRiskAssessments = async (patientIds) => {
  const results = await Promise.all(
    patientIds.map(async (patientId) => {
      try {
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
      } catch {
        return [];
      }
    })
  );

  return results.flat().sort(newestFirst);
};
