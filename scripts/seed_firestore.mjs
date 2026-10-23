/*
=====================================================================
FIRESTORE SEEDING  -  doctors, roles and hospital details
=====================================================================

Brings the live database up to the shape the app and the security
rules both expect.

WHAT IT DOES

  1. doctors/{authUid}
     Both roleService.resolveRole() and firestore.rules ask the same
     question:  does a document exist at doctors/{request.auth.uid}?

     Rules cannot run a query, so a "uid" FIELD on a differently-keyed
     document is useless to them. The document ID must BE the uid.

     Two of the existing doctor records use auto-generated IDs, so
     this re-keys them: it copies the data to doctors/{uid} and marks
     the old document available:false with a supersededBy pointer.
     Nothing is deleted.

  2. role: "doctor"
     Written on every doctor document, matching role: "patient" on
     users/*, so both collections are self-describing.

  3. consultationFee
     No doctor record had one, so the payment step could never quote
     a real price and fell back to a constant.

  4. Hospital latitude / longitude
     Optional. Without them the emergency screen falls back to a maps
     search by name, which works fine.

  5. Status casing
     consultation_requests written as "PENDING" are lowercased, so the
     doctor dashboard's status === "pending" filter sees them.

SAFETY
  Dry run by default. Nothing is written without --apply.
  Never deletes. Never creates Auth accounts. Never sets passwords.

USAGE
  cp scripts/seed.config.example.json scripts/seed.config.json
  # fill in the UIDs from Firebase Console -> Authentication
  node scripts/seed_firestore.mjs
  node scripts/seed_firestore.mjs --apply
=====================================================================
*/

import { existsSync, readFileSync } from "node:fs";

import { initializeApp } from "firebase/app";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

const APPLY = process.argv.includes("--apply");

const CONFIG_PATH = "scripts/seed.config.json";

if (!existsSync(CONFIG_PATH)) {
  console.error(
    `\n${CONFIG_PATH} not found.\n\n` +
      "  cp scripts/seed.config.example.json scripts/seed.config.json\n\n" +
      "Then fill in each doctor's Auth UID (Firebase Console -> " +
      "Authentication -> Users) and re-run.\n"
  );
  process.exit(1);
}

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));

// ---- Firebase -------------------------------------------------------

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

const isAuthUid = (id) => typeof id === "string" && /^[A-Za-z0-9]{28}$/.test(id);

const writes = [];
const warnings = [];

const plan = (label, run) => {
  console.log(`  ${label}`);
  writes.push(run);
};

console.log("=".repeat(70));
console.log(APPLY ? "SEEDING - APPLYING" : "SEEDING - DRY RUN (no writes)");
console.log(`project: ${env.VITE_FIREBASE_PROJECT_ID}`);
console.log("=".repeat(70));

// =====================================================================
// 1. DOCTORS
// =====================================================================

console.log("\n--- doctors ---");

for (const entry of config.doctors || []) {
  const { existingDocId, uid, email, consultationFee } = entry;

  const sourceSnapshot = await getDoc(doc(db, "doctors", existingDocId));

  if (!sourceSnapshot.exists()) {
    warnings.push(`doctors/${existingDocId} does not exist - skipped`);
    console.log(`  ${existingDocId}: NOT FOUND, skipped`);
    continue;
  }

  const source = sourceSnapshot.data();
  const name = source.name || "(unnamed)";

  if (!uid) {
    warnings.push(
      `${name} (${existingDocId}) has no uid in the config - this doctor ` +
        `still cannot sign in`
    );
    console.log(`  ${name}: no uid configured -> SKIPPED (cannot sign in)`);
    continue;
  }

  if (!isAuthUid(uid)) {
    warnings.push(`${name}: "${uid}" is not a 28-character Auth UID`);
    console.log(`  ${name}: uid "${uid}" is not 28 chars -> SKIPPED`);
    continue;
  }

  const target = {
    ...source,
    uid,
    role: "doctor",
    email: email || source.email || "",
    consultationFee:
      typeof consultationFee === "number"
        ? consultationFee
        : source.consultationFee ?? 500,
    available: source.available ?? true,
    updatedAt: serverTimestamp(),
  };

  if (existingDocId === uid) {
    // Already correctly keyed - just top up the missing fields.
    plan(
      `${name}: already keyed by uid -> add role/email/consultationFee`,
      () => setDoc(doc(db, "doctors", uid), target, { merge: true })
    );
  } else {
    plan(
      `${name}: RE-KEY ${existingDocId} -> doctors/${uid}`,
      async () => {
        await setDoc(doc(db, "doctors", uid), target, { merge: true });

        // Retire the old record rather than deleting it.
        await updateDoc(doc(db, "doctors", existingDocId), {
          available: false,
          supersededBy: uid,
          updatedAt: serverTimestamp(),
        });
      }
    );

    console.log(
      `     old document kept, marked available:false, supersededBy:${uid}`
    );
  }
}

// =====================================================================
// 2. HOSPITALS
// =====================================================================

console.log("\n--- hospitals ---");

for (const entry of config.hospitals || []) {
  const { docId, latitude, longitude } = entry;

  if (latitude == null || longitude == null) {
    console.log(`  ${docId}: no coordinates configured -> skipped`);
    console.log(
      "     (the emergency screen falls back to a maps search by name)"
    );
    continue;
  }

  plan(`${docId}: set latitude/longitude`, () =>
    updateDoc(doc(db, "hospitals", docId), {
      latitude,
      longitude,
      updatedAt: serverTimestamp(),
    })
  );
}

// =====================================================================
// 3. STATUS CASING
// =====================================================================

console.log("\n--- consultation_requests status casing ---");

const requests = await getDocs(collection(db, "consultation_requests"));

let casingFixes = 0;

for (const snapshot of requests.docs) {
  const status = snapshot.data().status;

  if (typeof status === "string" && status !== status.toLowerCase()) {
    casingFixes += 1;

    plan(`${snapshot.id}: "${status}" -> "${status.toLowerCase()}"`, () =>
      updateDoc(doc(db, "consultation_requests", snapshot.id), {
        status: status.toLowerCase(),
        updatedAt: serverTimestamp(),
      })
    );
  }
}

if (casingFixes === 0) console.log("  nothing to change.");

// =====================================================================
// APPLY
// =====================================================================

console.log("\n" + "=".repeat(70));
console.log(`${writes.length} change(s) planned.`);

if (!APPLY) {
  console.log("DRY RUN - nothing written. Re-run with --apply to commit.");
} else if (writes.length === 0) {
  console.log("Nothing to write.");
} else {
  for (const run of writes) await run();
  console.log(`Applied ${writes.length} change(s).`);
}

if (warnings.length > 0) {
  console.log("\n" + "-".repeat(70));
  console.log("ATTENTION");
  console.log("-".repeat(70));
  warnings.forEach((warning) => console.log(`  - ${warning}`));
  console.log(
    "\nA doctor without an Auth UID cannot sign in, so patients must not " +
      "be able to select them. Either create the account in Firebase " +
      "Console -> Authentication and re-run, or set available:false on " +
      "that doctor record."
  );
}

console.log("=".repeat(70));
process.exit(0);
