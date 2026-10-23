/*
=====================================================================
REPRODUCTION  -  "You do not have access to this prescription."
=====================================================================

Demonstrates the root cause before it is fixed, and proves the fix
afterwards.

The claim under test: Firestore security rules are NOT filters. For a
LIST query, Firestore must be able to prove from the QUERY ALONE that
every document it could return satisfies the rule. It does not fetch
documents and then filter them.

So with this rule:

    allow read: if resource.data.patientId == request.auth.uid
                || resource.data.doctorId  == request.auth.uid

a query constrained only on requestId is DENIED - even when every
document it would return belongs to the caller - because nothing in
the query mentions patientId or doctorId.

Run:
  firebase emulators:exec --only firestore --project cardiac-rules-test \
    "node tests/repro_prescription_access.mjs"
=====================================================================
*/

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";

import { readFileSync } from "node:fs";
import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";

const PATIENT = "patient_alice";
const OTHER_PATIENT = "patient_bob";
const DOCTOR = "doctor_one";
const REQUEST = "request_alice_doctor1";

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

  await setDoc(doc(db, "doctors", DOCTOR), { name: "Dr One", role: "doctor" });

  await setDoc(doc(db, "consultation_requests", REQUEST), {
    patientId: PATIENT, doctorId: DOCTOR, status: "completed",
    paymentStatus: "paid",
  });

  // One prescription, belonging to Alice and Doctor One.
  await setDoc(doc(db, "prescriptions", "rx_alice"), {
    requestId: REQUEST,
    patientId: PATIENT,
    doctorId: DOCTOR,
    status: "issued",
    /*
      Paid for, so the patient is entitled to read it.

      `unlocked` is a queryable mirror of the payment gate. The gate
      was once a cross-document lookup to the consultation, but a
      rule that reads another document cannot be satisfied by a list
      query - so one locked row denied the patient's entire
      dashboard. Only the server sets this, after verifying the
      Razorpay signature.
    */
    unlocked: true,
    medicines: [],
  });
});

const alice = testEnv.authenticatedContext(PATIENT).firestore();
const bob = testEnv.authenticatedContext(OTHER_PATIENT).firestore();
const doctor = testEnv.authenticatedContext(DOCTOR).firestore();

console.log("=".repeat(66));
console.log("ROOT CAUSE: rules are not filters");
console.log("=".repeat(66));

console.log("\n--- the BROKEN query (filters on requestId only) ---");

await check(
  "DENIED for the owning patient - this is the reported bug",
  assertFails(
    getDocs(
      query(
        collection(alice, "prescriptions"),
        where("requestId", "==", REQUEST)
      )
    )
  )
);

await check(
  "DENIED for the issuing doctor too - same cause",
  assertFails(
    getDocs(
      query(
        collection(doctor, "prescriptions"),
        where("requestId", "==", REQUEST)
      )
    )
  )
);

console.log(
  "\n  Both are denied even though the single matching document belongs\n" +
    "  to both of them. Firestore cannot prove safety from the query, so\n" +
    "  it refuses before reading anything."
);

console.log("\n--- the FIXED query (adds the ownership constraint) ---");

/*
  The patient's query names BOTH ownership and the payment gate,
  because the rule requires both. This is exactly the query
  prescriptionService.patientConstraints builds - if this test and
  the app disagreed about the query shape, the test would be
  proving something the app never does.
*/
await check(
  "ALLOWED for the owning patient when the query names patientId + unlocked",
  assertSucceeds(
    getDocs(
      query(
        collection(alice, "prescriptions"),
        where("requestId", "==", REQUEST),
        where("patientId", "==", PATIENT),
        where("unlocked", "==", true)
      )
    )
  )
);

/*
  Ownership ALONE is not enough for a patient any more. Naming
  patientId but not `unlocked` leaves the payment gate unprovable,
  so Firestore refuses - which is the gate working, not a bug.
*/
await check(
  "ownership alone is still DENIED for a patient - the gate is unprovable",
  assertFails(
    getDocs(
      query(
        collection(alice, "prescriptions"),
        where("requestId", "==", REQUEST),
        where("patientId", "==", PATIENT)
      )
    )
  )
);

await check(
  "ALLOWED for the issuing doctor when the query also filters doctorId",
  assertSucceeds(
    getDocs(
      query(
        collection(doctor, "prescriptions"),
        where("requestId", "==", REQUEST),
        where("doctorId", "==", DOCTOR)
      )
    )
  )
);

console.log("\n--- security is NOT weakened by the fix ---");

await check(
  "another patient CANNOT read it by claiming to be the owner",
  assertFails(
    getDocs(
      query(
        collection(bob, "prescriptions"),
        where("requestId", "==", REQUEST),
        where("patientId", "==", PATIENT),
        where("unlocked", "==", true)
      )
    )
  )
);

const bobRows = await getDocs(
  query(
    collection(bob, "prescriptions"),
    where("requestId", "==", REQUEST),
    where("patientId", "==", OTHER_PATIENT),
    where("unlocked", "==", true)
  )
);

await check(
  "another patient filtering on their OWN id gets nothing back",
  Promise.resolve().then(() => {
    /*
      Allowed to RUN - the query is provably safe for Bob - but it
      matches no document, because the prescription is Alice's. The
      denial and the empty result are different mechanisms and both
      have to hold.
    */
    if (!bobRows.empty) {
      throw new Error(
        `Bob received ${bobRows.size} document(s) that are not his`
      );
    }

    return true;
  })
);

await testEnv.cleanup();

console.log("\n" + "=".repeat(66));
console.log(`PASSED: ${passed}    FAILED: ${failed}`);
console.log("=".repeat(66));

process.exit(failed === 0 ? 0 : 1);
