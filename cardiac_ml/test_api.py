"""
=====================================================================
ML API  -  integration test
=====================================================================

Exercises the running prediction service end to end: liveness, CORS,
real predictions against rows whose true label is known, input
validation, and the risk bands.

Start the API first, then:

    python -m uvicorn api:app --host 127.0.0.1 --port 8001     (terminal 1)
    python test_api.py                        (terminal 2)

Exits non-zero if anything fails.
=====================================================================
"""

import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8001"

passed = 0
failed = 0


def check(name, condition, detail=""):
    global passed, failed

    if condition:
        print(f"  PASS  {name}")
        passed += 1
    else:
        print(f"  FAIL  {name}{f' - {detail}' if detail else ''}")
        failed += 1


def call(path, payload=None, origin=None):
    url = BASE + path
    data = json.dumps(payload).encode() if payload is not None else None

    request = urllib.request.Request(
        url, data=data, method="POST" if data else "GET"
    )

    if data:
        request.add_header("Content-Type", "application/json")
    if origin:
        request.add_header("Origin", origin)

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return (
                response.status,
                json.loads(response.read().decode()),
                dict(response.headers),
            )
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read().decode()), dict(error.headers)
    except urllib.error.URLError as error:
        print(f"\nCould not reach {BASE} - is the API running?\n  {error.reason}\n")
        sys.exit(1)


print("=" * 62)
print("ML API INTEGRATION TEST")
print("=" * 62)

# ---------------------------------------------------------------
print("\n--- liveness ---")

status, health, _ = call("/health")

check("GET /health returns 200", status == 200)
check("a model is loaded", health.get("modelLoaded") is True)
check(
    "nine features exposed",
    len(health.get("features", [])) == 9,
    str(health.get("features")),
)

# ---------------------------------------------------------------
print("\n--- CORS ---")

SAMPLE = {
    "age": 63, "sex": 1, "cp": 1, "trestbps": 145, "chol": 233,
    "fbs": 1, "restecg": 2, "thalach": 150, "exang": 0,
}

status, _, headers = call("/predict", SAMPLE, origin="http://localhost:5173")

check("browser origin accepted", status == 200)
check(
    "access-control-allow-origin present",
    "access-control-allow-origin" in {k.lower() for k in headers},
    "the frontend cannot call the API without it",
)

# ---------------------------------------------------------------
print("\n--- real dataset rows (known ground truth) ---")

# Taken verbatim from processed.cleveland.data with their real labels.
CASES = [
    ("row 1  num=0, no disease", {"age": 63, "sex": 1, "cp": 1, "trestbps": 145, "chol": 233, "fbs": 1, "restecg": 2, "thalach": 150, "exang": 0}, 0),
    ("row 2  num=2, disease", {"age": 67, "sex": 1, "cp": 4, "trestbps": 160, "chol": 286, "fbs": 0, "restecg": 2, "thalach": 108, "exang": 1}, 1),
    ("row 3  num=1, disease", {"age": 67, "sex": 1, "cp": 4, "trestbps": 120, "chol": 229, "fbs": 0, "restecg": 2, "thalach": 129, "exang": 1}, 1),
    ("row 4  num=0, no disease", {"age": 37, "sex": 1, "cp": 3, "trestbps": 130, "chol": 250, "fbs": 0, "restecg": 0, "thalach": 187, "exang": 0}, 0),
    ("row 5  num=0, no disease", {"age": 41, "sex": 0, "cp": 2, "trestbps": 130, "chol": 204, "fbs": 0, "restecg": 2, "thalach": 172, "exang": 0}, 0),
]

for label, payload, truth in CASES:
    _, body, _ = call("/predict", payload)

    check(
        f"{label} -> {body['risk']} p={body['probability']:.3f}",
        body["prediction"] == truth,
        f"predicted {body['prediction']}, actual {truth}",
    )

print(
    "\n  NOTE: these are TRAINING rows. They show the pipeline is wired\n"
    "  correctly, NOT that the model generalises. Generalisation is the\n"
    "  cross-validated figure in metrics.json (accuracy ~0.75)."
)

# ---------------------------------------------------------------
print("\n--- input validation (server-side) ---")

BAD = [
    ("age 5, below the minimum", {**SAMPLE, "age": 5}),
    ("cp 0, old form encoding", {**SAMPLE, "cp": 0}),
    ("fbs 110, raw mg/dL not a flag", {**SAMPLE, "fbs": 110}),
    ("trestbps 999", {**SAMPLE, "trestbps": 999}),
    ("chol 10, below the minimum", {**SAMPLE, "chol": 10}),
    ("thalach 500", {**SAMPLE, "thalach": 500}),
    ("restecg 7, outside 0-2", {**SAMPLE, "restecg": 7}),
    ("missing chol", {k: v for k, v in SAMPLE.items() if k != "chol"}),
    ("empty body", {}),
]

for label, payload in BAD:
    status, _, _ = call("/predict", payload)
    check(f"rejected: {label}", status == 422, f"got HTTP {status}")

# ---------------------------------------------------------------
print("\n--- risk bands ---")

_, meta, _ = call("/model")
thresholds = meta["risk_thresholds"]

print(f"  thresholds: {thresholds}")

PROFILES = [
    ("young, fit, asymptomatic", {"age": 29, "sex": 0, "cp": 3, "trestbps": 110, "chol": 180, "fbs": 0, "restecg": 0, "thalach": 190, "exang": 0}),
    ("older, several risk factors", {"age": 68, "sex": 1, "cp": 4, "trestbps": 170, "chol": 300, "fbs": 1, "restecg": 2, "thalach": 100, "exang": 1}),
]

bands = []

for label, payload in PROFILES:
    _, body, _ = call("/predict", payload)
    bands.append(body["risk"])
    print(f"  {label:30} p={body['probability']:.3f} -> {body['risk']}")

check("the bands discriminate between profiles", len(set(bands)) > 1, str(bands))

check(
    "band matches its own thresholds",
    all(
        (b == "LOW") == (p < thresholds["low_max"])
        for b, p in [
            (body["risk"], body["probability"])
            for _, body, _ in [call("/predict", payload) for _, payload in PROFILES]
        ]
    ),
)

# ---------------------------------------------------------------
# ---------------------------------------------------------------
print("\n" + "=" * 62)
print(f"PASSED: {passed}    FAILED: {failed}")
print("=" * 62)

sys.exit(0 if failed == 0 else 1)
