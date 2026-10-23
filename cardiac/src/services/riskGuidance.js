/*
=====================================================
RISK BRANCHING
=====================================================

Where the three bands come from
-------------------------------
The model is BINARY. It predicts one thing: whether
significant coronary artery narrowing is likely to be
present, as a probability between 0 and 1.

Three labels therefore have to be justified, not
invented. The two cut points are MEASURED from the data
in cardiac_ml/train_model.py and stored in
model_meta.json, so the API sends them with every result:

  low_max   the highest probability at which sensitivity
            is still >= 0.90. Below it the model rarely
            misses disease, so "Low" is safe to report.

  high_min  the lowest probability at which specificity
            is >= 0.90. Above it false alarms are
            uncommon, so "High" is meaningful.

Anything between is Moderate - genuinely uncertain.

Sensitivity drives the lower cut because in a screening
tool a missed case costs far more than a false alarm.

These are MODEL-PROBABILITY bands, not clinical risk
categories. They are not Framingham, ASCVD or QRISK
tiers and must never be presented as such.

Full derivation: cardiac_ml/FEATURE_ANALYSIS.md section 4.
=====================================================
*/

export const RISK = {
  LOW: "LOW",
  MODERATE: "MODERATE",
  HIGH: "HIGH",
};

export const normaliseRisk = (value) => {
  const text = String(value || "").toUpperCase();

  if (text === RISK.LOW || text === RISK.HIGH) return text;

  // Legacy records were written as "MEDIUM".
  return RISK.MODERATE;
};

/*
What each band means, and what the patient should do next.

Wording rules applied throughout:
  - never "you have heart disease"
  - never a diagnosis
  - a LOW result is never presented as reassurance, because
    measured recall is about 0.69 - roughly three in ten true
    cases are missed
*/
export const GUIDANCE = {
  [RISK.LOW]: {
    heading: "Lower estimated risk",
    summary:
      "Your current assessment indicates a lower cardiovascular risk.",
    detail:
      "Based on the values you entered, the model estimates a lower " +
      "likelihood of significant coronary artery narrowing.",
    caveat:
      "This is not an all-clear. The model misses roughly three in ten " +
      "cases that do have narrowing. If you have symptoms or concerns, " +
      "speak to a doctor regardless of this result.",
    primaryAction: "Back to Dashboard",
    primaryRoute: "/patient/dashboard",
    // A low result must NOT push the patient into a paid consultation.
    offersConsultation: false,
  },

  [RISK.MODERATE]: {
    heading: "Moderate estimated risk",
    summary:
      "Your assessment indicates moderate cardiovascular risk. Consider " +
      "consulting a healthcare professional for further evaluation.",
    detail:
      "The model cannot place your result clearly in either the lower or " +
      "the higher band - it sits in between.",
    caveat:
      "A doctor can interpret this alongside your history and the things " +
      "the model cannot see.",
    primaryAction: "Consult a Doctor",
    primaryRoute: "/consult-doctor",
    offersConsultation: true,
  },

  [RISK.HIGH]: {
    heading: "Higher estimated risk",
    summary:
      "Your assessment indicates a high cardiovascular risk. Please seek " +
      "medical attention promptly.",
    detail:
      "Based on the values you entered, the model estimates a higher " +
      "likelihood of significant coronary artery narrowing.",
    caveat:
      "This is a screening estimate, not a diagnosis and not an emergency " +
      "call. It means you should be seen by a doctor rather than wait.",
    primaryAction: "Find Urgent Care",
    primaryRoute: "/emergency",
    offersConsultation: true,
  },
};

export const guidanceFor = (risk) => GUIDANCE[normaliseRisk(risk)];

/*
General preventive advice for the low-risk path.

Deliberately generic public-health guidance - the kind
printed on any health service leaflet. Nothing here is
tailored to the patient's numbers, because the model does
not support personalised advice and pretending otherwise
would be inventing medical recommendations.
*/
export const PREVENTIVE_GUIDANCE = [
  {
    title: "Stay physically active",
    body:
      "Most adult guidelines suggest at least 150 minutes of moderate " +
      "activity a week - brisk walking counts. Build up gradually if you " +
      "are starting out.",
  },
  {
    title: "Eat a balanced diet",
    body:
      "More vegetables, fruit, whole grains and fish; less salt, added " +
      "sugar and heavily processed food.",
  },
  {
    title: "Avoid tobacco",
    body:
      "Stopping smoking is one of the single most effective things you " +
      "can do for your heart. Ask your doctor about support available.",
  },
  {
    title: "Keep up regular check-ups",
    body:
      "Periodic blood pressure, cholesterol and blood sugar checks catch " +
      "changes early, well before symptoms appear.",
  },
  {
    title: "Know the warning signs",
    body:
      "Chest pressure, breathlessness at rest, fainting, or pain spreading " +
      "to the arm, jaw, neck or back all need urgent medical attention - " +
      "whatever a screening tool says.",
  },
];

/*
Symptoms that warrant emergency services regardless of the
model output. Kept here so the assessment form and the
emergency screen cannot drift apart.
*/
export const EMERGENCY_SYMPTOMS = [
  {
    id: "chestPainNow",
    label: "Severe chest pain or pressure right now",
  },
  {
    id: "breathlessAtRest",
    label: "Severe difficulty breathing while resting",
  },
  {
    id: "fainting",
    label: "Fainted or lost consciousness recently",
  },
  {
    id: "armJawPain",
    label: "Pain spreading to the arm, jaw, neck or back",
  },
];
