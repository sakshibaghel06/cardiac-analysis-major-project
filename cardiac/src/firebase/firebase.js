import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

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

/*
Fail loudly at startup instead of producing confusing
"permission denied" / "invalid API key" errors later on
when somebody has forgotten to create their .env file.
*/

const missingKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingKeys.length > 0) {
  throw new Error(
    "Firebase configuration is incomplete. Missing: " +
      missingKeys.join(", ") +
      ". Copy cardiac/.env.example to cardiac/.env and fill it in, " +
      "then restart the dev server (Vite only reads .env at startup)."
  );
}

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

export const db = getFirestore(app);

export default app;
