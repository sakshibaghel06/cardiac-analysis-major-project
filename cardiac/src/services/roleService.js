import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

import { db } from "../firebase/firebase";

/*
=====================================================
ROLE SERVICE
=====================================================

One login page serves both roles. After Firebase
Authentication verifies the credentials, this decides
where the user goes.

Resolution order:

  1. doctors/{uid} exists        -> doctor
  2. users/{uid}.role === ...    -> that role
  3. signed in, no record        -> patient

Rule 1 comes first and is deliberately the SAME test the
Firestore security rules apply (`exists(/doctors/$(uid))`).
If the UI and the rules disagreed about who is a doctor,
the UI would show pages the database then refuses to fill.

A doctor is therefore defined by the existence of a
document at doctors/{their Auth UID}. That document is
created by an administrator, never by the app, which is
why doctors cannot self-register.
=====================================================
*/

export const ROLES = {
  PATIENT: "patient",
  DOCTOR: "doctor",
};

export const homeRouteFor = (role) =>
  role === ROLES.DOCTOR ? "/doctor/dashboard" : "/patient/dashboard";

/*
Returns { role, profile }.

`profile` is the doctors document for a doctor, or the
users document for a patient, so callers get the display
name without a second round trip.
*/
export const resolveRole = async (user) => {
  if (!user) return { role: null, profile: null };

  try {
    const doctorDoc = await getDoc(doc(db, "doctors", user.uid));

    if (doctorDoc.exists()) {
      return {
        role: ROLES.DOCTOR,
        profile: { id: doctorDoc.id, ...doctorDoc.data() },
      };
    }
  } catch (error) {
    /*
      A patient reading doctors/{someone else} is refused by
      the rules, but doctors/{their own uid} is allowed, so a
      denial here simply means "not a doctor". Never fail the
      login over it.
    */
    console.warn("Doctor lookup failed:", error.code || error);
  }

  /*
    NOTE: a users/{uid} document can NEVER confer the doctor role,
    however its `role` field reads.

    This previously returned DOCTOR when users/{uid}.role was
    "doctor". But the security rules decide doctorhood with

        exists(/databases/$(db)/documents/doctors/$(request.auth.uid))

    and nothing else. So such a user was shown the whole doctor
    interface while the database refused every write they made -
    surfacing as "You are not authorised to respond to this
    consultation" on a consultation genuinely assigned to them.

    The UI must apply exactly the test the rules apply. Anyone
    without a doctors/{uid} document is a patient here, because
    that is what they are to Firestore.
  */
  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));

    if (userDoc.exists()) {
      return {
        role: ROLES.PATIENT,
        profile: { id: userDoc.id, ...userDoc.data() },
      };
    }
  } catch (error) {
    console.warn("Profile lookup failed:", error.code || error);
  }

  /*
    Signed in with no record anywhere. Fail to the LOWER
    privilege, never the higher one.
  */
  return { role: ROLES.PATIENT, profile: null };
};

/*
Creates users/{uid} for a patient if it is missing.

The live users collection was empty, which mattered for two
reasons: there was nowhere to store a name, and the rule
that lets a doctor read users/{patientUid} through a care
link resolved to nothing.

role is written once here. The rules forbid changing it, so
a patient cannot promote themselves to doctor.
*/
export const ensurePatientProfile = async (user, name) => {
  if (!user) return null;

  const ref = doc(db, "users", user.uid);

  const existing = await getDoc(ref);

  if (existing.exists()) {
    return { id: existing.id, ...existing.data() };
  }

  const profile = {
    uid: user.uid,
    name: name || user.displayName || "",
    email: user.email || "",
    role: ROLES.PATIENT,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(ref, profile);

  return { id: user.uid, ...profile };
};


/*
Does Firestore consider this user a doctor?

The SAME test the security rules apply, exposed so a write path can
check before it tries - and explain precisely why it would fail
rather than surfacing a bare permission-denied.
*/
export const hasDoctorRecord = async (uid) => {
  if (!uid) return false;

  try {
    const snapshot = await getDoc(doc(db, "doctors", uid));
    return snapshot.exists();
  } catch {
    return false;
  }
};
