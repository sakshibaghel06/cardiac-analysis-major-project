import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
} from "firebase/auth";

import { auth } from "../firebase/firebase";
import { ensurePatientProfile } from "./roleService";

/*
=====================================================
AUTH SERVICE
=====================================================

Registration now also creates the patient's profile
document at users/{uid}.

That matters for two reasons:

  1. The /users collection was completely empty, so
     there was nowhere to store a name, and the doctor
     had nothing to read.

  2. The security rules grant a doctor read access to
     users/{patientUid} via a care link. With no
     document there, that grant resolved to nothing.

role is written once at creation and the rules forbid
changing it, so a patient cannot promote themselves to
doctor by editing their own profile.
=====================================================
*/

export const registerUser = async (email, password, name) => {
  const credential = await createUserWithEmailAndPassword(
    auth,
    email,
    password
  );

  const { user } = credential;

  if (name) {
    await updateProfile(user, { displayName: name });
  }

  /*
    role is written as "patient" here and nowhere else.
    The signup form has no role selector, and the security
    rules forbid changing role after creation, so a patient
    cannot promote themselves to doctor.

    Doctor accounts are created by an administrator directly
    in Firebase - see scripts/seed_firestore.mjs.
  */
  await ensurePatientProfile(user, name);

  return credential;
};


export const loginUser = async (email, password) => {
  const credential = await signInWithEmailAndPassword(auth, email, password);

  /*
    Self-heal for accounts created before profiles existed -
    the users collection was empty in the live database.

    A DOCTOR signing in here has no users document and the
    rules refuse to let them create one, which is correct.
    Never block the login over it.
  */
  try {
    await ensurePatientProfile(credential.user);
  } catch (error) {
    console.warn("Could not ensure patient profile:", error.code || error);
  }

  return credential;
};


export const resetPassword = (email) =>
  sendPasswordResetEmail(auth, email);

/*
Firebase error codes are not readable by a patient.
Translate the ones that actually come up.
*/
export const describeAuthError = (error) => {
  switch (error?.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password.";

    case "auth/email-already-in-use":
      return "An account already exists with this email. Try signing in.";

    case "auth/weak-password":
      return "Please choose a password of at least 6 characters.";

    case "auth/invalid-email":
      return "Please enter a valid email address.";

    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";

    case "auth/network-request-failed":
      return "Network problem. Check your connection and try again.";

    default:
      return "Something went wrong. Please try again.";
  }
};
