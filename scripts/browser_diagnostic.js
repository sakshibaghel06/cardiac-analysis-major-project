/* =====================================================================
   CROSS-BROWSER DIAGNOSTIC
   =====================================================================

   Paste this into the browser console (F12 -> Console) in EACH browser
   while signed in, and send me both outputs.

   It answers the one question I cannot answer from the code alone:

       does the signed-in doctor's Auth UID actually match the
       doctorId on the consultation they are trying to accept?

   The doctor error "You are not authorised to respond to this
   consultation" is a Firestore permission-denied. Every rule involved
   compares request.auth.uid against a stored id, so the fix depends
   on which id is wrong - and only your live data knows that.

   SAFE TO RUN AND SAFE TO SHARE:
     - read-only, writes nothing
     - prints UIDs, document ids and status values
     - prints NO health data, no names, no email addresses
   ===================================================================== */

(async () => {
  const { getAuth } = await import(
    "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js"
  );
  const { getFirestore, doc, getDoc, collection, query, where, getDocs } =
    await import(
      "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js"
    );

  const auth = getAuth();
  const db = getFirestore();
  const user = auth.currentUser;

  const line = (s = "") => console.log(s);
  const mask = (v) => (v ? `${String(v).slice(0, 8)}…(${String(v).length})` : "(none)");

  line("=".repeat(62));
  line("CARDIOCARE DIAGNOSTIC");
  line("=".repeat(62));

  if (!user) {
    line("NOT SIGNED IN in this browser. Sign in, then re-run.");
    return;
  }

  line(`auth uid        : ${user.uid}`);
  line(`uid length      : ${user.uid.length}  (a Firebase Auth uid is 28)`);
  line(`email verified  : ${user.emailVerified}`);
  line("");

  // ---- which role does the app resolve? ----
  let isDoctor = false;

  try {
    const doctorDoc = await getDoc(doc(db, "doctors", user.uid));
    isDoctor = doctorDoc.exists();

    line(`doctors/${user.uid}`);
    line(`  exists        : ${isDoctor}   <-- this IS the rules' isDoctor()`);

    if (isDoctor) {
      const d = doctorDoc.data();
      line(`  uid field     : ${d.uid || "(absent)"}`);
      line(`  uid == doc id : ${d.uid === user.uid}`);
      line(`  role field    : ${d.role || "(absent)"}`);
      line(`  available     : ${d.available}`);
      line(`  hospitalId    : ${d.hospitalId || "(absent)"}`);
    }
  } catch (error) {
    line(`  READ FAILED   : ${error.code}`);
  }

  line("");

  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    line(`users/${user.uid}`);
    line(`  exists        : ${userDoc.exists()}`);
    if (userDoc.exists()) line(`  role field    : ${userDoc.data().role}`);
  } catch (error) {
    line(`  READ FAILED   : ${error.code}`);
  }

  line("");
  line("-".repeat(62));
  line("CONSULTATIONS THIS ACCOUNT CAN SEE");
  line("-".repeat(62));

  for (const field of ["patientId", "doctorId"]) {
    try {
      const snap = await getDocs(
        query(
          collection(db, "consultation_requests"),
          where(field, "==", user.uid)
        )
      );

      line(`\nwhere ${field} == my uid  ->  ${snap.size} result(s)`);

      snap.forEach((d) => {
        const c = d.data();
        line(`  ${d.id}`);
        line(`     status          ${c.status}`);
        line(`     patientId       ${mask(c.patientId)}`);
        line(`     doctorId        ${mask(c.doctorId)}`);
        line(`     doctorId == me  ${c.doctorId === user.uid}`);
        line(`     patientId == me ${c.patientId === user.uid}`);
        line(`     report keys     ${Object.keys(c.report || {}).join(", ") || "(EMPTY)"}`);
        line(`     paymentStatus   ${c.paymentStatus || "(absent)"}`);
      });
    } catch (error) {
      line(`\nwhere ${field} == my uid  ->  DENIED (${error.code})`);
    }
  }

  line("");
  line("-".repeat(62));
  line("THE THREE DASHBOARD QUERIES");
  line("-".repeat(62));

  const probe = async (label, run) => {
    try {
      const snap = await run();
      line(`  OK      ${label}  (${snap.size})`);
    } catch (error) {
      line(`  DENIED  ${label}  -> ${error.code}`);
      if (error.code === "failed-precondition") {
        line("          (a composite index is missing - deploy indexes)");
      }
    }
  };

  await probe("risk_assessments where uid == me", () =>
    getDocs(query(collection(db, "risk_assessments"), where("uid", "==", user.uid)))
  );

  await probe("consultation_requests where patientId == me", () =>
    getDocs(
      query(
        collection(db, "consultation_requests"),
        where("patientId", "==", user.uid)
      )
    )
  );

  await probe("prescriptions where patientId == me + unlocked", () =>
    getDocs(
      query(
        collection(db, "prescriptions"),
        where("patientId", "==", user.uid),
        where("unlocked", "==", true)
      )
    )
  );

  if (isDoctor) {
    await probe("prescriptions where doctorId == me", () =>
      getDocs(
        query(collection(db, "prescriptions"), where("doctorId", "==", user.uid))
      )
    );
  }

  line("");
  line("=".repeat(62));
  line("Send BOTH browsers' output. Nothing above is health data.");
  line("=".repeat(62));
})();
