import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { predictRisk } from "../services/predictionService";
import { saveRiskData } from "../services/riskService";

import {
  QUESTIONS,
  SOURCE,
  STEPS,
  URGENT_SYMPTOMS,
  validateField,
} from "../services/assessmentQuestions";

/*
=====================================================
CARDIAC RISK ASSESSMENT
=====================================================

The same nine model inputs as before, asked in plain
language and split across four short steps.

THE ENCODINGS ARE UNCHANGED. Chest pain is still sent as
1-4, fasting blood sugar as a 0/1 flag, resting ECG as
0/1/2 - exactly what the trained model expects. Only the
wording the user reads is different. See
services/assessmentQuestions.js.

Nothing is ever filled in on the user's behalf. There is
no "don't know" option that silently becomes a zero,
because a missing measurement is not a normal one.
=====================================================
*/

const EMPTY = Object.fromEntries(
  Object.keys(QUESTIONS).map((field) => [field, ""])
);

function RiskAssessment() {
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState(EMPTY);
  const [symptoms, setSymptoms] = useState({});
  const [touched, setTouched] = useState({});

  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const current = STEPS[step];
  const isLastStep = step === STEPS.length - 1;

  // ---------------------------------------------------
  // VALIDATION
  // ---------------------------------------------------

  const errors = useMemo(() => {
    const found = {};

    Object.entries(QUESTIONS).forEach(([field, question]) => {
      const message = validateField(question, answers[field]);
      if (message) found[field] = message;
    });

    return found;
  }, [answers]);

  const stepErrors = current.fields.filter((field) => errors[field]);
  const stepComplete = stepErrors.length === 0;

  const urgent = URGENT_SYMPTOMS.filter((symptom) => symptoms[symptom.id]);

  const errorFor = (field) => (touched[field] ? errors[field] : null);

  // ---------------------------------------------------
  // HANDLERS
  // ---------------------------------------------------

  const answer = (field, value) => {
    setAnswers((previous) => ({ ...previous, [field]: value }));
    setTouched((previous) => ({ ...previous, [field]: true }));
    setSubmitError("");
  };

  const goNext = () => {
    if (!stepComplete) {
      // Reveal the errors rather than silently refusing to advance.
      setTouched((previous) => ({
        ...previous,
        ...Object.fromEntries(current.fields.map((f) => [f, true])),
      }));

      setSubmitError("Please answer every question on this page to continue.");
      return;
    }

    setSubmitError("");
    setStep((previous) => Math.min(previous + 1, STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goBack = () => {
    setSubmitError("");
    setStep((previous) => Math.max(previous - 1, 0));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (Object.keys(errors).length > 0) {
      setTouched(
        Object.fromEntries(Object.keys(QUESTIONS).map((f) => [f, true]))
      );

      // Send them to the first page that still has a gap.
      const firstBad = STEPS.findIndex((s) =>
        s.fields.some((field) => errors[field])
      );

      if (firstBad >= 0) setStep(firstBad);

      setSubmitError("Some answers are missing. Please check the highlighted questions.");
      return;
    }

    setBusy(true);
    setSubmitError("");

    try {
      // Exactly the nine model features, as numbers, unchanged codes.
      const features = Object.fromEntries(
        Object.keys(QUESTIONS).map((field) => [field, Number(answers[field])])
      );

      const result = await predictRisk(features);

      /*
        Keep the id. The consultation request stores it so a doctor
        can open the FULL assessment record, not just the snapshot
        copied onto the request.
      */
      const assessmentId = await saveRiskData({
        features,
        answers: { ...answers },
        result,
        emergencySymptoms: urgent.map((s) => s.label),
      });

      navigate("/result", {
        state: {
          assessmentId,
          risk: result.risk,
          probability: result.probability,
          thresholds: result.thresholds,
          disclaimer: result.disclaimer,
          modelType: result.modelType,
          features,
          emergencySymptoms: urgent.map((s) => s.label),
        },
      });
    } catch (error) {
      setSubmitError(error.message);
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------
  // FIELD RENDERING
  // ---------------------------------------------------

  const renderQuestion = (field) => {
    const question = QUESTIONS[field];
    const error = errorFor(field);

    return (
      <fieldset key={field} className="q" aria-invalid={Boolean(error)}>
        <legend className="q-label">
          {question.label}

          {question.source === SOURCE.REPORT && (
            <span className="q-tag">needs a test report</span>
          )}
        </legend>

        {question.help && <p className="q-help">{question.help}</p>}

        {question.caution && (
          <p className="q-caution">
            <strong>Note:</strong> {question.caution}
          </p>
        )}

        {question.options ? (
          <div className="q-options">
            {question.options.map((option) => {
              const id = `${field}-${option.value}`;
              const selected = String(answers[field]) === String(option.value);

              return (
                <label
                  key={option.value}
                  className={`q-option ${selected ? "selected" : ""}`}
                  htmlFor={id}
                >
                  <input
                    id={id}
                    type="radio"
                    name={field}
                    value={option.value}
                    checked={selected}
                    onChange={() => answer(field, option.value)}
                  />

                  <span className="q-option-text">
                    <strong>{option.label}</strong>

                    {option.hint && <span>{option.hint}</span>}

                    {option.clinical && (
                      <span className="q-clinical">
                        Medical term: {option.clinical}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <div className="q-number">
            <input
              type="number"
              inputMode="numeric"
              id={field}
              value={answers[field]}
              min={question.min}
              max={question.max}
              placeholder={question.placeholder}
              onChange={(event) => answer(field, event.target.value)}
              onBlur={() =>
                setTouched((previous) => ({ ...previous, [field]: true }))
              }
              aria-describedby={`${field}-help`}
              aria-invalid={Boolean(error)}
            />

            {question.unit && <span className="q-unit">{question.unit}</span>}
          </div>
        )}

        {error && (
          <p className="q-error" role="alert" id={`${field}-help`}>
            {error}
          </p>
        )}
      </fieldset>
    );
  };

  // ---------------------------------------------------
  // RENDER
  // ---------------------------------------------------

  return (
    <div className="risk-container">
      <div className="risk-card">
        <header className="risk-header">
          <span className="small-title">CARDIOCARE</span>

          <h1>Heart Health Check</h1>

          <p>
            A few simple questions about your health. It takes about three
            minutes. This gives you an estimate of your heart risk - it is
            not a diagnosis, and it does not replace seeing a doctor.
          </p>
        </header>

        {/* ==========================================
            URGENT SYMPTOMS  -  asked first, always
        ========================================== */}

        {step === 0 && (
          <fieldset className="risk-section risk-section-urgent">
            <legend>First - are you feeling any of these right now?</legend>

            <div className="risk-symptom-list">
              {URGENT_SYMPTOMS.map((symptom) => (
                <label key={symptom.id} className="risk-symptom">
                  <input
                    type="checkbox"
                    checked={Boolean(symptoms[symptom.id])}
                    onChange={() =>
                      setSymptoms((previous) => ({
                        ...previous,
                        [symptom.id]: !previous[symptom.id],
                      }))
                    }
                  />

                  <span>{symptom.label}</span>
                </label>
              ))}
            </div>

            {urgent.length > 0 && (
              <div className="risk-emergency-alert" role="alert">
                <strong>Please get medical help now.</strong>

                <p>
                  What you have described can be serious. Call your local
                  emergency number or go to the nearest hospital straight
                  away. Do not wait to finish this form, and do not wait
                  for its result.
                </p>

                <button
                  type="button"
                  className="risk-emergency-button"
                  onClick={() => navigate("/emergency")}
                >
                  Show me emergency help
                </button>
              </div>
            )}
          </fieldset>
        )}

        {/* ==========================================
            PROGRESS
        ========================================== */}

        <div className="risk-progress" aria-hidden="true">
          {STEPS.map((s, index) => (
            <div
              key={s.id}
              className={[
                "risk-progress-step",
                index === step ? "current" : "",
                index < step ? "done" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="risk-progress-dot">
                {index < step ? "✓" : index + 1}
              </span>

              <span className="risk-progress-label">{s.title}</span>
            </div>
          ))}
        </div>

        <p className="risk-step-counter">
          Step {step + 1} of {STEPS.length}
        </p>

        {/* ==========================================
            CURRENT STEP
        ========================================== */}

        <form onSubmit={handleSubmit} noValidate>
          <section className="risk-step">
            <h2>{current.title}</h2>

            <p className="risk-step-intro">{current.intro}</p>

            {current.requiresReport && (
              <div className="risk-report-notice">
                <strong>You will need a recent test report for this page.</strong>

                <p>
                  These values come from a blood test and an ECG. We cannot
                  guess them for you - entering a made-up number would give
                  you a meaningless result. If you do not have a report, ask
                  your doctor or local clinic for these tests first.
                </p>
              </div>
            )}

            {current.fields.map(renderQuestion)}
          </section>

          {submitError && (
            <div className="risk-submit-error" role="alert">
              {submitError}
            </div>
          )}

          {/* ==========================================
              NAVIGATION
          ========================================== */}

          <div className="risk-nav">
            <button
              type="button"
              className="risk-nav-back"
              onClick={goBack}
              disabled={step === 0}
            >
              ← Previous
            </button>

            {isLastStep ? (
              <button type="submit" className="risk-nav-next" disabled={busy}>
                {busy ? "Checking..." : "Get My Result"}
              </button>
            ) : (
              <button
                type="button"
                className="risk-nav-next"
                onClick={goNext}
              >
                Next →
              </button>
            )}
          </div>

          <p className="risk-disclaimer">
            This check gives an estimate based on the answers you provide.
            It is not a medical diagnosis and cannot tell you for certain
            whether you have heart disease. Always speak to a qualified
            doctor about your health.
          </p>
        </form>
      </div>
    </div>
  );
}

export default RiskAssessment;
