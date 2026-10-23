/*
=====================================================================
PROVIDER SETTLEMENT CONFIGURATION  (administrator only)
=====================================================================

Maps a hospital to its verified Razorpay Route linked account, so
the backend knows where that hospital's consultation fees should be
transferred.

WHY THIS IS A SCRIPT AND NOT A SCREEN IN THE APP
------------------------------------------------
A payout destination decides where money goes. Putting it behind an
ordinary profile form would mean:

  * a doctor could redirect their hospital's revenue to an account
    of their choosing
  * a compromised doctor login becomes a financial attack

So the settlement mapping is administrator-only, performed with
administrator credentials, and written to a path that
firestore.rules denies to every client:

    hospitals/{hospitalId}/private/settlement

The hospital document itself stays readable - patients need it to
choose where to be seen - but carries no payout information.

WHAT THIS SCRIPT DOES NOT DO
----------------------------
It does not create a Razorpay linked account, and it cannot verify
one. Razorpay Route requires:

  1. Route activated on your Razorpay account (request it in the
     dashboard; it is not on by default)
  2. A linked account created per hospital, through Razorpay's own
     onboarding
  3. KYC completed and the account activated BY RAZORPAY

Only after Razorpay has activated an account should it be marked
verified here. Marking it verified early does not make transfers
work - it makes them fail at payment time, after the patient has
paid.

USAGE
    export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
    npm install --no-save firebase-admin

    node scripts/configure_provider.mjs --list
    node scripts/configure_provider.mjs --hospital <id> --account acc_XXXX --status pending
    node scripts/configure_provider.mjs --hospital <id> --status verified --apply
=====================================================================
*/

import { connect } from "./admin.mjs";

const args = process.argv.slice(2);

const flag = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : null;
};

const has = (name) => args.includes(`--${name}`);

const APPLY = has("apply");

const { db, projectId } = await connect();

console.log("=".repeat(70));
console.log(
  APPLY ? "PROVIDER CONFIG - APPLYING" : "PROVIDER CONFIG - DRY RUN (no writes)"
);
console.log(`project: ${projectId}`);
console.log("=".repeat(70));

// ---------------------------------------------------------------
// LIST
// ---------------------------------------------------------------

if (has("list") || args.length === 0) {
  const hospitals = await db.collection("hospitals").get();

  if (hospitals.empty) {
    console.log("\nNo hospitals are configured.");
    process.exit(0);
  }

  console.log("\n--- hospitals and settlement status ---\n");

  for (const hospital of hospitals.docs) {
    const data = hospital.data();

    const settlement = await hospital.ref
      .collection("private")
      .doc("settlement")
      .get();

    const s = settlement.exists ? settlement.data() : {};

    const status = s.payoutOnboardingStatus || "not configured";
    const account = s.razorpayLinkedAccountId || "-";

    const willTransfer =
      s.razorpayLinkedAccountId && s.payoutOnboardingStatus === "verified";

    console.log(`  ${data.name || "(unnamed)"}`);
    console.log(`     id              ${hospital.id}`);
    console.log(`     location        ${data.location || "-"}`);
    console.log(`     linked account  ${account}`);
    console.log(`     onboarding      ${status}`);
    console.log(
      `     on payment      ${
        willTransfer
          ? "TRANSFER to this hospital's linked account"
          : "collect to the PLATFORM account, recipient recorded for " +
            "manual reconciliation"
      }`
    );
    console.log("");
  }

  console.log(
    "Only a hospital whose linked account is BOTH present AND verified\n" +
      "receives an automatic transfer. Everything else collects centrally\n" +
      "and is recorded against the hospital for reconciliation.\n"
  );

  process.exit(0);
}

// ---------------------------------------------------------------
// CONFIGURE
// ---------------------------------------------------------------

const hospitalId = flag("hospital");
const account = flag("account");
const status = flag("status");

if (!hospitalId) {
  console.error(
    "\n--hospital <id> is required.\n\n" +
      "  node scripts/configure_provider.mjs --list\n"
  );
  process.exit(1);
}

const VALID = ["not_started", "pending", "verified", "suspended"];

if (status && !VALID.includes(status)) {
  console.error(`\n--status must be one of: ${VALID.join(", ")}\n`);
  process.exit(1);
}

if (account && !/^acc_[A-Za-z0-9]+$/.test(account)) {
  console.error(
    "\nA Razorpay linked account id looks like acc_XXXXXXXXXXXX.\n" +
      "Create it through Razorpay's onboarding, then paste the id here.\n"
  );
  process.exit(1);
}

const hospitalRef = db.collection("hospitals").doc(hospitalId);
const hospital = await hospitalRef.get();

if (!hospital.exists) {
  console.error(`\nhospitals/${hospitalId} does not exist.\n`);
  process.exit(1);
}

const patch = { updatedAt: new Date() };

if (account) patch.razorpayLinkedAccountId = account;
if (status) patch.payoutOnboardingStatus = status;

console.log(`\nHospital: ${hospital.data().name || hospitalId}`);
console.log("Writing to hospitals/%s/private/settlement:", hospitalId);

for (const [key, value] of Object.entries(patch)) {
  if (key !== "updatedAt") console.log(`  ${key} = ${value}`);
}

if (status === "verified") {
  console.log(
    "\n  WARNING: marking an account verified tells the backend to send\n" +
      "  real transfers to it. Only do this once RAZORPAY has activated\n" +
      "  the linked account. Marking it early does not make transfers\n" +
      "  work - it makes them fail after the patient has already paid."
  );
}

if (!APPLY) {
  console.log("\nDRY RUN - nothing written. Re-run with --apply to commit.");
  process.exit(0);
}

await hospitalRef.collection("private").doc("settlement").set(patch, {
  merge: true,
});

console.log("\nApplied.");
console.log("=".repeat(70));

process.exit(0);
