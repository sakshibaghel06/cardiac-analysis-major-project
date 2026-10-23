import {
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { auth, db } from "../firebase/firebase";

/*
=====================================================
PRESCRIPTION SERVICE
=====================================================

WHY THE QUERIES LOOK REDUNDANT
------------------------------
Every read here filters on the caller's OWN id as well as
the thing it is actually looking for. That is not
belt-and-braces, it is required.

Firestore security rules are NOT filters. For a list
query, Firestore must prove from the QUERY ALONE that
every document it could return satisfies the rule - it
does not fetch documents and then discard the ones the
rule rejects.

So with a rule keyed on patientId/doctorId, this:

    where("requestId", "==", id)

is DENIED even when the only matching document belongs to
the caller, because nothing in the query mentions
patientId or doctorId. That denial surfaced in the app as
"You do not have access to this prescription."

Adding the ownership constraint makes the query provably
safe. It does not widen access - the rule is unchanged,
and a patient filtering on someone else's id is still
refused. See tests/repro_prescription_access.mjs.

These compound queries need composite indexes; they are
declared in firestore.indexes.json.

DRAFT vs ISSUED
---------------
A prescription is written as a draft, then explicitly
issued. Only the issuing doctor sees a draft. Nothing is
shown to the patient as ready until the doctor has said
so, which is what stops a half-written prescription
appearing as if it were final.
=====================================================
*/

export const PRESCRIPTION_STATUS = {
  DRAFT: "draft",
  ISSUED: "issued",
};

export const EMPTY_MEDICINE = {
  name: "",
  dosage: "",
  frequency: "",
  duration: "",
  instructions: "",
};

const requireUser = () => {
  const user = auth.currentUser;

  if (!user) throw new Error("You must be signed in.");

  return user;
};

const byNewest = (a, b) =>
  (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0);

const shape = (snapshot) => ({ id: snapshot.id, ...snapshot.data() });

// -----------------------------------------------------
// VALIDATION
// -----------------------------------------------------

/*
Structural only. It checks the doctor filled the fields
in; it never judges whether a drug or a dose is
clinically appropriate. That is the doctor's
responsibility and nothing here second-guesses it.
*/
export const validatePrescription = ({ medicines, diagnosis }) => {
  const errors = {};

  if (!diagnosis || !diagnosis.trim()) {
    errors.diagnosis = "Enter a diagnosis or clinical assessment.";
  }

  const medicineErrors = medicines.map((medicine) => {
    const rowErrors = {};

    const hasAnything = Object.values(medicine).some(
      (value) => value && value.trim()
    );

    // A completely blank row is ignored, not an error.
    if (!hasAnything) return rowErrors;

    if (!medicine.name.trim()) rowErrors.name = "Required";
    if (!medicine.dosage.trim()) rowErrors.dosage = "Required";
    if (!medicine.frequency.trim()) rowErrors.frequency = "Required";
    if (!medicine.duration.trim()) rowErrors.duration = "Required";

    return rowErrors;
  });

  if (medicineErrors.some((row) => Object.keys(row).length > 0)) {
    errors.medicines = medicineErrors;
  }

  return errors;
};

const cleanMedicines = (medicines) =>
  medicines
    .filter((medicine) =>
      Object.values(medicine).some((value) => value && value.trim())
    )
    .map((medicine) => ({
      name: medicine.name.trim(),
      dosage: medicine.dosage.trim(),
      frequency: medicine.frequency.trim(),
      duration: medicine.duration.trim(),
      instructions: (medicine.instructions || "").trim(),
    }));

// -----------------------------------------------------
// WRITE  -  doctor only
// -----------------------------------------------------

const buildPayload = ({
  requestId,
  patientId,
  patientName,
  medicines,
  diagnosis,
  notes,
  precautions,
  followUp,
  doctorProfile,
  user,
  status,
}) => ({
  requestId,
  patientId,
  patientName: patientName || "",

  doctorId: user.uid,
  doctorEmail: user.email || "",

  /*
    The doctor's professional details are COPIED onto the
    prescription rather than looked up when it is read.

    A prescription records what was issued on the day it was
    issued: if the doctor later changes hospital, an old
    prescription must still show who they were at the time.
    It also means the patient can render the PDF without read
    access to the doctors collection.
  */
  doctorName: doctorProfile?.name || "",
  doctorSpecialization: doctorProfile?.specialization || "",
  doctorHospital: doctorProfile?.hospitalName || "",

  diagnosis: diagnosis.trim(),
  notes: (notes || "").trim(),
  precautions: (precautions || "").trim(),
  followUp: (followUp || "").trim(),
  medicines: cleanMedicines(medicines),

  status,
});

/*
Creates a draft, or issues straight away.

`issue: true` is the doctor's explicit act of putting their
name to it, and is the only thing that makes a prescription
visible to the patient.
*/
export const savePrescription = async ({ issue = false, ...fields }) => {
  const user = requireUser();

  if (!fields.requestId) throw new Error("Consultation reference is missing.");

  const status = issue
    ? PRESCRIPTION_STATUS.ISSUED
    : PRESCRIPTION_STATUS.DRAFT;

  const payload = buildPayload({ ...fields, user, status });

  const existing = fields.prescriptionId
    ? doc(db, "prescriptions", fields.prescriptionId)
    : null;

  if (existing) {
    const current = await getDoc(existing);

    if (current.exists() && current.data().status === PRESCRIPTION_STATUS.ISSUED) {
      /*
        An issued prescription is a record of what the patient
        was told. Silently rewriting it would make the PDF they
        already downloaded disagree with the database.
      */
      throw new Error(
        "This prescription has already been issued and cannot be rewritten."
      );
    }

    await updateDoc(existing, {
      ...payload,
      ...(issue ? { issuedAt: serverTimestamp() } : {}),
      updatedAt: serverTimestamp(),
    });

    return fields.prescriptionId;
  }

  const created = await addDoc(collection(db, "prescriptions"), {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...(issue ? { issuedAt: serverTimestamp() } : {}),
  });

  return created.id;
};

// -----------------------------------------------------
// READ
// -----------------------------------------------------

/*
The prescription for one consultation.

`role` decides which ownership field constrains the query -
see the note at the top of this file for why one is
required at all.
*/
const patientConstraints = (user) => [
  where("patientId", "==", user.uid),
  /*
    `unlocked` is named in the query, not only in the rule.

    Firestore evaluates rules per document for a list query, and one
    row that fails kills the whole query. A patient with a single
    unpaid prescription was therefore denied EVERY prescription -
    which is what emptied their dashboard.

    Naming it here makes the query provably safe, and locked rows
    are simply not returned.
  */
  where("unlocked", "==", true),
];

const doctorConstraints = (user) => [where("doctorId", "==", user.uid)];

export const getPrescriptionsForRequest = async (requestId, role) => {
  if (!requestId) return [];

  const user = requireUser();

  const snapshot = await getDocs(
    query(
      collection(db, "prescriptions"),
      where("requestId", "==", requestId),
      ...(role === "doctor" ? doctorConstraints(user) : patientConstraints(user))
    )
  );

  return snapshot.docs.map(shape).sort(byNewest);
};

/* Live version, so a patient waiting on their doctor sees it
   appear without refreshing. */
export const watchPrescriptionsForRequest = (requestId, role, onChange, onError) => {
  const user = auth.currentUser;

  if (!requestId || !user) return () => {};

  return onSnapshot(
    query(
      collection(db, "prescriptions"),
      where("requestId", "==", requestId),
      ...(role === "doctor" ? doctorConstraints(user) : patientConstraints(user))
    ),
    (snapshot) => onChange(snapshot.docs.map(shape).sort(byNewest)),
    onError
  );
};

/* Every prescription issued to the signed-in patient. */
/*
Unlocked prescriptions belonging to the signed-in patient.

Locked ones are intentionally absent rather than denied: the
patient learns one is waiting from their consultation record,
which carries prescriptionStatus and which they can always read.
*/
export const getMyPrescriptions = async () => {
  const user = requireUser();

  const snapshot = await getDocs(
    query(collection(db, "prescriptions"), ...patientConstraints(user))
  );

  return snapshot.docs.map(shape).sort(byNewest);
};

/* Every prescription written by the signed-in doctor. */
export const getDoctorPrescriptions = async () => {
  const user = requireUser();

  const snapshot = await getDocs(
    query(
      collection(db, "prescriptions"),
      where("doctorId", "==", user.uid)
    )
  );

  return snapshot.docs.map(shape).sort(byNewest);
};
