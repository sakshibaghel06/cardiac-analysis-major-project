# CardioCare

**AI-Based Cardiovascular Risk Prediction and Emergency Tele-Consultation System**

A patient completes a cardiac risk screening, receives a machine-learning risk
estimate, requests a consultation with a doctor, completes a clearly labeled
demo payment, meets the doctor over video, and receives a prescription — all
through one Firebase backend.

> **Not a medical device.** The model is a screening aid trained on a public
> research dataset. It is not validated for clinical use and cannot diagnose
> heart disease. See [Limitations](#limitations).

---

## Contents

```
cardiac-analysis/
├── cardiac/                React app — patient and doctor
│   ├── src/
│   │   ├── auth/           landing, login, signup
│   │   ├── context/        auth state + role
│   │   ├── routes/         route guards
│   │   ├── dashboard/      patient home, risk assessment
│   │   ├── doctor/         doctor portal, doctor profile
│   │   ├── pages/          result, consultation, video, payment,
│   │   │                   prescription, history, emergency
│   │   ├── components/     shared UI
│   │   ├── services/       every Firestore and API call
│   │   └── firebase/       Firebase init (reads .env)
│   ├── scripts/            frontend logic tests (plain node)
│   └── .env.example        copy to .env
│
├── cardiac_ml/             Python — model + API
│   ├── train_model.py      reproducible training pipeline
│   ├── api.py              FastAPI prediction service
│   ├── test_api.py         API integration test
│   ├── model.pkl           deployed sklearn Pipeline
│   ├── model_meta.json     feature schema + risk thresholds
│   ├── metrics.json        every measured score
│   ├── FEATURE_ANALYSIS.md feature feasibility + model report
│   └── dataset/            UCI Heart Disease (Cleveland)
│
├── cardiac_mobile/         Flutter patient app (optional, same Firebase project)
│
├── scripts/
│   ├── inspect_firestore.mjs   read-only structure diagnostic
│   ├── migrate_firestore.mjs   data fixes (dry run by default)
│   ├── seed_firestore.mjs      doctor roles + fees (dry run by default)
│   └── seed.config.example.json  copy to seed.config.json
│
├── tests/rules.test.mjs    99 security-rule tests
├── firestore.rules         access control
├── firestore.indexes.json  composite indexes
├── firebase.json           emulator + deploy config
└── TESTING.md              full test checklist
```

---

## Quick start (Windows)

Five commands, assuming the [prerequisites](#prerequisites) are installed and
a teammate has sent you the Firebase web config.

```powershell
git clone https://github.com/sushmitha-129/cardiac-analysis.git
cd cardiac-analysis
```

```powershell
cd cardiac_ml
python -m venv venv
.\venv\Scripts\python -m pip install -r requirements.txt
```

```powershell
cd ..\cardiac
npm install
if (-not (Test-Path .\.env)) {
    Copy-Item .\.env.example .\.env
} else {
    Write-Host "Keeping the existing .env."
}
```

Open `cardiac\.env` in a text editor and fill in the six `VITE_FIREBASE_*`
values. Then, in **two separate terminals**:

```powershell
cd cardiac_ml ; .\venv\Scripts\python -m uvicorn api:app --host 127.0.0.1 --port 8001
```

```powershell
cd cardiac ; npm run dev
```

Open <http://localhost:5173>.

The rest of this section explains each step, and what to do when one of them
does not work.

---

## Prerequisites

Install these first. Every version below is the one the project is developed
and tested against.

| Tool | Version | Why | Where |
|---|---|---|---|
| **Node.js** | 20 LTS or newer | React app, test scripts, Firebase CLI | <https://nodejs.org> — take the LTS **.msi** |
| **Python** | 3.11 – 3.13 | ML API and model training | <https://python.org/downloads> |
| **Git** | any recent | cloning, committing | <https://git-scm.com/download/win> |
| **Java JDK** | 21 recommended; use JDK 17 or 21 for Android builds | Firestore emulator and Flutter Android build | <https://adoptium.net> |
| **Firebase CLI** | 13+ | deploying rules, running the emulator | `npm install -g firebase-tools` |
| **Flutter** | 3.x | *only* if you work on `cardiac_mobile/` | <https://docs.flutter.dev/get-started/install/windows> |

Two Windows-specific points that cause most first-run failures:

- When installing Python, **tick "Add python.exe to PATH"** on the first
  screen of the installer. Without it, `python` is not a command, and Windows
  may instead open the Microsoft Store.
- After installing anything that changes `PATH`, **close and reopen your
  terminal.** An already-open PowerShell window keeps the old `PATH`.

Verify everything at once:

```powershell
node --version ; npm --version ; python --version ; git --version ; java -version ; firebase --version
```

---

## Step-by-step setup

### 1. Clone

```powershell
git clone https://github.com/sushmitha-129/cardiac-analysis.git
cd cardiac-analysis
```

### 2. Python environment and the ML API

```powershell
cd cardiac_ml
python -m venv venv
.\venv\Scripts\pip install -r requirements.txt
```

If PowerShell refuses to run `.\venv\Scripts\Activate.ps1` with
*"running scripts is disabled on this system"*, you do **not** need to
activate the virtual environment at all — call the interpreter by path, as
every command in this README does:

```powershell
.\venv\Scripts\python -m uvicorn api:app --host 127.0.0.1 --port 8001
```

If you prefer activation, allow it for your own user only:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

`model.pkl` is committed, so the API runs immediately. To retrain it from the
dataset yourself (reproducible, `random_state = 42` throughout):

```powershell
.\venv\Scripts\python train_model.py
```

### 3. Frontend

```powershell
cd ..\cardiac
npm install
if (-not (Test-Path .\.env)) {
    Copy-Item .\.env.example .\.env
} else {
    Write-Host "Keeping the existing .env."
}
```

> `cp` is not a Windows command — use `copy` in PowerShell and cmd. In Git
> Bash, `cp .env.example .env` works.

Now edit `cardiac\.env` and fill in the Firebase values —
see [Firebase web configuration](#firebase-web-configuration).

With an incomplete Firebase config the app displays a setup screen listing
the missing keys instead of failing before React mounts. Authentication and
patient data remain unavailable until the authorized web-app config is set.

### 4. Run both halves

Two terminals, both open at the same time. The frontend calls the API from the
browser, so the API must be running first.

| Terminal | Command | Serves |
|---|---|---|
| 1 | `cd cardiac_ml` → `.\venv\Scripts\python -m uvicorn api:app --host 127.0.0.1 --port 8001` | ML API |
| 2 | `cd cardiac` → `npm run dev` | React app |

### 5. Deploy the security rules and indexes

Do this **before any real use.** Without it the database is wide open to
anyone who has the project ID — which is shipped in every browser bundle.

```powershell
firebase login
# First verify the authorized project ID with its owner; do not assume the
# repository's .firebaserc alias is the intended project.
firebase projects:list
# Replace this with the verified project ID before running:
firebase use YOUR_AUTHORIZED_PROJECT_ID
firebase deploy --only firestore:rules,firestore:indexes
```

Only one teammate needs to do this, and only when `firestore.rules` or
`firestore.indexes.json` changes. It affects the shared Firebase project, so
confirm the selected project and get approval before deploying.

---

## Ports

| Port | Process | Started by | Notes |
|---|---|---|---|
| **5173** | Vite dev server | `npm run dev` | Vite silently moves to **5174** if taken — read the URL it prints |
| **8001** | FastAPI prediction API | `uvicorn api:app --host 127.0.0.1 --port 8001` | `VITE_ML_API_URL` must match |
| **8080** | Firestore emulator | `npm run test:rules` | test only |
| **9099** | Auth emulator | emulator suite | test only |
| **4000** | Emulator UI | emulator suite | test only |

The API's CORS allow-list already covers `localhost` and `127.0.0.1` on 5173
and 5174. If you run the frontend anywhere else, set `CARDIAC_ALLOWED_ORIGINS`
on the API process or the browser will block every call.

---

## Firebase web configuration

Six values, in `cardiac\.env`:

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

**Get them:** Firebase Console → ⚙ Project settings → *General* → *Your apps*
→ the web app → *SDK setup and configuration* → *Config*.

These are **not credentials.** Anything prefixed `VITE_` is compiled into the
JavaScript bundle and shipped to every visitor; Firebase web config is
designed to be public. What protects the data is `firestore.rules`, not
hiding these values. They live in `.env` only so a development project and a
production project can be swapped without editing code.

Do not commit `.env`; it is per-environment. Demo payment needs no gateway
secrets or server-side credentials.

## Demo payment — no gateway setup

The prescription payment page simulates a payment for the consultation fee
(₹500) and clearly labels it **DEMO PAYMENT — No real money will be charged.**
After a short delay, it stores a DEMO PAID status in this browser's local
storage, keyed by consultation reference. Refreshing in the same browser keeps
that status; it does not update Firestore or synchronize to other browsers.

The page can create and download a printable HTML receipt. The receipt is
marked **DEMO RECEIPT — NOT A REAL FINANCIAL TRANSACTION**. A local demo payment
does not change Firebase prescription permissions; if the actual prescription
cannot be read, the app explains that instead of showing invented content.
Pay Later does not mark the consultation paid.

No payment gateway, webhooks, Firebase Admin service account, backend payment
endpoint, or Firestore rules deployment is needed for the demo payment.
Firebase Authentication and Firestore remain in use for the app's existing
patient, doctor, consultation, and prescription features.

---

## Running the tests

Run the suites below to verify the current checkout.

### Frontend logic — no setup needed

```powershell
Set-Location .\cardiac
node scripts/test_firebase_startup.mjs
node scripts/test_assessment_encoding.mjs
node scripts/test_consultation_status.mjs
node scripts/test_prescription_pdf.mjs
```

3 + 28 + 17 + 14 assertions. Plain Node, no test runner or services required.

### ML API — needs the API running

```powershell
cd cardiac_ml
.\venv\Scripts\python -m uvicorn api:app --host 127.0.0.1 --port 8001    # terminal 1
.\venv\Scripts\python test_api.py                                            # terminal 2
```

21 assertions: liveness, CORS, predictions against rows with known ground
truth, server-side input validation, risk bands.

### Firestore security rules — needs Java

Install the test dependencies once from the repository root:

```powershell
npm install --prefix tests
```

```powershell
npm run test:rules
```

99 assertions against the Firestore emulator. This is the suite that matters
most: it is what proves a patient cannot read another patient's records.

### Lint and production build

```powershell
cd cardiac
npm run lint
npm run build
```

See [TESTING.md](TESTING.md) for the full checklist, including the manual
steps that need two signed-in accounts.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `python` opens the Microsoft Store | Python not on `PATH` | Reinstall Python with *Add python.exe to PATH* ticked, reopen the terminal |
| `running scripts is disabled on this system` | PowerShell execution policy | Skip activation — call `.\venv\Scripts\python` directly; or `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `'firebase' is not recognized` — including from `npm run test:rules` | Global npm bin not on `PATH` | Reopen the terminal. If it persists, add `%APPDATA%\npm` to `PATH` |
| `Firebase configuration is incomplete. Missing: ...` | No `.env`, or blank values | `copy .env.example .env` in `cardiac\` and fill in the six Firebase values. **Restart `npm run dev`** — Vite reads `.env` only at startup |
| App loads, risk assessment fails with a network error | ML API not running, or on another port | Start uvicorn on 8001; check `VITE_ML_API_URL` matches |
| Risk assessment fails, console shows a CORS error | Frontend on an origin the API does not allow | Vite moved to 5174 — already allowed — or set `CARDIAC_ALLOWED_ORIGINS` on the API |
| `model.pkl / model_meta.json not found` | Running uvicorn from the wrong folder | `cd cardiac_ml` first |
| `permission-denied` from Firestore | Rules not deployed, or the doctor doc is keyed wrong | `firebase deploy --only firestore:rules`; a doctor's document ID **must be** their Auth UID |
| A query fails asking for an index | Composite index missing | `firebase deploy --only firestore:indexes`, or click the link in the error |
| `npm run test:rules` cannot start on 8080 | Java missing, or the port is already occupied | Install a JDK 21. Do not stop an unknown process; use a temporary Firebase emulator config with a free port and set the same `FIRESTORE_EMULATOR_PORT` for the rules test |
| Edits do not appear in the browser | An old Vite server on 5173 is serving stale code | Read the URL Vite printed; close the other server |
| Camera does not work on a second device | Not a secure context | Use `npm run dev:lan` (HTTPS) — see [Video consultation](#video-consultation) |
| Demo payment does not persist | Firestore rules are outdated, or an older issued prescription is not linked to its consultation | Deploy the current Firestore rules; have its doctor open the prescription page to link the existing issued prescription |

---

## Portability

The repository has no dependency on any one machine:

- No absolute paths anywhere in the source. `api.py` resolves `model.pkl`
  relative to its own file; the frontend resolves everything through Vite.
- No credentials in source control. Firebase web config is set per
  environment; demo payments use the signed-in Firebase client.
- `model.pkl` is committed, so a fresh clone predicts without retraining —
  and `train_model.py` reproduces it exactly from the committed dataset.
- Machine-specific files — `.env`, `scripts/seed.config.json`,
  `cardiac_mobile/firebase.local.json`, `venv/`, `node_modules/`, `dist/` —
  are git-ignored, with examples where useful.

---

## Video consultation

Camera and microphone only work on a **secure context**: `https://`, or
`http://localhost`. This is a browser rule, not an app setting.

| Testing | Command | URL |
|---|---|---|
| One machine, two browser profiles | `npm run dev` | `http://localhost:5173` |
| Two devices | `npm run dev:lan` | `https://192.168.x.x:5173` |

`dev:lan` serves over HTTPS with a self-signed certificate — each device shows
a one-time warning; choose Advanced → Proceed.

Two *tabs* on one machine will not both get the camera. Windows gives one
process exclusive access, so the second reports `NotReadableError`. Use two
browser profiles.

### TURN

STUN alone only connects peers that can reach each other directly. On most
college, office and mobile networks it cannot, and the call fails after
appearing to almost connect. Set `VITE_TURN_URL`, `VITE_TURN_USERNAME` and
`VITE_TURN_CREDENTIAL` in `.env` to fix it.

---

## The model

Trained on the **UCI Heart Disease (Cleveland)** dataset — 303 real,
de-identified patient records, CC BY 4.0.
<https://archive.ics.uci.edu/dataset/45/heart+disease>

It answers one binary question: *is significant coronary artery narrowing
likely to be present?* It is not a 10-year event risk score.

Four of the fourteen attributes require an exercise stress test or cardiac
imaging, so a patient cannot supply them. They are **dropped**, not faked:
`oldpeak`, `slope`, `ca`, `thal`. The nine remaining features are exactly what
the form collects.

### Measured performance

| Model | CV accuracy | CV recall | CV ROC-AUC |
|---|---|---|---|
| Logistic Regression *(baseline)* | 0.7529 ± 0.0517 | 0.6844 | 0.8403 |
| **Random Forest** *(deployed)* | 0.7519 ± 0.0566 | **0.6914** | 0.8292 |

Random Forest was selected on cross-validated **recall**: this tool screens
people and routes them toward a cardiologist, so a missed case costs far more
than a false alarm.

**Quote ≈ 75 % cross-validated accuracy.** The 88.5 % test-set figure comes
from a 61-patient split where one patient moves it by 1.6 points.

Risk bands are derived from out-of-fold predictions, not chosen by hand:

| Band | Rule |
|---|---|
| Low | `p < 0.2832` — highest threshold with sensitivity ≥ 0.90 |
| Moderate | `0.2832 ≤ p < 0.6856` |
| High | `p ≥ 0.6856` — lowest threshold with specificity ≥ 0.90 |

Full methodology, the per-feature feasibility table and every measured score:
[`cardiac_ml/FEATURE_ANALYSIS.md`](cardiac_ml/FEATURE_ANALYSIS.md).

---

## Data model

One Firebase project, one Firestore database, shared by both sides of the app.

One login page serves both roles. After Firebase Authentication verifies the
credentials, `roleService.resolveRole()` asks whether a document exists at
`doctors/{authUid}` — the same question `firestore.rules` asks — and redirects
to `/doctor/dashboard` or `/patient/dashboard`. Patients self-register;
doctor accounts are provisioned by an administrator and cannot be signed up.

| Collection | Holds | Written by |
|---|---|---|
| `users/{uid}` | Patient profile, `role: "patient"` (immutable) | Patient, at signup |
| `doctors/{uid}` | Doctor directory. **Document ID must be the doctor's Auth UID.** | Administrator |
| `hospitals/{id}` | Reference data | Administrator |
| `risk_assessments/{id}` | Model inputs + result. Immutable. | Patient |
| `consultation_requests/{id}` | The consultation and its status | Patient creates, doctor updates |
| `care_links/{doctorUid}_{patientUid}` | Grants a doctor access to a patient | Doctor, on accept |
| `video_rooms/{requestId}` | WebRTC signalling | Both participants |
| `prescriptions/{id}` | Doctor's prescription | Doctor only |

Status values are always lowercase: `pending`, `accepted`, `rejected`,
`cancelled`, `completed`. Ask the helpers in
`cardiac/src/services/consultationStatus.js` rather than comparing the status
string directly — they also accept the legacy uppercase values still present
in older documents.

### Provisioning doctors

A doctor's Firestore document **ID must be their Auth UID**, because rules
cannot run a query — they can only `exists()` a known path. To set this up:

```powershell
copy scripts\seed.config.example.json scripts\seed.config.json
```

Fill in each doctor's UID from Firebase Console → Authentication → Users, then
run `node scripts/seed_firestore.mjs`. It is a dry run by default.
`seed.config.json` holds real UIDs and emails, so it is git-ignored.

### Risk branching

A result branches three ways rather than always offering a consultation:

| Band | What the patient sees |
|---|---|
| **Low** | Preventive guidance. No consultation is pushed, though one can still be requested. |
| **Moderate** | Consultation offered: city → hospital → doctor. |
| **High** | Urgent-care warning and nearby hospitals first; online consultation second. |

Emergency symptoms reported on the form override the model entirely and show
emergency guidance regardless of the estimated band.

### Payment order

The consultation fee is taken **after the doctor accepts and before the
prescription is released**, not before the doctor has done anything. When a
call ends, the patient lands on the payment page. The demo waits briefly, then
stores `paymentStatus: "paid"` and `paymentMethod: "DEMO"` on the consultation
and unlocks the prescription referenced by that consultation. The signed-in
patient's Firebase client performs this update under Firestore rules; no
gateway, backend payment route, or Admin SDK credential is required. The
`VITE_DEFAULT_CONSULTATION_FEE` value supplies the fee when the doctor record
has no `fee` of its own.

### care_links

Firestore rules cannot run a query, so "does a consultation exist between these
two people?" cannot be asked directly. The link lives at a deterministic path
that `exists()` checks in one lookup. It is created when the doctor accepts and
deleted when they reject. **There is no rule granting doctors blanket access to
patients.**

---

## Security

```powershell
npm run test:rules      # 76 tests, Firestore emulator
```

- Patients reach only their own records
- Doctors reach only patients they have a care link with
- Risk assessments are immutable once written
- Only the two participants can join a video room
- Prescriptions are doctor-write, patient-read
- Payout destinations are unreadable by patients *and* doctors
- Unknown collections are denied by default
- Demo payment updates are limited to the signed-in patient's issued
  consultation and its linked prescription, in one atomic batch

Firebase web configuration is supplied per environment in a git-ignored
`.env`. No payment gateway or Firebase Admin credential is needed.

---

## Mobile app (optional)

`cardiac_mobile/` is a Flutter patient app pointing at the **same** Firebase
project — one Authentication instance, one Firestore, one set of rules. A
patient who signs up on the phone is the same user the doctor sees on the web.

```powershell
cd cardiac_mobile
copy firebase.example.json firebase.local.json
flutter pub get
flutter run --dart-define-from-file=firebase.local.json
```

Fill `firebase.local.json` with the same Firebase values as the web `.env`
(it is git-ignored). On the Android emulator, `PREDICTION_API_URL` must be
`http://10.0.2.2:8000` — `localhost` inside the emulator is the emulator
itself, not your PC.

---

## Limitations

1. 303 patients, one hospital, 1980s. Small, single-centre, not representative
   of a modern or Indian population.
2. ≈ 75 % cross-validated accuracy — roughly one in four classified incorrectly.
3. ≈ 0.69 cross-validated recall — at the default cut the model misses about
   31 % of patients who do have significant narrowing. A Low result is **not**
   reassurance.
4. `thalach` means a supervised stress-test maximum in training, but a fitness
   tracker reading in the app. Genuine distribution shift.
5. Predicts angiographic narrowing, not heart attack or stroke risk over time.
6. Three inputs need a recent medical report; guessed values give a meaningless
   result.
7. The risk value is written by the browser. Rules validate its shape and make
   it immutable, but cannot prove it came from the model.
8. **Not a medical device.** Not validated, not certified, not for clinical use.

---

## Emergency

This application is **not** an emergency service. If a user reports severe
chest pain, difficulty breathing, fainting or pain spreading to the arm, jaw,
neck or back, the assessment form shows an immediate warning to contact local
emergency services and does not ask them to rely on the model.

---

## Testing

See [TESTING.md](TESTING.md) for the full checklist and what has been verified.
