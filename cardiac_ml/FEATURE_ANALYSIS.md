# Feature Feasibility Analysis & Model Report

**CardioCare — AI-Based Cardiovascular Risk Prediction**

Every number in this document was measured by running `python train_model.py`.
Nothing here is estimated or claimed in advance. Re-running the script with
`RANDOM_STATE = 42` reproduces all of it.

---

## 1. Dataset

| | |
|---|---|
| Name | UCI Heart Disease — Cleveland |
| Source | https://archive.ics.uci.edu/dataset/45/heart+disease |
| Local copy | `dataset/heart+disease (1)/processed.cleveland.data` |
| Licence | CC BY 4.0 |
| Records | 303 real, de-identified patient records |
| Collected by | R. Detrano, V.A. Medical Center Long Beach & Cleveland Clinic Foundation |
| Missing values | 6 rows (`ca` ×4, `thal` ×2) |
| Class balance | 164 negative / 139 positive (45.9 % positive) |

These are **real clinical records**. No synthetic or generated rows are used
anywhere in this pipeline.

### What the target actually means

The dataset's target `num` is *angiographic disease status*:

- `0` — less than 50 % diameter narrowing in every major vessel
- `1–4` — more than 50 % narrowing in at least one major vessel

Binarised in the standard way: `target = 1 if num > 0`.

So the model answers **one binary question**: *is significant coronary artery
narrowing likely to be present?* It is **not** a diagnosis, and it is **not** a
10-year cardiovascular event risk score like Framingham or QRISK.

---

## 2. Feature feasibility

The central constraint: **the features used for training must be the features
collected in production.** Any feature a patient cannot supply must be dropped
from the model, not faked.

| # | Feature | Meaning | How it is obtained | Patient can supply? | Source in app | Decision |
|---|---|---|---|---|---|---|
| 1 | `age` | Age in years | Known | Yes | User entry | **Keep** |
| 2 | `sex` | Sex at birth (1 = M, 0 = F) | Known | Yes | User entry | **Keep** |
| 3 | `cp` | Chest pain type (1–4) | Symptom description | Yes | User entry | **Keep** |
| 4 | `trestbps` | Resting systolic BP, mm Hg | Home BP monitor / clinic | Yes | User entry | **Keep** |
| 5 | `chol` | Serum cholesterol, mg/dL | Blood test | From a report | Medical report | **Keep** |
| 6 | `fbs` | Fasting blood sugar > 120 mg/dL | Blood test | From a report | Medical report | **Keep** |
| 7 | `restecg` | Resting ECG result (0–2) | ECG | From a report | Medical report | **Keep** |
| 8 | `thalach` | Max heart rate achieved, bpm | Exercise test / fitness tracker | Approximately | User entry | **Keep (caveat below)** |
| 9 | `exang` | Exercise-induced angina | Symptom description | Yes | User entry | **Keep** |
| 10 | `oldpeak` | ST depression induced by exercise | **Exercise stress test + ECG** | No | — | **Drop** |
| 11 | `slope` | Slope of peak exercise ST segment | **Exercise stress test + ECG** | No | — | **Drop** |
| 12 | `ca` | Major vessels coloured by fluoroscopy | **Cardiac fluoroscopy** | No | — | **Drop** |
| 13 | `thal` | Thallium scintigraphy result | **Nuclear stress scan** | No | — | **Drop** |

### Caveat on `thalach`

In the original study `thalach` is the maximum heart rate reached during a
*supervised exercise stress test*. In the app it is asked for as "highest heart
rate reached during exercise", which a patient may take from a fitness tracker.

These are **not identical measurements**. A tracker reading during ordinary
exercise will usually be lower than a maximal test value. This is a genuine and
acknowledged limitation of the deployed model, and is the single biggest source
of distribution shift between training and production. It is documented here
rather than hidden. Removing it entirely is a reasonable future change, and the
measured cost of doing so can be obtained by adding it to the exclusion list in
`train_model.py` and re-running.

### What the previous version did

The old `RiskAssessment.jsx` sent hardcoded constants for all four dropped
features, for **every patient**:

```js
oldpeak: 2.3,  slope: 0,  ca: 0,  thal: 1
```

Verified against the dataset:

| Value sent | Values in training data | Problem |
|---|---|---|
| `oldpeak: 2.3` | continuous 0.0–6.2 | Copied verbatim from row 1 of the dataset |
| `slope: 0` | `{1, 2, 3}` | **Never occurs in training data** |
| `thal: 1` | `{3, 6, 7}` | **Never occurs in training data** |
| `ca: 0` | `{0, 1, 2, 3}` | In range, but constant for everyone |
| `cp: 0–3` | `{1, 2, 3, 4}` | **Off by one — every patient shifted a category** |
| `fbs: raw mg/dL` | `{0, 1}` binary | **Wrong semantics entirely** |

Three of these values do not exist anywhere in the training set, so the trees
routed them down arbitrary branches. The predictions were not meaningfully
related to the patient's input.

**A useful side effect of dropping `ca` and `thal`:** they were the only columns
with missing values, so the deployed model trains on all **303** records rather
than 297.

---

## 3. Measured results

Protocol: stratified 80/20 train/test split, `random_state = 42`. Cross-validation
is repeated stratified 5-fold × 10 repeats **on the training split only**.
Preprocessing (scaling, one-hot encoding) sits inside the sklearn `Pipeline`, so
it is fitted per fold — no leakage.

### Full 13 features (reference only — not deployable)

| Model | CV accuracy | CV recall | CV ROC-AUC | Test acc | Test recall | Test prec | Test F1 | Test AUC |
|---|---|---|---|---|---|---|---|---|
| Logistic Regression | 0.8257 ± 0.0516 | 0.7732 | 0.8886 | 0.8500 | 0.7857 | 0.8800 | 0.8302 | 0.9509 |
| Random Forest | 0.8194 ± 0.0438 | 0.7768 | 0.8953 | 0.8500 | 0.8214 | 0.8519 | 0.8364 | 0.9375 |

### Deployed 9 features (patient-obtainable)

| Model | CV accuracy | CV recall | CV ROC-AUC | Test acc | Test recall | Test prec | Test F1 | Test AUC |
|---|---|---|---|---|---|---|---|---|
| Logistic Regression *(baseline)* | 0.7529 ± 0.0517 | 0.6844 | 0.8403 | 0.8361 | 0.7857 | 0.8462 | 0.8148 | 0.9188 |
| **Random Forest — deployed** | 0.7519 ± 0.0566 | **0.6914** | 0.8292 | **0.8852** | **0.8929** | 0.8621 | 0.8772 | 0.9221 |

Confusion matrix, deployed model, 61 test patients:

|  | Predicted no disease | Predicted disease |
|---|---|---|
| **Actually no disease** | 29 | 4 |
| **Actually disease** | 3 | 25 |

### The honest headline number

> **Cross-validated accuracy ≈ 75 % (± 5.7 %). Cross-validated ROC-AUC ≈ 0.83.**

The test-set accuracy of 88.5 % is the *more flattering* number, but it comes
from a single 61-patient split where **each patient is worth 1.6 percentage
points**. The cross-validated figure, averaged over 50 fits, is the one to quote
in a report or a viva.

Do not quote 88.5 % as "the accuracy of the model".

### Cost of dropping the four clinical features

Cross-validated accuracy falls from **0.819 → 0.752** and ROC-AUC from
**0.895 → 0.829**. That drop is the measured price of a model a patient can
actually use, and it is the honest trade-off to present.

### Why Random Forest was deployed

Selected on **cross-validated recall (sensitivity)**, measured on the training
split only.

Recall — not accuracy, not ROC-AUC — because this tool screens people and routes
them toward a cardiologist. A false negative tells someone with significant
narrowing that they are low risk. A false positive books an unnecessary
consultation. Those costs are nowhere near symmetric.

Full disclosure: Logistic Regression scored marginally *higher* cross-validated
ROC-AUC (0.8403 vs 0.8292) and near-identical accuracy. The two models are
within noise of each other on those metrics. Random Forest wins on recall in
both cross-validation (0.6914 vs 0.6844) and on the test split (0.8929 vs
0.7857), which is the metric that matters here. Both models' complete scores are
written to `metrics.json` so nothing is hidden.

---

## 4. Risk bands — how Low / Moderate / High are derived

The dataset supports a **binary** outcome. Three labels therefore have to be
*justified*, not invented. These two cut points are measured from the data:

| Band | Rule | Derivation |
|---|---|---|
| **Low** | `p < 0.2832` | Highest probability at which **sensitivity ≥ 0.90** |
| **Moderate** | `0.2832 ≤ p < 0.6856` | Everything in between — genuinely uncertain |
| **High** | `p ≥ 0.6856` | Lowest probability at which **specificity ≥ 0.90** |

Reasoning:

- Below `low_max` the model rarely misses disease, so reporting "Low" is safe.
- Above `high_min` false alarms are uncommon, so "High" is meaningful.
- Sensitivity drives the lower cut because a missed case costs more than a false
  alarm.

Thresholds are computed from **out-of-fold** predictions
(`cross_val_predict`) on the training split — never the test set, and never the
Random Forest's own training predictions. A Random Forest has largely memorised
its training rows, so its in-sample probabilities are far more confident than
anything it produces in production; using them collapsed the Moderate band to a
0.05-wide sliver. Out-of-fold probabilities come from models that never saw the
row, which is an honest stand-in for production behaviour.

These are **model-probability bands, not clinical risk categories.** They do not
correspond to Framingham, ASCVD or QRISK risk tiers.

---

## 5. Limitations

State these plainly in any report or demo.

1. **303 patients from one hospital in the 1980s.** Small, single-centre, and
   not representative of a modern or Indian population. Absolute numbers will
   not transfer.
2. **Cross-validated accuracy ≈ 75 %.** Roughly one in four screened patients is
   classified incorrectly.
3. **Cross-validated recall ≈ 0.69.** At the default 0.5 cut the model misses
   about 31 % of patients who do have significant narrowing. This is exactly why
   the app must never present a Low result as reassurance.
4. **`thalach` is measured differently in training and production** (supervised
   stress test vs fitness tracker) — see §2.
5. **The model predicts angiographic narrowing, not events.** It says nothing
   about heart attack or stroke risk over time.
6. **Three features depend on a recent medical report.** A patient without one
   cannot complete the assessment honestly, and guessed values produce a
   meaningless result.
7. **Not a medical device.** Not validated, not certified, not for clinical use.

---

## 6. Reproducing

```bash
cd cardiac_ml
venv/Scripts/python train_model.py     # writes model.pkl, model_meta.json, metrics.json
uvicorn api:app --port 8000            # serves the model
```

Outputs:

| File | Contents |
|---|---|
| `model.pkl` | Deployed sklearn `Pipeline` — preprocessing **and** classifier together |
| `model_meta.json` | Feature list, encodings, thresholds, dataset provenance |
| `metrics.json` | Every measured score for both feature sets and both models |

The API builds its request frame from `model_meta.json`'s feature list, so the
production column order can never silently drift from training.
