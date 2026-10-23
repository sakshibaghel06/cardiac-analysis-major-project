/*
=====================================================================
REPRODUCTION  -  "Unable to update the consultation request."
=====================================================================

Replays exactly what acceptConsultation() does, step by step, so the
failing step is identified rather than guessed:

    1. read the consultation
    2. updateDoc  consultation_requests/{id}  -> accepted
    3. setDoc     care_links/{doctorUid}_{patientUid}

The app wraps all three in one try/catch and shows a single generic
message, so a failure in step 3 is indistinguishable from a failure
in step 2. Here each step is asserted separately.

Run:
  firebase emulators:exec --only firestore --project cardiac-rules-test \
    "node tests/repro_accept_consultation.mjs"
=====================================================================
*/

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";

import { readFileSync } from "node:fs";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

const PATIENT = "patient_alice";
const DOCTOR = "doctor_one";
const OTHER_DOCTOR = "doctor_two";

const PENDING = "req_pending";
const PENDING_2 = "req_pending_2";

let passed = 0;
let failed = 0;

const check = async (name, promise) => {
  try {
    await promise;
    console.log(`  PASS  ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${String(error).split("\n")[0]}`);
    failed += 1;
  }
};

const testEnv = await initializeTestEnvironment({
  projectId: "cardiac-rules-test",
  firestore: {
    rules: readFileSync("firestore.rules", "utf8"),
    host: "127.0.0.1",
    port: 8080,
  },
});

await testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();

  // A doctor is "a document at doctors/{their auth uid}".
  await setDoc(doc(db, "doctors", DOCTOR), {
    uid: DOCTOR, name: "Dr One", role: "doctor", hospitalId: "h1",
  });
  await setDoc(doc(db, "doctors", OTHER_DOCTOR), {
    uid: OTHER_DOCTOR, name: "Dr Two", role: "doctor", hospitalId: "h1",
  });

  /*
    Shaped exactly like a request the app creates today, including
    the fee and paymentStatus fields that the newer rules guard.
  */
  const pendingRequest = {
    patientId: PATIENT,
    patientEmail: "alice@example.com",
    patientName: "Alice",
    doctorId: DOCTOR,
    doctorName: "Dr One",
    hospitalId: "h1",
    hospitalName: "CardioCare",
    city: "Bangalore",
    risk: "MODERATE",
    report: { age: 54, trestbps: 130 },
    fee: 500,
    paymentStatus: "unpaid",
    status: "pending",
  };

  await setDoc(doc(db, "consultation_requests", PENDING), pendingRequest);
  await setDoc(doc(db, "consultation_requests", PENDING_2), pendingRequest);
});

const doctor = testEnv.authenticatedContext(DOCTOR).firestore();
const other = testEnv.authenticatedContext(OTHER_DOCTOR).firestore();
const alice = testEnv.authenticatedContext(PATIENT).firestore();

console.log("=".repeat(68));
console.log("ACCEPT CONSULTATION  -  step by step");
console.log("=".repeat(68));

console.log("\n--- step 1: read the consultation ---");

await check(
  "the assigned doctor can read it",
  assertSucceeds(getDoc(doc(doctor, "consultation_requests", PENDING)))
);

console.log("\n--- step 2: update the status to accepted ---");

await check(
  "the assigned doctor can set status = accepted",
  assertSucceeds(
    updateDoc(doc(doctor, "consultation_requests", PENDING), {
      status: "accepted",
      respondedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  )
);

console.log("\n--- step 3: create the care link ---");

await check(
  "the assigned doctor can create care_links/{doctor}_{patient}",
  assertSucceeds(
    setDoc(doc(doctor, "care_links", `${DOCTOR}_${PATIENT}`), {
      doctorId: DOCTOR,
      patientId: PATIENT,
      requestId: PENDING,
      createdAt: serverTimestamp(),
    })
  )
);

console.log("\n--- reject path ---");

await check(
  "the assigned doctor can set status = rejected",
  assertSucceeds(
    updateDoc(doc(doctor, "consultation_requests", PENDING_2), {
      status: "rejected",
      respondedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  )
);

console.log("\n--- the SECOND consultation with the same patient ---");

/*
  This is the case that was failing in the app.

  A care link is keyed by the doctor/patient PAIR, so it already
  exists the second time these two consult. acceptConsultation
  writes it with setDoc, which is an UPDATE once it exists - and
  care_links had `allow update: if false`.

  The doctor saw "Unable to update the consultation request", while
  the status change that ran first had already succeeded.
*/
await check(
  "re-asserting an existing care link is allowed (merge)",
  assertSucceeds(
    setDoc(
      doc(doctor, "care_links", `${DOCTOR}_${PATIENT}`),
      {
        doctorId: DOCTOR,
        patientId: PATIENT,
        requestId: PENDING_2,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    )
  )
);

await check(
  "but the link can never be repointed at another patient",
  assertFails(
    setDoc(
      doc(doctor, "care_links", `${DOCTOR}_${PATIENT}`),
      { doctorId: DOCTOR, patientId: "someone_else" },
      { merge: true }
    )
  )
);

await check(
  "and another doctor cannot hijack it",
  assertFails(
    setDoc(
      doc(other, "care_links", `${DOCTOR}_${PATIENT}`),
      { doctorId: OTHER_DOCTOR, patientId: PATIENT },
      { merge: true }
    )
  )
);

console.log("\n--- authorisation still holds ---");

await check(
  "an UNASSIGNED doctor cannot accept it",
  assertFails(
    updateDoc(doc(other, "consultation_requests", PENDING), {
      status: "accepted",
    })
  )
);

await check(
  "an unassigned doctor cannot create a care link for that patient",
  assertFails(
    setDoc(doc(other, "care_links", `${OTHER_DOCTOR}_${PATIENT}`), {
      doctorId: OTHER_DOCTOR,
      patientId: PATIENT,
      requestId: PENDING,
      createdAt: serverTimestamp(),
    })
  )
);

await check(
  "the PATIENT cannot accept on the doctor's behalf",
  assertFails(
    updateDoc(doc(alice, "consultation_requests", PENDING_2), {
      status: "accepted",
    })
  )
);

await testEnv.cleanup();

console.log("\n" + "=".repeat(68));
console.log(`PASSED: ${passed}    FAILED: ${failed}`);
console.log("=".repeat(68));

process.exit(failed === 0 ? 0 : 1);
