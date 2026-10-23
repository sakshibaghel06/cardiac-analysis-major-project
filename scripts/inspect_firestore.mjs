/*
=====================================================================
FIRESTORE STRUCTURE DIAGNOSTIC  (READ ONLY)
=====================================================================

Answers one question the code cannot answer on its own:

    Are /doctors documents keyed by the doctor's Firebase Auth UID,
    or by an auto-generated id?

That matters because ConsultDoctor writes
    consultation_requests.doctorId = <doctors doc id>
while DoctorDashboard queries
    where("doctorId", "==", user.uid)

If those are different values, every doctor sees an empty dashboard.

PRIVACY
-------
This script prints STRUCTURE ONLY: collection sizes, field names,
id shapes and whether ids line up. It never prints a field value
from a patient record, and never writes anything.

Run from the repo root:
    node scripts/inspect_firestore.mjs
=====================================================================
*/

import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  limit,
  query,
} from "firebase/firestore";

// ---- load cardiac/.env without adding a dependency ----------------

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

// A Firebase Auth uid is 28 chars of [A-Za-z0-9]; Firestore auto-ids
// are 20 chars. That is enough to tell them apart reliably.
const shapeOf = (id) => {
  if (/^[A-Za-z0-9]{28}$/.test(id)) return "auth-uid (28)";
  if (/^[A-Za-z0-9]{20}$/.test(id)) return "firestore auto-id (20)";
  return `custom (${id.length} chars)`;
};

const redact = (value) => {
  if (value === null || value === undefined) return String(value);
  if (typeof value === "object") {
    if (typeof value.toDate === "function") return "<timestamp>";
    if (Array.isArray(value)) return `<array[${value.length}]>`;
    return `<object{${Object.keys(value).slice(0, 8).join(",")}}>`;
  }
  return `<${typeof value}>`;
};

async function peek(name, max = 50) {
  try {
    const snapshot = await getDocs(query(collection(db, name), limit(max)));
    return snapshot.docs;
  } catch (error) {
    console.log(`  !! could not read /${name}: ${error.code || error.message}`);
    return null;
  }
}

console.log("=".repeat(68));
console.log(`PROJECT: ${env.VITE_FIREBASE_PROJECT_ID}   (read-only inspection)`);
console.log("=".repeat(68));

// ---- collection sizes --------------------------------------------

const COLLECTIONS = [
  "users", "doctors", "patients", "hospitals",
  "risk_assessments", "consultation_requests", "consultations",
  "video_rooms", "prescriptions", "payments", "care_links",
  "health_profiles", "health_records",
];

console.log("\n--- COLLECTIONS ---");
const found = {};
for (const name of COLLECTIONS) {
  const docs = await peek(name);
  if (docs === null) continue;
  found[name] = docs;
  console.log(`  ${name.padEnd(24)} ${String(docs.length).padStart(3)} doc(s)${docs.length === 50 ? "+ (capped)" : ""}`);
}

// ---- the key question --------------------------------------------

console.log("\n--- /doctors DOCUMENT IDs ---");
const doctors = found.doctors || [];

if (doctors.length === 0) {
  console.log("  /doctors is EMPTY - nothing to compare.");
} else {
  for (const d of doctors) {
    const data = d.data();
    console.log(`  id=${d.id}`);
    console.log(`     shape      : ${shapeOf(d.id)}`);
    console.log(`     has uid?   : ${data.uid ? `yes ("${data.uid}")` : "NO uid field"}`);
    console.log(`     uid == id? : ${data.uid ? (data.uid === d.id ? "YES" : "NO - MISMATCH") : "n/a"}`);
    console.log(`     fields     : ${Object.keys(data).sort().join(", ")}`);
  }
}

// ---- how requests reference doctors ------------------------------

console.log("\n--- /consultation_requests -> doctorId ---");
const requests = found.consultation_requests || [];

if (requests.length === 0) {
  console.log("  no consultation requests yet.");
} else {
  const doctorDocIds = new Set(doctors.map((d) => d.id));
  const doctorUids = new Set(
    doctors.map((d) => d.data().uid).filter(Boolean)
  );

  let matchesDocId = 0;
  let matchesUid = 0;
  let matchesNeither = 0;

  for (const r of requests) {
    const { doctorId } = r.data();
    if (doctorDocIds.has(doctorId)) matchesDocId += 1;
    else if (doctorUids.has(doctorId)) matchesUid += 1;
    else matchesNeither += 1;
  }

  console.log(`  total requests inspected : ${requests.length}`);
  console.log(`  doctorId == a doctors doc id : ${matchesDocId}`);
  console.log(`  doctorId == a doctors.uid    : ${matchesUid}`);
  console.log(`  doctorId matches neither     : ${matchesNeither}`);

  const sample = requests[0].data();
  console.log(`\n  field shape of a request (values redacted):`);
  for (const key of Object.keys(sample).sort()) {
    console.log(`     ${key.padEnd(18)} ${redact(sample[key])}`);
  }

  const statuses = {};
  requests.forEach((r) => {
    const s = r.data().status || "(none)";
    statuses[s] = (statuses[s] || 0) + 1;
  });
  console.log(`\n  status values in use: ${JSON.stringify(statuses)}`);
}

// ---- risk_assessments shape --------------------------------------

console.log("\n--- /risk_assessments SHAPE ---");
const assessments = found.risk_assessments || [];

if (assessments.length === 0) {
  console.log("  none yet.");
} else {
  const withFeatures = assessments.filter((a) => a.data().features).length;
  console.log(`  total inspected      : ${assessments.length}`);
  console.log(`  new shape (features) : ${withFeatures}`);
  console.log(`  legacy flat shape    : ${assessments.length - withFeatures}`);
  console.log(`  fields on newest     : ${Object.keys(assessments[0].data()).sort().join(", ")}`);
}

// ---- whether rules are already locked down ------------------------

console.log("\n--- SECURITY POSTURE ---");
console.log(
  Object.keys(found).length > 0
    ? "  !! This script read your database WITHOUT signing in.\n" +
      "     Firestore is currently in OPEN / TEST mode.\n" +
      "     Deploy the rules:  firebase deploy --only firestore:rules"
    : "  Reads were refused - rules appear to be enforced already."
);

console.log("\n" + "=".repeat(68));
process.exit(0);
