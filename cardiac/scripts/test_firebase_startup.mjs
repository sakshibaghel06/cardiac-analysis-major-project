import assert from "node:assert/strict";

import { missingFirebaseConfigKeys } from "../src/services/firebaseConfig.js";

const requiredKeys = [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
];

const emptyConfig = Object.fromEntries(requiredKeys.map((key) => [key, ""]));

assert.deepEqual(missingFirebaseConfigKeys(emptyConfig), requiredKeys);

const configured = Object.fromEntries(
  requiredKeys.map((key) => [key, `configured-${key}`])
);

assert.deepEqual(missingFirebaseConfigKeys(configured), []);

assert.deepEqual(
  missingFirebaseConfigKeys({ ...configured, storageBucket: "   " }),
  ["storageBucket"]
);

console.log("Firebase startup configuration checks passed (3 assertions).");
