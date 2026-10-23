import {
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp,
  doc,
  setDoc,
  deleteDoc,
  updateDoc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";

import { auth, db } from "../firebase/firebase";
import { hasDoctorRecord } from "./roleService";

import {
  STATUS,
  normaliseStatus,
} from "./consultationStatus";

/*
Status semantics live in ./consultationStatus (no Firebase import,
so they are directly unit testable). Re-exported here because most
callers want them alongside the read/write functions.
*/
export {
  STATUS,
  normaliseStatus,
  isJoinable,
  isActive,
  isFinished,
  statusLabel,
  statusHelp,
  joinLabel,
} from "./consultationStatus";



/*
=====================================================
CONSULTATION SERVICE
=====================================================

Single owner of consultation_requests. A duplicate
createConsultationRequest used to live in riskService.js
as well; it was dead code and has been removed.

Status values - always lowercase:

  pending      patient has asked, doctor has not answered
  accepted     doctor accepted, video room may be created
  in_progress  the doctor has joined the call
  rejected     doctor declined
  cancelled  patient withdrew while still pending
  completed  consultation finished

The database contains legacy records written as
"PENDING", which the dashboard's status === "pending"
filter silently ignored. normaliseStatus() below makes
every read case-insensitive so those records behave
correctly even before the data migration is run.
=====================================================
*/



/*
Care links are what let a doctor read a patient's records.

Firestore rules cannot run a query, so "does a consultation
exist between these two people?" is unanswerable directly.
Instead the link lives at a deterministic path that exists()
can check in one lookup:

    care_links/{doctorUid}_{patientUid}

Created when the doctor accepts, deleted when the
consultation is rejected or cancelled.
*/
export const careLinkId = (doctorId, patientId) =>
  `${doctorId}_${patientId}`;


// =====================================================
// CREATE
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
  assessmentId,
  fee,
}) => {
  if (!patientId) throw new Error("You must be signed in to request a consultation.");

  if (!doctorId) throw new Error("Please select a doctor.");

  const requestRef = await addDoc(collection(db, "consultation_requests"), {
    patientId,
    patientEmail: patientEmail || "",
    patientName: patientName || "Patient",

    doctorId,
    doctorName: doctorName || "",
    doctorEmail: doctorEmail || "",

    hospitalId: hospitalId || "",
    hospitalName: hospitalName || "",
    city: city || "",

    // Snapshot of the assessment, so the doctor sees what the
    // patient saw even if a newer assessment is taken later.
    risk: risk || "",
    report: report || {},
    assessmentId: assessmentId || null,

    fee: typeof fee === "number" ? fee : null,
    paymentStatus: "unpaid",

    status: STATUS.PENDING,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return requestRef.id;
};


// =====================================================
// READ
// =====================================================

export const getConsultationRequest = async (requestId) => {
  if (!requestId) return null;

  const snapshot = await getDoc(
    doc(db, "consultation_requests", requestId)
  );

  if (!snapshot.exists()) return null;

  const data = snapshot.data();

  return { id: snapshot.id, ...data, status: normaliseStatus(data.status) };
};

const byNewest = (a, b) => {
  const at = a.createdAt?.toMillis?.() ?? 0;
  const bt = b.createdAt?.toMillis?.() ?? 0;
  return bt - at;
};

/* Every consultation for the signed-in patient. */
export const getPatientConsultations = async () => {
  const user = auth.currentUser;

  if (!user) throw new Error("You must be signed in.");

  const snapshot = await getDocs(
    query(
      collection(db, "consultation_requests"),
      where("patientId", "==", user.uid)
    )
  );

  return snapshot.docs
    .map((d) => ({ id: d.id, ...d.data(), status: normaliseStatus(d.data().status) }))
    .sort(byNewest);
};


// =====================================================
// DOCTOR ACTIONS
// =====================================================

/*
Accepting does two things atomically-enough for this app:

  1. moves the request to "accepted"
  2. creates the care link that grants this doctor read
     access to this patient's profile and assessments

Without step 2 the doctor can open the request (they are a
party to it) but cannot load the patient's assessment
history, because the rules have no other way to authorise it.
*/
export const acceptConsultation = async (requestId) => {
  const user = auth.currentUser;

  if (!user) throw new Error("You must be signed in.");

  const request = await getConsultationRequest(requestId);

  if (!request) throw new Error("This consultation no longer exists.");

  if (request.doctorId !== user.uid) {
    throw new Error(
      "This consultation is assigned to a different doctor, so you " +
        "cannot respond to it."
    );
  }

  /*
    Pre-flight on the exact condition the rules test.

    Every write below needs isDoctor(), which is
    exists(/doctors/{auth.uid}). When that document is missing - most
    often because the doctor record was created with an
    auto-generated id instead of the doctor's Auth UID - Firestore
    returns a bare permission-denied, which reads as "you are not
    authorised" on a consultation that genuinely is theirs.

    Checking first turns a confusing denial into an actionable
    sentence naming the uid that needs a record.
  */
  if (!(await hasDoctorRecord(user.uid))) {
    throw new Error(
      "Your doctor account is not linked in the database. A doctor " +
        `record must exist at doctors/${user.uid} - the document ID has ` +
        "to be exactly this Auth UID. Ask your administrator to create " +
        "or re-key it."
    );
  }

  if (request.status !== STATUS.PENDING) {
    /*
      Guards the two-doctors-at-once case and a double click. The
      status is read from the database, so a request someone else
      already answered is refused rather than silently reassigned.
    */
    throw new Error(
      `This consultation has already been ${request.status}.`
    );
  }

  /*
    ORDER MATTERS.

    The care link is written BEFORE the status change, not after.

    It used to be the other way round, and when the link write
    failed the consultation had already been marked accepted - the
    database said yes while the doctor saw an error. Doing the
    fallible write first means a failure leaves everything
    untouched and the doctor can simply try again.

    setDoc with merge, because the link is keyed by the
    doctor/patient PAIR and already exists if these two have
    consulted before. Without merge the second consultation
    between the same pair failed outright.
  */
  /*
    Each write is labelled, so a failure names the step that failed
    instead of producing one indistinguishable permission error for
    three different operations.
  */
  const step = async (label, run) => {
    try {
      await run();
    } catch (error) {
      const wrapped = new Error(
        `${label} failed (${error?.code || "unknown"})`
      );

      wrapped.code = error?.code;
      wrapped.step = label;
      wrapped.cause = error;

      throw wrapped;
    }
  };

  await step("care-link", () =>
    setDoc(
      doc(db, "care_links", careLinkId(user.uid, request.patientId)),
      {
        doctorId: user.uid,
        patientId: request.patientId,
        requestId,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      },
      { merge: true }
    )
  );

  await step("status-update", () =>
    updateDoc(doc(db, "consultation_requests", requestId), {
      status: STATUS.ACCEPTED,
      respondedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  return request;
};

export const rejectConsultation = async (requestId) => {
  const user = auth.currentUser;

  if (!user) throw new Error("You must be signed in.");

  const request = await getConsultationRequest(requestId);

  if (!request) throw new Error("This consultation no longer exists.");

  await updateDoc(doc(db, "consultation_requests", requestId), {
    status: STATUS.REJECTED,
    respondedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Revoke access - a rejected consultation grants nothing.
  await revokeCareLink(user.uid, request.patientId);
};

/*
Marks a consultation as under way.

Set when the DOCTOR joins the video room - the patient
joining proves nothing on its own, since they can open the
room before the doctor arrives.

Only ever moves accepted -> in_progress. Calling it on an
already-completed consultation would otherwise reopen it,
which is why the current status is checked first rather
than blindly written.
*/
export const markConsultationInProgress = async (requestId) => {
  const current = await getConsultationRequest(requestId);

  if (!current || current.status !== STATUS.ACCEPTED) return;

  await updateDoc(doc(db, "consultation_requests", requestId), {
    status: STATUS.IN_PROGRESS,
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const PRESCRIPTION_STATE = {
  NONE: "none",
  DRAFT: "draft",
  ISSUED: "issued",
};

/*
Completes the consultation and records where the
prescription has got to.

prescriptionStatus lives on the CONSULTATION, not only on
the prescription, because the patient can always read the
consultation but cannot read a prescription until it is
issued and paid for. Without this they would have no way
to tell "your doctor is still writing it" from "there is
nothing coming" - and would be asked to pay for something
they could not see the existence of.
*/
export const completeConsultation = async (
  requestId,
  prescriptionStatus = PRESCRIPTION_STATE.NONE
) => {
  await updateDoc(doc(db, "consultation_requests", requestId), {
    status: STATUS.COMPLETED,
    prescriptionStatus,
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

/*
Records that the doctor has started or finished writing,
without changing the consultation's own status.
*/
export const setPrescriptionState = async (requestId, prescriptionStatus) => {
  await updateDoc(doc(db, "consultation_requests", requestId), {
    prescriptionStatus,
    updatedAt: serverTimestamp(),
  });
};

/*
Live consultation, so a patient waiting on their doctor
sees the prescription appear without refreshing.
*/
export const watchConsultation = (requestId, onChange, onError) =>
  onSnapshot(
    doc(db, "consultation_requests", requestId),
    (snapshot) =>
      onChange(
        snapshot.exists()
          ? {
              id: snapshot.id,
              ...snapshot.data(),
              status: normaliseStatus(snapshot.data().status),
            }
          : null
      ),
    onError
  );

/* Patient withdraws while still pending. */
export const cancelConsultation = async (requestId) => {
  await updateDoc(doc(db, "consultation_requests", requestId), {
    status: STATUS.CANCELLED,
    updatedAt: serverTimestamp(),
  });
};

const revokeCareLink = async (doctorId, patientId) => {
  try {
    await deleteDoc(doc(db, "care_links", careLinkId(doctorId, patientId)));
  } catch {
    // Nothing to revoke is not an error.
  }
};

/*
Kept for callers that only need a status change. Prefer the
named helpers above - they also maintain the care link.
*/
export const updateConsultationStatus = async (requestId, status) => {
  if (!requestId) throw new Error("Consultation request ID is missing.");

  await updateDoc(doc(db, "consultation_requests", requestId), {
    status: normaliseStatus(status),
    updatedAt: serverTimestamp(),
  });
};
