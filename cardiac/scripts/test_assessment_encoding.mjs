/*
=====================================================================
ASSESSMENT ENCODING  -  regression test
=====================================================================

The assessment was rewritten into plain language. This proves the
rewrite changed only WORDING, never the values sent to the model.

That distinction is the whole safety argument: renaming a label is
cosmetic, but changing a code would silently corrupt every
prediction without any visible error - the API would still return
200, just for a different patient than the one who filled the form.

Checked against cardiac_ml/model_meta.json, which the training
pipeline writes. If someone retrains with different encodings, this
test fails rather than the app quietly mispredicting.

Run:  node scripts/test_assessment_encoding.mjs
=====================================================================
*/

import { readFileSync } from "node:fs";

import {
  QUESTIONS,
  STEPS,
  URGENT_SYMPTOMS,
  validateField,
} from "../src/services/assessmentQuestions.js";

let passed = 0;
let failed = 0;

const check = (name, condition, detail = "") => {
  if (condition) {
    console.log(`  PASS  ${name}`);
    passed += 1;
  } else {
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
    failed += 1;
  }
};

const meta = JSON.parse(
  readFileSync("../cardiac_ml/model_meta.json", "utf8")
);

console.log("=".repeat(64));
console.log("ASSESSMENT ENCODING REGRESSION TEST");
console.log("=".repeat(64));

// ---------------------------------------------------------------
console.log("\n--- the form asks for exactly the model's features ---");

const modelFeatures = [...meta.features].sort();
const formFields = Object.keys(QUESTIONS).sort();

check(
  `model expects ${modelFeatures.length} features`,
  modelFeatures.length === 9,
  modelFeatures.join(", ")
);

check(
  "form collects exactly those features, no more, no fewer",
  JSON.stringify(modelFeatures) === JSON.stringify(formFields),
  `form has: ${formFields.join(", ")}`
);

check(
  "every feature appears on exactly one step",
  modelFeatures.every(
    (f) => STEPS.filter((s) => s.fields.includes(f)).length === 1
  )
);

// ---------------------------------------------------------------
console.log("\n--- categorical codes match the trained encoding ---");

/*
Parsed from model_meta.feature_encoding, which training wrote.

Two phrasings are in use there, so both are handled:

  "1 = typical angina, 2 = atypical angina, ..."   -> [1,2,3,4]
  "1 if fasting blood sugar > 120 mg/dl else 0"    -> [0,1]

Reading only the first form made the fbs check fail against a
perfectly correct encoding - a bug in the test, not the app.
*/
const codesFromMeta = (field) => {
  const text = meta.feature_encoding[field] || "";

  const assigned = [...text.matchAll(/(\d+)\s*=/g)].map((m) => Number(m[1]));

  if (assigned.length > 0) return [...new Set(assigned)].sort();

  // "N if <condition> else M"
  const conditional = text.match(/^\s*(\d+)\s+if\s.*\selse\s+(\d+)/i);

  if (conditional) {
    return [Number(conditional[1]), Number(conditional[2])].sort();
  }

  return [];
};

for (const field of ["cp", "restecg", "sex", "fbs", "exang"]) {
  const expected = codesFromMeta(field);
  const actual = (QUESTIONS[field].options || [])
    .map((o) => o.value)
    .sort();

  check(
    `${field}: form offers ${JSON.stringify(actual)}`,
    JSON.stringify(expected) === JSON.stringify(actual),
    `model_meta says ${JSON.stringify(expected)}`
  );
}

// The exact values the previous form was proven to send.
check(
  "cp is still 1-4, NOT the 0-3 the original broken form sent",
  JSON.stringify(QUESTIONS.cp.options.map((o) => o.value)) ===
    JSON.stringify([1, 2, 3, 4])
);

check(
  "fbs is still a 0/1 flag, not a raw mg/dL number",
  QUESTIONS.fbs.options.every((o) => [0, 1].includes(o.value)) &&
    !QUESTIONS.fbs.min
);

// ---------------------------------------------------------------
console.log("\n--- numeric ranges match the API's validation ---");

const RANGES = {
  age: [18, 120],
  trestbps: [70, 250],
  chol: [100, 600],
  thalach: [60, 230],
};

for (const [field, [min, max]] of Object.entries(RANGES)) {
  check(
    `${field}: ${QUESTIONS[field].min}-${QUESTIONS[field].max}`,
    QUESTIONS[field].min === min && QUESTIONS[field].max === max,
    `API accepts ${min}-${max}`
  );
}

// ---------------------------------------------------------------
console.log("\n--- nothing is silently defaulted ---");

check(
  "no option maps a 'do not know' answer to a real code",
  Object.values(QUESTIONS).every((q) =>
    (q.options || []).every(
      (o) =>
        !/(don'?t know|not sure|unknown|skip|n\/a)/i.test(o.label)
    )
  )
);

check(
  "an empty answer is rejected, never treated as zero",
  Object.values(QUESTIONS).every(
    (q) => validateField(q, "") !== null && validateField(q, "   ") !== null
  )
);

check(
  "zero is rejected where it is out of range, not accepted as blank",
  validateField(QUESTIONS.age, "0") !== null &&
    validateField(QUESTIONS.trestbps, "0") !== null
);

// ---------------------------------------------------------------
console.log("\n--- report-only fields are flagged as such ---");

const reportFields = Object.values(QUESTIONS)
  .filter((q) => q.source === "report")
  .map((q) => q.field)
  .sort();

check(
  "chol, fbs and restecg are marked as needing a test report",
  JSON.stringify(reportFields) === JSON.stringify(["chol", "fbs", "restecg"]),
  reportFields.join(", ")
);

check(
  "thalach carries its stress-test caveat",
  typeof QUESTIONS.thalach.caution === "string" &&
    QUESTIONS.thalach.caution.length > 40
);

// ---------------------------------------------------------------
console.log("\n--- validation messages are actionable ---");

const rangeMessage = validateField(QUESTIONS.trestbps, "999");

check(
  "an out-of-range number says what to do, not just what is wrong",
  rangeMessage.includes("70") &&
    rangeMessage.includes("250") &&
    /check/i.test(rangeMessage),
  rangeMessage
);

check(
  "non-numeric input is explained plainly",
  /digits/i.test(validateField(QUESTIONS.age, "fifty"))
);

// ---------------------------------------------------------------
console.log("\n--- urgent symptoms are plain language ---");

check(
  "four urgent symptoms, none using clinical jargon",
  URGENT_SYMPTOMS.length === 4 &&
    URGENT_SYMPTOMS.every(
      (s) => !/angina|dyspnoea|dyspnea|syncope|infarction/i.test(s.label)
    )
);

// ---------------------------------------------------------------
console.log("\n--- wording is readable ---");

/*
A crude but useful guard: the clinical terms the brief called out
must not appear as the QUESTION a user reads. They are allowed in
the "Medical term:" footnote, which is why only labels and help
text are scanned.
*/
const JARGON = [
  "typical angina",
  "atypical angina",
  "asymptomatic",
  "systolic",
  "resting electrocardiographic",
  "myocardial",
];

const userFacing = Object.values(QUESTIONS)
  .flatMap((q) => [
    q.label,
    q.help || "",
    ...(q.options || []).flatMap((o) => [o.label, o.hint || ""]),
  ])
  .join(" ")
  .toLowerCase();

for (const term of JARGON) {
  check(`"${term}" does not appear in a question or option`,
    !userFacing.includes(term));
}

// ---------------------------------------------------------------

console.log("\n" + "=".repeat(64));
console.log(`PASSED: ${passed}    FAILED: ${failed}`);
console.log("=".repeat(64));

process.exit(failed === 0 ? 0 : 1);
