/*
=====================================================
PREDICTION SERVICE
=====================================================

Talks to the FastAPI model service in cardiac_ml.

The feature names and encodings here MUST match
cardiac_ml/model_meta.json exactly. If they drift, the
API rejects the request with HTTP 422 rather than
quietly predicting from wrong values - which is what
used to happen when the form sent chest-pain codes 0-3
against a model trained on 1-4.
=====================================================
*/

/*
The ML API base URL.

VITE_ML_API_URL is the production variable. The older
VITE_PREDICTION_API_URL is still honoured so an existing
local .env keeps working.

In a DEPLOYED build neither may be missing: falling back to
localhost there would silently call the user's own machine
and fail with a confusing network error. So the fallback
only applies when the page itself is served from localhost.
*/
const isLocalHost =
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);

export const API_URL =
  import.meta.env.VITE_ML_API_URL ||
  import.meta.env.VITE_PREDICTION_API_URL ||
  (isLocalHost ? "http://127.0.0.1:8001" : "");

export const apiConfigured = () => Boolean(API_URL);

export const apiNotConfiguredMessage =
  "The risk assessment service is not configured for this deployment. " +
  "Set VITE_ML_API_URL to the deployed ML API address and redeploy.";


/*
The exact nine features the deployed model was trained on.
Kept here so a typo becomes an obvious error instead of a
silently missing field.
*/
export const MODEL_FEATURES = [
  "age",
  "sex",
  "cp",
  "trestbps",
  "chol",
  "fbs",
  "restecg",
  "thalach",
  "exang",
];

export const predictRisk = async (features) => {
  const missing = MODEL_FEATURES.filter(
    (name) =>
      features[name] === undefined ||
      features[name] === null ||
      features[name] === ""
  );

  if (missing.length > 0) {
    throw new Error(`Missing required values: ${missing.join(", ")}`);
  }

  // Send exactly the model features - nothing more, nothing less.
  const payload = {};
  MODEL_FEATURES.forEach((name) => {
    payload[name] = Number(features[name]);
  });

  if (!apiConfigured()) {
    throw new Error(apiNotConfiguredMessage);
  }

  let response;

  try {
    response = await fetch(`${API_URL}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    /*
      fetch only rejects on a network-level failure, which here
      almost always means the API is not running.
    */
    throw new Error(
      "Could not reach the risk assessment service. Make sure it is " +
        "running:  cd cardiac_ml && uvicorn api:app --host 127.0.0.1 --port 8001"
    );
  }

  if (response.status === 422) {
    const detail = await response.json().catch(() => null);

    const fields = Array.isArray(detail?.detail)
      ? detail.detail
          .map((item) => item.loc?.[item.loc.length - 1])
          .filter(Boolean)
          .join(", ")
      : "";

    throw new Error(
      fields
        ? `Some values are outside the accepted range: ${fields}. Please check and try again.`
        : "Some of the values entered are outside the accepted range."
    );
  }

  if (!response.ok) {
    throw new Error(
      "The risk assessment service could not process this request. Please try again."
    );
  }

  return response.json();
};

/*
Used by the result screen so the wording and thresholds shown to
the patient come from the model that actually produced the result.
*/
export const getModelInfo = async () => {
  const response = await fetch(`${API_URL}/model`);

  if (!response.ok) throw new Error("Could not load model information.");

  return response.json();
};
