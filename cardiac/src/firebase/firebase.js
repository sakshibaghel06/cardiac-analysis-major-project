import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { missingFirebaseConfigKeys } from "../services/firebaseConfig";

/*
=====================================================
FIREBASE INITIALISATION
=====================================================

Configuration now comes from environment variables
(cardiac/.env, see cardiac/.env.example) instead of
being hardcoded in source control.

Note on secrecy: Firebase *web* config values are not
credentials. They are shipped to every browser that
loads the app and are safe to expose. What actually
protects the data is Firestore security rules
(see firestore.rules at the repository root).

They live in .env so that a development project and a
production project can be swapped without editing code.
=====================================================
*/

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env
    .VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const missingFirebaseKeys = missingFirebaseConfigKeys(firebaseConfig);
export const firebaseConfigured = missingFirebaseKeys.length === 0;

let app = null;
let auth = null;
let db = null;
let firebaseInitializationError = null;

if (firebaseConfigured) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  } catch (error) {
    firebaseInitializationError = error;
  }
}

export { auth, db, firebaseInitializationError };

export default app;
