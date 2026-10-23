/*
=====================================================================
REPRODUCTION  -  patient dashboard: "You do not have permission"
=====================================================================

The dashboard runs three queries:

    risk_assessments      where uid        == me
    consultation_requests where patientId  == me
    prescriptions         where patientId  == me

Two of them are provably safe. The third is the problem.

The payment gate added to the prescriptions rule reads:

    patientId == uid  AND  status == 'issued'
                      AND  consultation(...).paymentStatus == 'paid'

For a LIST query, Firestore evaluates the rule against every
document the query would return. A single draft or unpaid
prescription fails the rule - and that fails the WHOLE QUERY, not
just that row.

The dashboard uses Promise.all, so one denial rejects all three and
every count collapses to zero.

Run:
  firebase emulators:exec --only firestore --project cardiac-rules-test \
    "node tests/repro_dashboard_denied.mjs"
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
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";

const PATIENT = "patient_alice";
const DOCTOR = "doctor_one";

const PAID_REQUEST = "req_paid";
const UNPAID_REQUEST = "req_unpaid";

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

  await setDoc(doc(db, "doctors", DOCTOR), {
    uid: DOCTOR, name: "Dr One", role: "doctor",
  });

  await setDoc(doc(db, "users", PATIENT), {
    uid: PATIENT, role: "patient", name: "Alice",
  });

  await setDoc(doc(db, "risk_assessments", "a1"), {
    uid: PATIENT, risk: "MODERATE", probability: 0.4, prediction: 0,
  });

  await setDoc(doc(db, "consultation_requests", PAID_REQUEST), {
    patientId: PATIENT, doctorId: DOCTOR, status: "completed",
    fee: 500, paymentStatus: "paid", prescriptionStatus: "issued",
  });

  await setDoc(doc(db, "consultation_requests", UNPAID_REQUEST), {
    patientId: PATIENT, doctorId: DOCTOR, status: "completed",
    fee: 500, paymentStatus: "unpaid", prescriptionStatus: "issued",
  });

  // Paid + issued: the patient is entitled to this one.
  await setDoc(doc(db, "prescriptions", "rx_paid"), {
    patientId: PATIENT, doctorId: DOCTOR, requestId: PAID_REQUEST,
    status: "issued", unlocked: true, medicines: [],
  });

  // Issued but NOT paid: the patient may not read its contents.
  await setDoc(doc(db, "prescriptions", "rx_unpaid"), {
    patientId: PATIENT, doctorId: DOCTOR, requestId: UNPAID_REQUEST,
    status: "issued", unlocked: false, medicines: [],
  });

  await setDoc(doc(db, "prescriptions", "rx_draft"), {
    patientId: PATIENT, doctorId: DOCTOR, requestId: PAID_REQUEST,
    status: "draft", medicines: [],
  });
});

const alice = testEnv.authenticatedContext(PATIENT).firestore();

console.log("=".repeat(68));
console.log("PATIENT DASHBOARD  -  which query is denied?");
console.log("=".repeat(68));

console.log("\n--- the two queries that work ---");

await check(
  "risk_assessments where uid == me",
  assertSucceeds(
    getDocs(
      query(collection(alice, "risk_assessments"), where("uid", "==", PATIENT))
    )
  )
);

await check(
  "consultation_requests where patientId == me",
  assertSucceeds(
    getDocs(
      query(
        collection(alice, "consultation_requests"),
        where("patientId", "==", PATIENT)
      )
    )
  )
);

console.log("\n--- the query that breaks the dashboard ---");
await check(
  "the UNCONSTRAINED query is still denied (one locked row poisons it)",
  assertFails(
    getDocs(
      query(
        collection(alice, "prescriptions"),
        where("patientId", "==", PATIENT)
      )
    )
  )
);

console.log("\n--- the FIXED query names `unlocked` ---");

await check(
  "patientId == me AND unlocked == true SUCCEEDS",
  assertSucceeds(
    getDocs(
      query(
        collection(alice, "prescriptions"),
        where("patientId", "==", PATIENT),
        where("unlocked", "==", true)
      )
    )
  )
);

const unlockedRows = await getDocs(
  query(
    collection(alice, "prescriptions"),
    where("patientId", "==", PATIENT),
    where("unlocked", "==", true)
  )
);

await check(
  "it returns ONLY the paid one - locked and draft rows are absent",
  Promise.resolve().then(() => {
    const ids = unlockedRows.docs.map((d) => d.id);
    if (ids.length === 1 && ids[0] === "rx_paid") return true;
    throw new Error(`returned ${JSON.stringify(ids)}`);
  })
);

console.log("\n--- the gate still holds ---");

await check(
  "the patient still CANNOT read the locked one directly",
  assertFails(getDoc(doc(alice, "prescriptions", "rx_unpaid")))
);

await check(
  "the patient still CANNOT read a draft directly",
  assertFails(getDoc(doc(alice, "prescriptions", "rx_draft")))
);

await check(
  "the patient CAN read the unlocked one directly",
  assertSucceeds(getDoc(doc(alice, "prescriptions", "rx_paid")))
);

await testEnv.cleanup();

console.log("\n" + "=".repeat(68));
console.log(`PASSED: ${passed}    FAILED: ${failed}`);
console.log("=".repeat(68));

process.exit(failed === 0 ? 0 : 1);
