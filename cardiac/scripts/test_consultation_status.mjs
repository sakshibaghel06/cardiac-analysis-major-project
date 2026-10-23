/*
=====================================================================
REGRESSION  -  consultation status synchronisation
=====================================================================

The reported bug:

    The doctor accepts. The patient sees "Accepted". The doctor
    clicks Join Consultation. The patient's page flips back to
    "Pending" and the patient can no longer join.

The status was never reset. markConsultationInProgress moves the
consultation accepted -> in_progress when the doctor joins, and that
is correct: it is how the patient's screen can say the doctor is
already waiting.

What was wrong is that the screens compared the status themselves:

    status === "accepted"

so the instant it became "in_progress", the patient's Join button
stopped rendering and their status text fell through to its final
else branch - which happened to read "Pending".

These tests pin the behaviour that makes that impossible to
reintroduce: every status has a label, both joinable states are
joinable for BOTH roles, and no status silently falls through.

Run:  node scripts/test_consultation_status.mjs
=====================================================================
*/

import {
  STATUS,
  isActive,
  isFinished,
  isJoinable,
  joinLabel,
  normaliseStatus,
  statusHelp,
  statusLabel,
} from "../src/services/consultationStatus.js";

let passed = 0;
let failed = 0;

const check = (name, fn) => {
  try {
    const result = fn();

    if (result === true) {
      console.log(`  PASS  ${name}`);
      passed += 1;
    } else {
      console.log(`  FAIL  ${name}`);
      console.log(`        ${result}`);
      failed += 1;
    }
  } catch (error) {
    console.log(`  FAIL  ${name}`);
    console.log(`        threw: ${error.message}`);
    failed += 1;
  }
};

const ALL = Object.values(STATUS);

console.log("=".repeat(70));
console.log("CONSULTATION STATUS SYNCHRONISATION");
console.log("=".repeat(70));

// -----------------------------------------------------------------
console.log("\n--- the reported bug ---");

check(
  "in_progress is JOINABLE  (the patient is not locked out mid-call)",
  () => isJoinable(STATUS.IN_PROGRESS) || "in_progress was not joinable"
);

check(
  "in_progress does NOT read as pending",
  () => {
    const label = statusLabel(STATUS.IN_PROGRESS).toLowerCase();

    if (label.includes("pending") || label.includes("waiting")) {
      return `in_progress is labelled "${statusLabel(STATUS.IN_PROGRESS)}"`;
    }

    return true;
  }
);

check(
  "in_progress is still an ACTIVE consultation",
  () => isActive(STATUS.IN_PROGRESS) || "in_progress was not active"
);

check(
  "in_progress is NOT finished",
  () => !isFinished(STATUS.IN_PROGRESS) || "in_progress counted as finished"
);

check(
  "accepted and in_progress are BOTH joinable - one shared set",
  () =>
    (isJoinable(STATUS.ACCEPTED) && isJoinable(STATUS.IN_PROGRESS)) ||
    "the two joinable states disagree"
);

// -----------------------------------------------------------------
console.log("\n--- nothing falls through ---");

check("every status has a non-empty label", () => {
  const missing = ALL.filter((s) => !statusLabel(s) || statusLabel(s) === s);
  return missing.length === 0 || `no label for: ${missing.join(", ")}`;
});

check("every status has non-empty help text", () => {
  const missing = ALL.filter((s) => !statusHelp(s));
  return missing.length === 0 || `no help text for: ${missing.join(", ")}`;
});

check("every status is active XOR finished - none is neither", () => {
  const orphans = ALL.filter((s) => isActive(s) === isFinished(s));
  return (
    orphans.length === 0 ||
    `neither active nor finished (or both): ${orphans.join(", ")}`
  );
});

// -----------------------------------------------------------------
console.log("\n--- states that must NOT be joinable ---");

for (const status of [
  STATUS.PENDING,
  STATUS.REJECTED,
  STATUS.CANCELLED,
  STATUS.COMPLETED,
]) {
  check(`${status} is not joinable`, () =>
    !isJoinable(status) || `${status} offered a Join button`
  );
}

// -----------------------------------------------------------------
console.log("\n--- button wording ---");

check(
  "a live call says Rejoin, an accepted one says Join",
  () =>
    (joinLabel(STATUS.IN_PROGRESS) === "Rejoin Consultation" &&
      joinLabel(STATUS.ACCEPTED) === "Join Video Consultation") ||
    `got "${joinLabel(STATUS.IN_PROGRESS)}" / "${joinLabel(STATUS.ACCEPTED)}"`
);

// -----------------------------------------------------------------
console.log("\n--- defensive input handling ---");

/*
Older documents were written with uppercase statuses, which is what
scripts/migrate_firestore.mjs lowercases. Until that has run on every
record, a screen may still be handed "IN_PROGRESS".
*/
check("IN_PROGRESS (legacy uppercase) is still joinable", () =>
  isJoinable("IN_PROGRESS") || "uppercase legacy status was not joinable"
);

check("ACCEPTED (legacy uppercase) is still joinable", () =>
  isJoinable("ACCEPTED") || "uppercase legacy status was not joinable"
);

check("a missing status degrades to pending, never to joinable", () => {
  if (normaliseStatus(undefined) !== STATUS.PENDING) {
    return `undefined normalised to ${normaliseStatus(undefined)}`;
  }

  if (isJoinable(undefined) || isJoinable(null)) {
    return "a missing status offered a Join button";
  }

  return true;
});

check("an unknown status is not joinable and not active", () => {
  if (isJoinable("banana")) return "unknown status was joinable";
  if (isActive("banana")) return "unknown status was active";
  return true;
});

console.log("\n" + "=".repeat(70));
console.log(`PASSED: ${passed}    FAILED: ${failed}`);
console.log("=".repeat(70));

process.exit(failed === 0 ? 0 : 1);
