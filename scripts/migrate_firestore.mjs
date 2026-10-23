/*
=====================================================================
FIRESTORE DATA MIGRATION
=====================================================================

Fixes three concrete problems found by scripts/inspect_firestore.mjs:

  1. STATUS CASING
     consultation_requests currently hold both "pending" and
     "PENDING". DoctorDashboard filters on status === "pending", so
     the uppercase ones are invisible to the doctor forever.
     -> lowercase every status.

  2. DOCTOR IDENTITY
     ConsultDoctor stores  doctorId = <doctors document id>
     DoctorDashboard reads where("doctorId","==",user.uid)
     Those only agree when the document id IS the doctor's Auth uid.
     -> write an explicit `uid` field on any doctor document whose id
        is already uid-shaped, so lookups stop depending on the id.

  3. ORPHANED REQUESTS
     Some requests reference a doctorId that matches no doctor.
     -> reported, never deleted. Deleting patient records is your
        decision, not this script's.

SAFETY
------
Dry run by default. Nothing is written unless you pass --apply.

    node scripts/migrate_firestore.mjs           # show me what would change
    node scripts/migrate_firestore.mjs --apply   # actually change it

This script never creates Firebase Auth accounts and never deletes
anything.
=====================================================================
*/

import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  updateDoc,
} from "firebase/firestore";

const APPLY = process.argv.includes("--apply");

const env = {};
for (const line of readFileSync("cardiac/.env", "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match) env[match[1]] = match[2];
}

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
});

const db = getFirestore(app);

const isAuthUid = (id) => /^[A-Za-z0-9]{28}$/.test(id);

console.log("=".repeat(68));
console.log(APPLY ? "MIGRATION - APPLYING CHANGES" : "MIGRATION - DRY RUN (no writes)");
console.log(`project: ${env.VITE_FIREBASE_PROJECT_ID}`);
console.log("=".repeat(68));

const planned = [];

// ---------------------------------------------------------------
// 1. STATUS CASING
// ---------------------------------------------------------------

console.log("\n--- 1. consultation_requests.status casing ---");

const requestDocs = (await getDocs(collection(db, "consultation_requests"))).docs;

for (const snapshot of requestDocs) {
  const status = snapshot.data().status;

  if (typeof status === "string" && status !== status.toLowerCase()) {
    console.log(`  ${snapshot.id}: "${status}" -> "${status.toLowerCase()}"`);

    planned.push({
      ref: doc(db, "consultation_requests", snapshot.id),
      data: { status: status.toLowerCase() },
    });
  }
}

if (planned.length === 0) console.log("  nothing to change.");

// ---------------------------------------------------------------
// 2. DOCTOR uid FIELD
// ---------------------------------------------------------------

console.log("\n--- 2. doctors.uid ---");

const doctorDocs = (await getDocs(collection(db, "doctors"))).docs;
const unlinked = [];

for (const snapshot of doctorDocs) {
  const data = snapshot.data();

  if (data.uid) {
    console.log(`  ${snapshot.id}: already has uid, skipping`);
    continue;
  }

  if (isAuthUid(snapshot.id)) {
    console.log(`  ${snapshot.id}: id is uid-shaped -> set uid = id`);

    planned.push({
      ref: doc(db, "doctors", snapshot.id),
      data: { uid: snapshot.id },
    });
  } else {
    unlinked.push({ id: snapshot.id, name: data.name, email: data.email });
    console.log(
      `  ${snapshot.id}: auto-id, no uid, email=${data.email || "MISSING"} -> cannot link automatically`
    );
  }
}

// ---------------------------------------------------------------
// 3. ORPHANED REQUESTS  (report only)
// ---------------------------------------------------------------

console.log("\n--- 3. orphaned consultation_requests (report only) ---");

const validDoctorIds = new Set();
doctorDocs.forEach((d) => {
  validDoctorIds.add(d.id);
  if (d.data().uid) validDoctorIds.add(d.data().uid);
});

const orphans = requestDocs.filter(
  (r) => !validDoctorIds.has(r.data().doctorId)
);

if (orphans.length === 0) {
  console.log("  none.");
} else {
  console.log(`  ${orphans.length} request(s) reference an unknown doctorId:`);
  orphans.forEach((r) =>
    console.log(`    ${r.id}  doctorId=${r.data().doctorId}  status=${r.data().status}`)
  );
  console.log("  NOT deleted - review these yourself.");
}

// ---------------------------------------------------------------
// 4. BACKFILL prescriptions.unlocked
// ---------------------------------------------------------------

console.log("\n--- prescriptions.unlocked backfill ---");

/*
The patient's gate moved from a cross-document lookup to a boolean
on the prescription, because a rule that reads another document
cannot be satisfied by a list query - one locked row failed the
patient's entire dashboard.

Prescriptions written before that change have no `unlocked` field,
so a patient who has ALREADY PAID would suddenly see nothing. This
backfills them from the consultation's payment status.

Only sets it to true where the consultation really is paid. It
never unlocks anything that was not paid for.
*/

const prescriptions = (await getDocs(collection(db, "prescriptions"))).docs;

let backfilled = 0;

for (const snapshot of prescriptions) {
  const data = snapshot.data();

  if (data.unlocked !== undefined) continue;

  const consultation = requestDocs.find((r) => r.id === data.requestId);
  const isPaid = consultation?.data().paymentStatus === "paid";
  const isIssued = data.status === "issued" || data.status === undefined;

  const unlocked = Boolean(isPaid && isIssued);

  backfilled += 1;

  console.log(
    `  ${snapshot.id}: unlocked = ${unlocked}` +
      (unlocked ? "  (consultation is paid)" : "  (not paid, stays locked)")
  );

  planned.push({
    ref: doc(db, "prescriptions", snapshot.id),
    data: { unlocked },
  });
}

if (backfilled === 0) console.log("  nothing to backfill.");

// ---------------------------------------------------------------
// APPLY
// ---------------------------------------------------------------

console.log("\n" + "=".repeat(68));
console.log(`${planned.length} write(s) planned.`);

if (!APPLY) {
  console.log("DRY RUN - nothing written. Re-run with --apply to commit.");
} else if (planned.length === 0) {
  console.log("Nothing to write.");
} else {
  for (const change of planned) {
    await updateDoc(change.ref, change.data);
  }
  console.log(`Applied ${planned.length} write(s).`);
}

if (unlinked.length > 0) {
  console.log("\n" + "-".repeat(68));
  console.log("MANUAL STEP STILL REQUIRED");
  console.log("-".repeat(68));
  console.log("These doctor records have no Firebase Auth account behind them,");
  console.log("so nobody can ever log in as them and accept a consultation:");
  unlinked.forEach((d) =>
    console.log(`  - ${d.name || "(no name)"}   doc id ${d.id}`)
  );
  console.log("\nFor each one, either:");
  console.log("  (a) Firebase Console -> Authentication -> Add user, create an");
  console.log("      account, copy its UID, then add  uid: \"<that uid>\"  and");
  console.log("      an  email  field to the doctor document; or");
  console.log("  (b) set  available: false  so patients cannot select them.");
  console.log("\nThis script does not create accounts or set passwords.");
}

console.log("=".repeat(68));
process.exit(0);
