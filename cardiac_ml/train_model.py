"""
=====================================================================
CardioCare - cardiovascular risk model training
=====================================================================

Dataset
-------
UCI Machine Learning Repository - Heart Disease (Cleveland).
  Source    : https://archive.ics.uci.edu/dataset/45/heart+disease
  Donors    : Andras Janosi (Hungarian Institute of Cardiology),
              William Steinbrunn (University Hospital, Zurich),
              Matthias Pfisterer (University Hospital, Basel),
              Robert Detrano (V.A. Medical Center, Long Beach and
              Cleveland Clinic Foundation).
  Licence   : Creative Commons Attribution 4.0 International (CC BY 4.0).
  Local copy: dataset/heart+disease (1)/processed.cleveland.data
  Records   : 303 real, de-identified patient records.

These are REAL patient records. No synthetic or generated rows are
used anywhere in this pipeline.

What the model predicts
-----------------------
The dataset's target attribute (`num`) is the angiographic disease
status: 0 means less than 50% diameter narrowing in every major
vessel, values 1-4 mean more than 50% narrowing in at least one.

Following the standard treatment of this dataset we binarise it:

    target = 1  if num > 0   (significant coronary narrowing present)
    target = 0  otherwise

So this is a BINARY classifier for the presence of significant
coronary artery narrowing. It is NOT a diagnosis, and it is not a
10-year event risk score such as Framingham or QRISK.

Feature set
-----------
Of the 14 attributes, four require an exercise stress test or
cardiac imaging and cannot be supplied by a patient using the app:

    oldpeak  ST depression induced by exercise
    slope    slope of the peak exercise ST segment
    ca       major vessels coloured by fluoroscopy
    thal     thallium scintigraphy result

The previous version of the app sent hardcoded constants for all
four, which meant the production inputs did not match the training
inputs. Rather than fake them, they are dropped. Both feature sets
are trained and reported here so the cost of dropping them is
measured rather than assumed.

Outputs
-------
    model.pkl        deployed sklearn Pipeline (preprocessing + model)
    model_meta.json  feature schema, risk thresholds, provenance
    metrics.json     every measured score, for the report

Reproducible: fixed RANDOM_STATE throughout.

Run:  python train_model.py
=====================================================================
"""

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)
from sklearn.model_selection import (
    RepeatedStratifiedKFold,
    StratifiedKFold,
    cross_val_predict,
    cross_val_score,
    train_test_split,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

RANDOM_STATE = 42
TEST_SIZE = 0.20

HERE = Path(__file__).parent
DATA_PATH = HERE / "dataset" / "heart+disease (1)" / "processed.cleveland.data"

RAW_COLUMNS = [
    "age", "sex", "cp", "trestbps", "chol", "fbs", "restecg",
    "thalach", "exang", "oldpeak", "slope", "ca", "thal", "num",
]

# Features a patient can self-report or read off a recent report.
DEPLOYED_FEATURES = [
    "age", "sex", "cp", "trestbps", "chol", "fbs", "restecg",
    "thalach", "exang",
]

# Everything, including the stress-test / imaging attributes.
FULL_FEATURES = DEPLOYED_FEATURES + ["oldpeak", "slope", "ca", "thal"]

CONTINUOUS = {"age", "trestbps", "chol", "thalach", "oldpeak"}
NOMINAL = {"cp", "restecg", "slope", "thal"}   # unordered categories
# sex, fbs, exang are already 0/1; ca is an ordered count 0-3.


# ---------------------------------------------------------------------
# DATA
# ---------------------------------------------------------------------

def load_dataset():
    """Load the Cleveland file and binarise the target."""
    df = pd.read_csv(DATA_PATH, names=RAW_COLUMNS, na_values="?")

    df["target"] = (df["num"] > 0).astype(int)

    return df.drop(columns=["num"])


def prepare(df, features):
    """
    Select a feature set and drop rows missing any of those features.

    Only `ca` (4 rows) and `thal` (2 rows) have missing values, so the
    deployed feature set keeps all 303 records while the full set
    keeps 297.
    """
    subset = df[features + ["target"]].dropna()

    return subset[features], subset["target"]


def build_preprocessor(features):
    """
    Scale continuous features, one-hot the unordered categories, and
    pass the binary/ordinal ones straight through.

    One-hot encoding matters: cp, restecg, slope and thal are codes,
    not quantities. Feeding thal as 3/6/7 tells a linear model that
    "reversible defect" is more than twice "normal", which is
    meaningless. The old script never encoded them at all.

    Preprocessing lives INSIDE the pipeline so it is fitted only on
    training folds. That is what prevents leakage from the test set.
    """
    continuous = [f for f in features if f in CONTINUOUS]
    nominal = [f for f in features if f in NOMINAL]
    passthrough = [f for f in features if f not in CONTINUOUS and f not in NOMINAL]

    return ColumnTransformer(
        transformers=[
            ("continuous", StandardScaler(), continuous),
            (
                "nominal",
                OneHotEncoder(handle_unknown="ignore", drop=None),
                nominal,
            ),
            ("passthrough", "passthrough", passthrough),
        ]
    )


def build_models(features):
    pre = build_preprocessor(features)

    logistic = Pipeline([
        ("prep", build_preprocessor(features)),
        ("clf", LogisticRegression(
            max_iter=2000,
            random_state=RANDOM_STATE,
        )),
    ])

    forest = Pipeline([
        ("prep", pre),
        ("clf", RandomForestClassifier(
            n_estimators=500,
            min_samples_leaf=2,
            random_state=RANDOM_STATE,
            n_jobs=-1,
        )),
    ])

    return {"logistic_regression": logistic, "random_forest": forest}


# ---------------------------------------------------------------------
# EVALUATION
# ---------------------------------------------------------------------

def evaluate(model, X_test, y_test):
    predictions = model.predict(X_test)
    probabilities = model.predict_proba(X_test)[:, 1]

    tn, fp, fn, tp = confusion_matrix(y_test, predictions).ravel()

    return {
        "accuracy": round(float(accuracy_score(y_test, predictions)), 4),
        "precision": round(float(precision_score(y_test, predictions, zero_division=0)), 4),
        "recall": round(float(recall_score(y_test, predictions, zero_division=0)), 4),
        "f1": round(float(f1_score(y_test, predictions, zero_division=0)), 4),
        "roc_auc": round(float(roc_auc_score(y_test, probabilities)), 4),
        "confusion_matrix": {
            "true_negative": int(tn), "false_positive": int(fp),
            "false_negative": int(fn), "true_positive": int(tp),
        },
    }


def cross_validate(model, X, y):
    """
    Repeated stratified CV. The dataset is small (303 rows), so a
    single split is noisy; repeating gives a far more honest estimate
    and a spread to quote in the report.
    """
    cv = RepeatedStratifiedKFold(
        n_splits=5, n_repeats=10, random_state=RANDOM_STATE
    )

    out = {}

    for name, scoring in [
        ("accuracy", "accuracy"),
        ("recall", "recall"),
        ("roc_auc", "roc_auc"),
    ]:
        scores = cross_val_score(model, X, y, cv=cv, scoring=scoring, n_jobs=-1)
        out[name] = {
            "mean": round(float(scores.mean()), 4),
            "std": round(float(scores.std()), 4),
        }

    return out


# ---------------------------------------------------------------------
# RISK BANDS
# ---------------------------------------------------------------------

def derive_risk_thresholds(y_true, probabilities):
    """
    Turn the model's probability into Low / Moderate / High.

    The dataset supports a BINARY outcome, so three bands must be
    justified rather than invented. These two cut points are measured
    on the data, not chosen by hand:

      low_max   the HIGHEST probability at which sensitivity is still
                >= 0.90. Below this, the model rarely misses disease,
                so "Low" is safe to report.

      high_min  the LOWEST probability at which specificity is
                >= 0.90. Above this, false alarms are uncommon, so
                "High" is meaningful.

    Anything between the two is "Moderate" - genuinely uncertain.

    Sensitivity is prioritised for the lower cut because in a
    screening tool a missed case costs far more than a false alarm.
    """
    fpr, tpr, thresholds = roc_curve(y_true, probabilities)
    specificity = 1 - fpr

    sensitive_enough = thresholds[tpr >= 0.90]
    low_max = float(np.max(sensitive_enough)) if len(sensitive_enough) else 0.30

    specific_enough = thresholds[specificity >= 0.90]
    high_min = float(np.min(specific_enough)) if len(specific_enough) else 0.70

    # Keep the bands ordered and inside (0, 1).
    low_max = float(np.clip(low_max, 0.05, 0.60))
    high_min = float(np.clip(high_min, low_max + 0.05, 0.95))

    return {"low_max": round(low_max, 4), "high_min": round(high_min, 4)}


# ---------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------

def run_feature_set(df, features, label):
    X, y = prepare(df, features)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y,
        test_size=TEST_SIZE,
        random_state=RANDOM_STATE,
        stratify=y,
    )

    print(f"\n{'=' * 66}")
    print(f"FEATURE SET: {label}  ({len(features)} features)")
    print(f"{'=' * 66}")
    print(f"rows: {len(X)}   train: {len(X_train)}   test: {len(X_test)}")
    print(f"positive rate: {y.mean():.3f}")

    results = {}

    for name, model in build_models(features).items():
        model.fit(X_train, y_train)

        test_scores = evaluate(model, X_test, y_test)
        cv_scores = cross_validate(model, X_train, y_train)

        results[name] = {
            "test": test_scores,
            "cross_validation": cv_scores,
            "_fitted": model,
            "_split": (X_train, X_test, y_train, y_test),
        }

        cm = test_scores["confusion_matrix"]

        print(f"\n--- {name} ---")
        print(f"  CV (train, 5-fold x10)  accuracy {cv_scores['accuracy']['mean']:.4f} "
              f"(+/- {cv_scores['accuracy']['std']:.4f})   "
              f"recall {cv_scores['recall']['mean']:.4f}   "
              f"roc_auc {cv_scores['roc_auc']['mean']:.4f}")
        print(f"  TEST  accuracy  {test_scores['accuracy']:.4f}")
        print(f"        precision {test_scores['precision']:.4f}")
        print(f"        recall    {test_scores['recall']:.4f}")
        print(f"        f1        {test_scores['f1']:.4f}")
        print(f"        roc_auc   {test_scores['roc_auc']:.4f}")
        print(f"        confusion  TN={cm['true_negative']} FP={cm['false_positive']} "
              f"FN={cm['false_negative']} TP={cm['true_positive']}")

    return results


def main():
    if not DATA_PATH.exists():
        raise SystemExit(f"Dataset not found at {DATA_PATH}")

    df = load_dataset()

    print("=" * 66)
    print("UCI HEART DISEASE (CLEVELAND) - 303 real patient records")
    print("=" * 66)
    print(f"positives (num > 0): {int(df['target'].sum())}")
    print(f"negatives (num = 0): {int((df['target'] == 0).sum())}")

    full_results = run_feature_set(df, FULL_FEATURES, "FULL (incl. stress test + imaging)")
    deployed_results = run_feature_set(df, DEPLOYED_FEATURES, "DEPLOYED (patient-obtainable)")

    # -----------------------------------------------------------------
    # Choose the deployed model on MEASURED validation performance.
    #
    # Criterion: cross-validated RECALL (sensitivity) on the positive
    # class, measured on the training split only.
    #
    # Why recall and not accuracy or ROC-AUC. This model screens people
    # and routes them towards a cardiologist. A false negative tells
    # someone with significant coronary narrowing that they are low
    # risk; a false positive books an unnecessary consultation. Those
    # costs are nowhere near symmetric, so the metric that matters is
    # how much disease the model catches.
    #
    # Cross-validation, not the test split, because with 61 test rows a
    # single split moves by several points on one or two patients.
    #
    # The full comparison is written to metrics.json either way, so the
    # runner-up is never hidden.
    # -----------------------------------------------------------------
    chosen_name = max(
        deployed_results,
        key=lambda n: deployed_results[n]["cross_validation"]["recall"]["mean"],
    )

    chosen = deployed_results[chosen_name]
    model = chosen["_fitted"]
    X_train, X_test, y_train, y_test = chosen["_split"]

    print(f"\n{'=' * 66}")
    print(f"SELECTED FOR DEPLOYMENT: {chosen_name}")
    print(f"  chosen on cross-validated RECALL (sensitivity), measured above")
    print(f"{'=' * 66}")

    """
    Thresholds come from OUT-OF-FOLD predictions on the training split.

    Not the test set, because that would leak. And not
    model.predict_proba(X_train) either: a Random Forest has largely
    memorised its own training rows, so those probabilities are far
    more confident than anything it will produce in production. Using
    them collapsed the Moderate band to a 0.05-wide sliver.

    cross_val_predict gives each training row a probability from a
    model that never saw it, which is an honest stand-in for
    production behaviour.
    """
    out_of_fold = cross_val_predict(
        model,
        X_train,
        y_train,
        cv=StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE),
        method="predict_proba",
        n_jobs=-1,
    )[:, 1]

    thresholds = derive_risk_thresholds(y_train, out_of_fold)

    print(f"risk bands (derived from training data):")
    print(f"  Low      p <  {thresholds['low_max']}")
    print(f"  Moderate {thresholds['low_max']} <= p < {thresholds['high_min']}")
    print(f"  High     p >= {thresholds['high_min']}")

    joblib.dump(model, HERE / "model.pkl")

    meta = {
        "model_type": chosen_name,
        "selection_criterion": "highest cross-validated recall (sensitivity) on the training split - a missed case costs more than a false alarm in a screening tool",
        "features": DEPLOYED_FEATURES,
        "excluded_features": {
            "oldpeak": "ST depression induced by exercise - needs a stress test",
            "slope": "slope of peak exercise ST segment - needs a stress test",
            "ca": "major vessels coloured by fluoroscopy - needs cardiac imaging",
            "thal": "thallium scintigraphy result - needs a nuclear scan",
        },
        "risk_thresholds": thresholds,
        "target_definition": "1 if num > 0 (>50% diameter narrowing in any major vessel)",
        "dataset": {
            "name": "UCI Heart Disease (Cleveland)",
            "url": "https://archive.ics.uci.edu/dataset/45/heart+disease",
            "licence": "CC BY 4.0",
            "records_used": int(len(prepare(df, DEPLOYED_FEATURES)[0])),
        },
        "random_state": RANDOM_STATE,
        "feature_encoding": {
            "age": "years, 18-120",
            "sex": "1 = male, 0 = female",
            "cp": "1 = typical angina, 2 = atypical angina, 3 = non-anginal pain, 4 = asymptomatic",
            "trestbps": "resting systolic blood pressure, mm Hg",
            "chol": "serum cholesterol, mg/dl",
            "fbs": "1 if fasting blood sugar > 120 mg/dl else 0",
            "restecg": "0 = normal, 1 = ST-T wave abnormality, 2 = left ventricular hypertrophy",
            "thalach": "maximum heart rate achieved, bpm",
            "exang": "1 = exercise-induced angina, 0 = no",
        },
    }

    (HERE / "model_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    def strip(results):
        return {
            name: {k: v for k, v in scores.items() if not k.startswith("_")}
            for name, scores in results.items()
        }

    metrics = {
        "random_state": RANDOM_STATE,
        "test_size": TEST_SIZE,
        "deployed_model": chosen_name,
        "risk_thresholds": thresholds,
        "feature_sets": {
            "full_13_features": strip(full_results),
            "deployed_9_features": strip(deployed_results),
        },
    }

    (HERE / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    print("\nSaved: model.pkl, model_meta.json, metrics.json")


if __name__ == "__main__":
    main()
