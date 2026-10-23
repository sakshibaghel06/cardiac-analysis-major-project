/*
=====================================================
PLAIN-LANGUAGE ASSESSMENT QUESTIONS
=====================================================

The model's nine inputs, asked the way a person would
actually understand them.

THE ENCODINGS ARE UNCHANGED. Every `value` below is the
exact code the trained model expects - chest pain stays
1-4, fasting blood sugar stays a 0/1 flag, resting ECG
stays 0/1/2. Only the WORDING is different.

That distinction matters: renaming a label is cosmetic,
but changing a value would silently corrupt every
prediction. See cardiac_ml/model_meta.json for the
authoritative encoding.

Two kinds of question, and the difference is made obvious
to the user:

  SELF      something they know or can measure at home
  REPORT    a value that only exists on a medical report

A missing report is NOT a normal result. There is no
"don't know" option that quietly maps to zero, because
that would be inventing a measurement. If someone has no
report, they cannot complete the assessment honestly, and
the form says so rather than guessing on their behalf.
=====================================================
*/

export const SOURCE = {
  SELF: "self",
  REPORT: "report",
};

/*
Chest pain type - `cp`, encoded 1-4.

The dataset calls these typical angina, atypical angina,
non-anginal pain and asymptomatic. Those terms mean
nothing to most people, so each is described by what it
actually feels like. The clinical term is kept alongside
for a doctor reviewing the record.
*/
export const CHEST_PAIN_OPTIONS = [
  {
    value: 1,
    label: "Yes - and it comes on when I exert myself, then eases when I rest",
    hint: "For example when walking fast, climbing stairs or carrying something heavy, and it settles within a few minutes of stopping.",
    clinical: "Typical angina",
  },
  {
    value: 2,
    label: "Yes - but not in that pattern",
    hint: "You do get chest discomfort, but it does not reliably come on with effort or ease with rest.",
    clinical: "Atypical angina",
  },
  {
    value: 3,
    label: "Yes - but it seems unrelated to my heart",
    hint: "For example it is sharp and brief, changes with breathing or position, or is tender when pressed.",
    clinical: "Non-anginal pain",
  },
  {
    value: 4,
    label: "No chest discomfort at all",
    hint: "You have not had pain, pressure or tightness in your chest.",
    clinical: "Asymptomatic",
  },
];

export const QUESTIONS = {
  age: {
    field: "age",
    source: SOURCE.SELF,
    step: 1,
    label: "How old are you?",
    unit: "years",
    help: "Your age in completed years.",
    min: 18,
    max: 120,
    placeholder: "e.g. 54",
  },

  sex: {
    field: "sex",
    source: SOURCE.SELF,
    step: 1,
    label: "What was your sex at birth?",
    help: "Heart risk differs between men and women, so the model uses this.",
    options: [
      { value: 1, label: "Male" },
      { value: 0, label: "Female" },
    ],
  },

  cp: {
    field: "cp",
    source: SOURCE.SELF,
    step: 2,
    label: "Do you get pain, pressure or discomfort in your chest?",
    help: "Choose the description that fits you best. If you are unsure, pick the one that sounds closest.",
    options: CHEST_PAIN_OPTIONS,
  },

  exang: {
    field: "exang",
    source: SOURCE.SELF,
    step: 2,
    label:
      "Does physical effort bring on chest discomfort?",
    help: "For example walking uphill, climbing stairs, or doing heavy work around the house or field.",
    options: [
      { value: 1, label: "Yes, effort brings it on" },
      { value: 0, label: "No, it does not" },
    ],
  },

  trestbps: {
    field: "trestbps",
    source: SOURCE.SELF,
    step: 3,
    label: "What is your blood pressure?",
    // The unit is appended to the range error message, so it has to
    // read as a unit. "The upper number" guidance lives in help.
    unit: "mm Hg",
    help:
      "Use a reading taken while you were sitting and resting. Blood pressure is written as two numbers, like 130/85 - enter the FIRST (upper) number only.",
    min: 70,
    max: 250,
    placeholder: "e.g. 130",
  },

  thalach: {
    field: "thalach",
    source: SOURCE.SELF,
    step: 3,
    label: "What is the highest your heart rate goes when you exert yourself?",
    unit: "beats per minute",
    help:
      "From a fitness band, smart watch, or a hospital exercise test. If you have never measured it, you will need to before completing this assessment.",
    caution:
      "In the original medical study this was measured during a supervised exercise test. A reading from a fitness band is usually lower, so the result is less reliable than it would be with a clinical measurement.",
    min: 60,
    max: 230,
    placeholder: "e.g. 150",
  },

  chol: {
    field: "chol",
    source: SOURCE.REPORT,
    step: 4,
    label: "What is your cholesterol number?",
    unit: "mg/dL",
    help:
      "From a recent blood test. Look for 'Total Cholesterol' on the report. It is usually a number between 150 and 300.",
    min: 100,
    max: 600,
    placeholder: "e.g. 240",
  },

  fbs: {
    field: "fbs",
    source: SOURCE.REPORT,
    step: 4,
    label: "Was your fasting blood sugar above 120 mg/dL?",
    help:
      "From a blood test taken before eating in the morning. Look for 'Fasting Blood Sugar' or 'Fasting Glucose' and compare it with 120.",
    options: [
      { value: 1, label: "Yes, it was above 120" },
      { value: 0, label: "No, it was 120 or below" },
    ],
  },

  restecg: {
    field: "restecg",
    source: SOURCE.REPORT,
    step: 4,
    label: "What did your ECG report say?",
    help:
      "An ECG (also written EKG) records your heartbeat using stickers on your chest. Choose what is written in the conclusion of your report.",
    options: [
      {
        value: 0,
        label: "Normal",
        hint: "The report says the ECG was normal, with no abnormality noted.",
        clinical: "Normal",
      },
      {
        value: 1,
        label: "It mentions ST or T wave changes",
        hint: "The report mentions 'ST depression', 'ST elevation', 'T wave inversion' or 'ST-T changes'.",
        clinical: "ST-T wave abnormality",
      },
      {
        value: 2,
        label: "It mentions thickening of the heart's left chamber",
        hint: "The report mentions 'left ventricular hypertrophy' or 'LVH'.",
        clinical: "Left ventricular hypertrophy",
      },
    ],
  },
};

/*
The form is split into four short steps rather than one
long page. Each step is a single idea, which is far less
daunting than twelve fields at once.
*/
export const STEPS = [
  {
    id: 1,
    title: "About you",
    intro: "Two quick questions to start.",
    fields: ["age", "sex"],
  },
  {
    id: 2,
    title: "How you feel",
    intro:
      "These are about your own experience. There is no right or wrong answer - just choose what fits you best.",
    fields: ["cp", "exang"],
  },
  {
    id: 3,
    title: "Your measurements",
    intro:
      "Numbers you may already have from a blood pressure machine or a fitness band.",
    fields: ["trestbps", "thalach"],
  },
  {
    id: 4,
    title: "From your test reports",
    intro:
      "These three come from a blood test and an ECG. You will need a recent report to answer them accurately.",
    fields: ["chol", "fbs", "restecg"],
    requiresReport: true,
  },
];

/*
Symptoms that need emergency care regardless of anything
the model says. Asked first, in everyday words, and acted
on immediately - a person with these symptoms must not be
told to wait for a prediction.
*/
export const URGENT_SYMPTOMS = [
  {
    id: "chestPainNow",
    label: "Severe chest pain or a crushing tightness right now",
  },
  {
    id: "breathlessAtRest",
    label: "Struggling to breathe even while sitting still",
  },
  {
    id: "fainting",
    label: "Fainted or blacked out recently",
  },
  {
    id: "armJawPain",
    label: "Pain spreading into the arm, jaw, neck or back",
  },
];

/*
Validation messages a non-technical person can act on.
"Must be between 70 and 250" says what is wrong but not
what to do, so each message also says where to find the
right number.
*/
export const validateField = (question, raw) => {
  const text = (raw ?? "").toString().trim();

  if (text === "") return "Please answer this question.";

  if (question.options) return null;

  const value = Number(text);

  if (!Number.isFinite(value)) {
    return "Please enter a number, using digits only.";
  }

  if (!Number.isInteger(value)) {
    return "Please enter a whole number.";
  }

  if (value < question.min || value > question.max) {
    return (
      `This should be between ${question.min} and ${question.max} ` +
      `${question.unit || ""}`.trim() +
      ". Please check the number and enter it again."
    );
  }

  return null;
};
