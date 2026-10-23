/*
=====================================================================
FIRESTORE SECURITY RULES - verification
=====================================================================

Proves the access-control properties the project requires, rather
than assuming them because the rules file compiled.

Run:
    firebase emulators:exec --only firestore "node tests/rules.test.mjs"

Exits non-zero if any property fails.
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
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";

const PATIENT_A = "patient_alice";
const PATIENT_B = "patient_bob";
const DOCTOR_1 = "doctor_one";
const DOCTOR_2 = "doctor_two";

const REQUEST_A1 = "request_alice_doctor1";
const REQUEST_A2 = "request_alice_doctor1_paid";

let passed = 0;
let failed = 0;
const failures = [];

async function check(name, promise) {
  try {
    await promise;
    console.log(`  PASS  ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${String(error).split("\n")[0]}`);
    failed += 1;
    failures.push(name);
  }
}

const testEnv = await initializeTestEnvironment({
  projectId: "cardiac-analysis-rules-test",
  firestore: {
    rules: readFileSync("firestore.rules", "utf8"),
    host: "127.0.0.1",
    port: 8080,
  },
});

// ---------------------------------------------------------------
// SEED - written with rules disabled
// ---------------------------------------------------------------

await testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();

  await setDoc(doc(db, "doctors", DOCTOR_1), {
    name: "Dr One", email: "one@example.com", hospitalId: "h1", fee: 500,
  });
  await setDoc(doc(db, "doctors", DOCTOR_2), {
    name: "Dr Two", email: "two@example.com", hospitalId: "h1", fee: 700,
  });

  // Shape matches what ensurePatientProfile() actually writes.
  await setDoc(doc(db, "users", PATIENT_A), {
    uid: PATIENT_A, role: "patient", name: "Alice",
  });
  await setDoc(doc(db, "users", PATIENT_B), {
    uid: PATIENT_B, role: "patient", name: "Bob",
  });

  // Deliberately WITHOUT uid, to prove a legacy document is still
  // editable by its owner.
  await setDoc(doc(db, "users", "legacy_patient"), {
    role: "patient", name: "Legacy",
  });

  await setDoc(doc(db, "risk_assessments", "assessment_alice"), {
    uid: PATIENT_A, risk: "HIGH", probability: 0.91, prediction: 1,
  });

  await setDoc(doc(db, "consultation_requests", REQUEST_A1), {
    patientId: PATIENT_A, doctorId: DOCTOR_1, status: "accepted",
    risk: "HIGH", report: {},
  });

  // Doctor 1 has accepted Alice. Doctor 2 has no link to anyone.
  await setDoc(doc(db, "care_links", `${DOCTOR_1}_${PATIENT_A}`), {
    doctorId: DOCTOR_1, patientId: PATIENT_A, requestId: REQUEST_A1,
  });

  await setDoc(doc(db, "video_rooms", REQUEST_A1), {
    requestId: REQUEST_A1, patientId: PATIENT_A, doctorId: DOCTOR_1,
    status: "waiting",
  });

  /*
    REQUEST_A1 is accepted and UNPAID.
    REQUEST_A2 is completed and PAID.
    One issued prescription on each, plus a draft, so the payment
    gate and the draft gate can both be tested.
  */
  await setDoc(doc(db, "consultation_requests", REQUEST_A2), {
    patientId: PATIENT_A, doctorId: DOCTOR_1, status: "completed",
    risk: "MODERATE", report: {}, fee: 500, paymentStatus: "paid",
    prescriptionStatus: "issued",
  });

  await setDoc(doc(db, "prescriptions", "rx_unpaid"), {
    patientId: PATIENT_A, doctorId: DOCTOR_1, requestId: REQUEST_A1,
    status: "issued", unlocked: false, medicines: [],
  });

  // Unlocked by the server after it verified the payment.
  await setDoc(doc(db, "prescriptions", "rx_paid"), {
    patientId: PATIENT_A, doctorId: DOCTOR_1, requestId: REQUEST_A2,
    status: "issued", unlocked: true, medicines: [],
  });

  await setDoc(doc(db, "prescriptions", "rx_draft"), {
    patientId: PATIENT_A, doctorId: DOCTOR_1, requestId: REQUEST_A2,
    status: "draft", medicines: [],
  });

  /*
    Payout destination. Deliberately in a private subcollection,
    because hospitals/{id} itself is readable by every patient.
  */
  await setDoc(doc(db, "hospitals", "h1"), {
    name: "CardioCare Medical Center", location: "Bangalore",
  });

  await setDoc(doc(db, "hospitals", "h1", "private", "settlement"), {
    razorpayLinkedAccountId: "acc_SECRET123",
    payoutOnboardingStatus: "verified",
  });

  await setDoc(doc(db, "payments", "pay_alice"), {
    patientId: PATIENT_A, doctorId: DOCTOR_1, status: "created", amount: 500,
  });
});

const alice = testEnv.authenticatedContext(PATIENT_A).firestore();
const bob = testEnv.authenticatedContext(PATIENT_B).firestore();
const doctor1 = testEnv.authenticatedContext(DOCTOR_1).firestore();
const doctor2 = testEnv.authenticatedContext(DOCTOR_2).firestore();
const anon = testEnv.unauthenticatedContext().firestore();

console.log("\n=== A patient cannot reach another patient's data ===");

await check(
  "Alice reads her own profile",
  assertSucceeds(getDoc(doc(alice, "users", PATIENT_A)))
);
await check(
  "Alice CANNOT read Bob's profile",
  assertFails(getDoc(doc(alice, "users", PATIENT_B)))
);
await check(
  "Alice reads her own risk assessment",
  assertSucceeds(getDoc(doc(alice, "risk_assessments", "assessment_alice")))
);
await check(
  "Bob CANNOT read Alice's risk assessment",
  assertFails(getDoc(doc(bob, "risk_assessments", "assessment_alice")))
);
await check(
  "Bob CANNOT read Alice's consultation",
  assertFails(getDoc(doc(bob, "consultation_requests", REQUEST_A1)))
);
await check(
  "Bob CANNOT read Alice's prescription",
  assertFails(getDoc(doc(bob, "prescriptions", "rx_paid")))
);

console.log("\n=== A patient cannot modify doctor records ===");

await check(
  "Alice CANNOT edit a doctor's record",
  assertFails(updateDoc(doc(alice, "doctors", DOCTOR_1), { fee: 1 }))
);
await check(
  "Alice CANNOT create a doctor record",
  assertFails(setDoc(doc(alice, "doctors", "fake_doctor"), { name: "Fake" }))
);
await check(
  "Alice CANNOT edit a hospital",
  assertFails(setDoc(doc(alice, "hospitals", "h1"), { name: "Hacked" }))
);

console.log("\n=== A patient cannot tamper with their own results ===");

await check(
  "Alice CANNOT rewrite her risk assessment",
  assertFails(
    updateDoc(doc(alice, "risk_assessments", "assessment_alice"), {
      risk: "LOW",
    })
  )
);
await check(
  "Alice CANNOT delete her risk assessment",
  assertFails(deleteDoc(doc(alice, "risk_assessments", "assessment_alice")))
);
await check(
  "Alice CANNOT write a risk value outside LOW/MODERATE/HIGH",
  assertFails(
    setDoc(doc(alice, "risk_assessments", "bogus"), {
      uid: PATIENT_A, risk: "PERFECT", probability: 0, prediction: 0,
      createdAt: serverTimestamp(),
    })
  )
);
await check(
  "Alice CANNOT self-accept her own consultation",
  assertFails(
    updateDoc(doc(alice, "consultation_requests", REQUEST_A1), {
      status: "accepted",
    })
  )
);
await check(
  "Alice CANNOT mark a payment paid",
  assertFails(
    updateDoc(doc(alice, "payments", "pay_alice"), { status: "paid" })
  )
);
await check(
  "Alice CANNOT create a prescription",
  assertFails(
    setDoc(doc(alice, "prescriptions", "rx_fake"), {
      patientId: PATIENT_A, doctorId: DOCTOR_1, requestId: REQUEST_A1,
      createdAt: serverTimestamp(),
    })
  )
);

console.log("\n=== Prescription access: payment gate and drafts ===");

await check(
  "the issuing doctor reads their own ISSUED prescription",
  assertSucceeds(getDoc(doc(doctor1, "prescriptions", "rx_paid")))
);
await check(
  "the issuing doctor reads their own DRAFT",
  assertSucceeds(getDoc(doc(doctor1, "prescriptions", "rx_draft")))
);
await check(
  "the patient CANNOT read a draft, even their own",
  assertFails(getDoc(doc(alice, "prescriptions", "rx_draft")))
);
await check(
  "the patient CANNOT read an issued prescription while UNPAID",
  assertFails(getDoc(doc(alice, "prescriptions", "rx_unpaid")))
);
await check(
  "the patient CAN read it once the consultation is PAID",
  assertSucceeds(getDoc(doc(alice, "prescriptions", "rx_paid")))
);
await check(
  "another patient CANNOT read it even when paid",
  assertFails(getDoc(doc(bob, "prescriptions", "rx_paid")))
);
await check(
  "an unrelated doctor CANNOT read it",
  assertFails(getDoc(doc(doctor2, "prescriptions", "rx_paid")))
);
await check(
  "anonymous CANNOT read it",
  assertFails(getDoc(doc(anon, "prescriptions", "rx_paid")))
);

await check(
  "the patient CANNOT issue a prescription to themselves",
  assertFails(
    setDoc(doc(alice, "prescriptions", "rx_forged"), {
      patientId: PATIENT_A, doctorId: DOCTOR_1, requestId: REQUEST_A2,
      status: "issued", createdAt: serverTimestamp(),
    })
  )
);
await check(
  "a doctor CANNOT write a prescription for a patient who is not theirs",
  assertFails(
    setDoc(doc(doctor2, "prescriptions", "rx_wrong_doctor"), {
      patientId: PATIENT_A, doctorId: DOCTOR_2, requestId: REQUEST_A2,
      status: "issued", createdAt: serverTimestamp(),
    })
  )
);
await check(
  "an ISSUED prescription cannot be rewritten, even by its author",
  assertFails(
    updateDoc(doc(doctor1, "prescriptions", "rx_paid"), {
      diagnosis: "changed after the fact",
    })
  )
);
await check(
  "the doctor CANNOT unlock a prescription themselves",
  assertFails(
    updateDoc(doc(doctor1, "prescriptions", "rx_draft"), {
      unlocked: true,
    })
  )
);
await check(
  "the patient CANNOT unlock their own prescription",
  assertFails(
    updateDoc(doc(alice, "prescriptions", "rx_unpaid"), { unlocked: true })
  )
);
await check(
  "a DRAFT can still be edited by its author",
  assertSucceeds(
    updateDoc(doc(doctor1, "prescriptions", "rx_draft"), {
      diagnosis: "work in progress",
    })
  )
);

console.log("\n=== Money is server-only ===");

await check(
  "the patient CANNOT mark their consultation paid",
  assertFails(
    updateDoc(doc(alice, "consultation_requests", REQUEST_A1), {
      paymentStatus: "paid",
    })
  )
);
await check(
  "the DOCTOR cannot mark a consultation paid either",
  assertFails(
    updateDoc(doc(doctor1, "consultation_requests", REQUEST_A1), {
      status: "completed", paymentStatus: "paid",
    })
  )
);
await check(
  "the doctor cannot change the fee",
  assertFails(
    updateDoc(doc(doctor1, "consultation_requests", REQUEST_A1), {
      status: "completed", fee: 1,
    })
  )
);
await check(
  "the doctor CAN complete and record the prescription status",
  assertSucceeds(
    updateDoc(doc(doctor1, "consultation_requests", REQUEST_A1), {
      status: "completed", prescriptionStatus: "issued",
    })
  )
);


console.log("\n=== Role cannot be escalated ===");

await check(
  "Alice CANNOT change her own role to doctor",
  assertFails(updateDoc(doc(alice, "users", PATIENT_A), { role: "doctor" }))
);
await check(
  "A new user CANNOT sign up as a doctor",
  assertFails(
    setDoc(doc(bob, "users", "brand_new_user"), {
      uid: "brand_new_user", role: "doctor", name: "Sneaky",
    })
  )
);
await check(
  "A user CANNOT create a profile under someone else uid",
  assertFails(
    setDoc(doc(bob, "users", PATIENT_A), {
      uid: PATIENT_A, role: "patient", name: "Impostor",
    })
  )
);
await check(
  "Alice CANNOT create a doctors document for herself",
  assertFails(
    setDoc(doc(alice, "doctors", PATIENT_A), {
      name: "Dr Alice", role: "doctor",
    })
  )
);

console.log("\n=== A doctor reaches only their own patients ===");

await check(
  "Doctor 1 reads Alice's consultation (is a party)",
  assertSucceeds(getDoc(doc(doctor1, "consultation_requests", REQUEST_A1)))
);
await check(
  "Doctor 1 reads Alice's risk assessment (care link exists)",
  assertSucceeds(getDoc(doc(doctor1, "risk_assessments", "assessment_alice")))
);
await check(
  "Doctor 1 reads Alice's profile (care link exists)",
  assertSucceeds(getDoc(doc(doctor1, "users", PATIENT_A)))
);

await check(
  "Doctor 2 CANNOT read Alice's consultation (not a party)",
  assertFails(getDoc(doc(doctor2, "consultation_requests", REQUEST_A1)))
);
await check(
  "Doctor 2 CANNOT read Alice's risk assessment (no care link)",
  assertFails(getDoc(doc(doctor2, "risk_assessments", "assessment_alice")))
);
await check(
  "Doctor 2 CANNOT read Alice's profile (no care link)",
  assertFails(getDoc(doc(doctor2, "users", PATIENT_A)))
);
await check(
  "Doctor 2 CANNOT accept Alice's consultation",
  assertFails(
    updateDoc(doc(doctor2, "consultation_requests", REQUEST_A1), {
      status: "accepted",
    })
  )
);
await check(
  "Doctor 2 CANNOT edit Doctor 1's record",
  assertFails(updateDoc(doc(doctor2, "doctors", DOCTOR_1), { fee: 1 }))
);
await check(
  "Doctor 1 marks the consultation in progress",
  assertSucceeds(
    updateDoc(doc(doctor1, "consultation_requests", REQUEST_A1), {
      status: "in_progress",
    })
  )
);
await check(
  "Alice CANNOT mark her own consultation in progress",
  assertFails(
    updateDoc(doc(alice, "consultation_requests", REQUEST_A1), {
      status: "in_progress",
    })
  )
);
await check(
  "Doctor 2 CANNOT mark someone else's consultation in progress",
  assertFails(
    updateDoc(doc(doctor2, "consultation_requests", REQUEST_A1), {
      status: "in_progress",
    })
  )
);
/*
  The reported bug was the patient's screen reverting to "Pending"
  after the doctor joined. It was a UI misread - but the database
  must not permit a real reset either, or the same symptom could
  come back as actual corruption rather than a display fault.

  'pending' is absent from the allowed status list for a doctor
  update, so this is refused at the rules layer, by either party.
*/
await check(
  "Doctor 1 CANNOT reset an in-progress consultation back to pending",
  assertFails(
    updateDoc(doc(doctor1, "consultation_requests", REQUEST_A1), {
      status: "pending",
    })
  )
);
await check(
  "Alice CANNOT reset her in-progress consultation back to pending",
  assertFails(
    updateDoc(doc(alice, "consultation_requests", REQUEST_A1), {
      status: "pending",
    })
  )
);
await check(
  "Doctor 1 CANNOT un-accept an in-progress consultation into pending " +
    "while also clearing the fee",
  assertFails(
    updateDoc(doc(doctor1, "consultation_requests", REQUEST_A1), {
      status: "pending",
      fee: 0,
    })
  )
);

await check(
  "Doctor 1 CANNOT rewrite the patient's risk on a consultation",
  assertFails(
    updateDoc(doc(doctor1, "consultation_requests", REQUEST_A1), {
      status: "completed", risk: "LOW",
    })
  )
);

console.log("\n=== Profile editing is scoped ===");

await check(
  "Alice updates her own name and phone",
  assertSucceeds(
    updateDoc(doc(alice, "users", PATIENT_A), {
      name: "Alice V", phone: "+91 98765 43210",
    })
  )
);
await check(
  "Alice records her notifications as seen",
  assertSucceeds(
    updateDoc(doc(alice, "users", PATIENT_A), {
      lastSeenNotificationsAt: serverTimestamp(),
    })
  )
);
await check(
  "A legacy profile with no uid field is still editable by its owner",
  assertSucceeds(
    updateDoc(
      doc(testEnv.authenticatedContext("legacy_patient").firestore(),
          "users", "legacy_patient"),
      { name: "Legacy Updated" }
    )
  )
);
await check(
  "Alice CANNOT repoint her uid at another user",
  assertFails(
    updateDoc(doc(alice, "users", PATIENT_A), { uid: PATIENT_B })
  )
);
await check(
  "Doctor 1 toggles their own availability",
  assertSucceeds(
    updateDoc(doc(doctor1, "doctors", DOCTOR_1), { available: false })
  )
);
await check(
  "Doctor 1 updates their own fee and speciality",
  assertSucceeds(
    updateDoc(doc(doctor1, "doctors", DOCTOR_1), {
      consultationFee: 800, specialization: "Interventional Cardiologist",
    })
  )
);
await check(
  "Doctor 1 CANNOT reassign their own hospital",
  assertFails(
    updateDoc(doc(doctor1, "doctors", DOCTOR_1), { hospitalId: "h-elsewhere" })
  )
);
await check(
  "Doctor 1 CANNOT repoint their own uid",
  assertFails(
    updateDoc(doc(doctor1, "doctors", DOCTOR_1), { uid: PATIENT_A })
  )
);
await check(
  "Doctor 2 CANNOT toggle Doctor 1 availability",
  assertFails(
    updateDoc(doc(doctor2, "doctors", DOCTOR_1), { available: false })
  )
);
await check(
  "Alice CANNOT toggle a doctor availability",
  assertFails(
    updateDoc(doc(alice, "doctors", DOCTOR_1), { available: false })
  )
);


console.log("\n=== Video rooms admit only the two participants ===");

await check(
  "Alice reads her own video room",
  assertSucceeds(getDoc(doc(alice, "video_rooms", REQUEST_A1)))
);
await check(
  "Doctor 1 reads that video room",
  assertSucceeds(getDoc(doc(doctor1, "video_rooms", REQUEST_A1)))
);
await check(
  "Bob CANNOT read the video room",
  assertFails(getDoc(doc(bob, "video_rooms", REQUEST_A1)))
);
await check(
  "Doctor 2 CANNOT read the video room",
  assertFails(getDoc(doc(doctor2, "video_rooms", REQUEST_A1)))
);
await check(
  "Bob CANNOT push an ICE candidate into the room",
  assertFails(
    setDoc(doc(bob, "video_rooms", REQUEST_A1, "patientCandidates", "c1"), {
      candidate: "x", sessionId: "s",
    })
  )
);
await check(
  "Alice CAN push her own ICE candidate",
  assertSucceeds(
    setDoc(doc(alice, "video_rooms", REQUEST_A1, "patientCandidates", "c2"), {
      candidate: "x", sessionId: "s",
    })
  )
);

console.log("\n=== Payout destinations are unreachable ===");

await check(
  "a patient can read the hospital directory entry",
  assertSucceeds(getDoc(doc(alice, "hospitals", "h1")))
);
await check(
  "a patient CANNOT read the payout destination",
  assertFails(
    getDoc(doc(alice, "hospitals", "h1", "private", "settlement"))
  )
);
await check(
  "a DOCTOR cannot read the payout destination either",
  assertFails(
    getDoc(doc(doctor1, "hospitals", "h1", "private", "settlement"))
  )
);
await check(
  "nobody can write a payout destination from a client",
  assertFails(
    setDoc(doc(doctor1, "hospitals", "h1", "private", "settlement"), {
      razorpayLinkedAccountId: "acc_ATTACKER",
    })
  )
);

console.log("\n=== Signed-out users are refused ===");

await check(
  "Anonymous CANNOT read a patient profile",
  assertFails(getDoc(doc(anon, "users", PATIENT_A)))
);
await check(
  "Anonymous CANNOT read a risk assessment",
  assertFails(getDoc(doc(anon, "risk_assessments", "assessment_alice")))
);
await check(
  "Anonymous CANNOT list doctors",
  assertFails(getDoc(doc(anon, "doctors", DOCTOR_1)))
);

console.log("\n=== Unknown collections are denied by default ===");

await check(
  "Nobody can write to an unlisted collection",
  assertFails(setDoc(doc(alice, "arbitrary_collection", "x"), { a: 1 }))
);

await testEnv.cleanup();

console.log(`\n${"=".repeat(60)}`);
console.log(`PASSED: ${passed}    FAILED: ${failed}`);
if (failed > 0) {
  console.log("\nFailing properties:");
  failures.forEach((name) => console.log(`  - ${name}`));
}
console.log(`${"=".repeat(60)}\n`);

process.exit(failed === 0 ? 0 : 1);
