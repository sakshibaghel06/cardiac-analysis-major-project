# CardioCare

**AI-Based Cardiovascular Risk Prediction and Emergency Tele-Consultation System**

A patient completes a cardiac risk screening, receives a machine-learning risk
estimate, requests a consultation with a doctor, pays the fee, meets the doctor
over video, and receives a prescription — all through one Firebase backend.

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
│   ├── payments.py         server-side payment verification
│   ├── test_api.py         API integration test
│   ├── test_payment_security.py  payment unit test
│   ├── model.pkl           deployed sklearn Pipeline
│   ├── model_meta.json     feature schema + risk thresholds
│   ├── metrics.json        every measured score
│   ├── FEATURE_ANALYSIS.md feature feasibility + model report
│   ├── .env.example        server-side config (Razorpay, Admin SDK)
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
├── tests/rules.test.mjs    76 security-rule tests
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
cd cardiac_ml ; python -m venv venv ; .\venv\Scripts\pip install -r requirements.txt
```

```powershell
cd ..\cardiac ; npm install ; copy .env.example .env
```

Open `cardiac\.env` in a text editor and fill in the six `VITE_FIREBASE_*`
values. Then, in **two separate terminals**:

```powershell
cd cardiac_ml ; .\venv\Scripts\python -m uvicorn api:app --port 8000
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
| **Java JDK** | 11 or newer | *only* to run the Firestore emulator for `npm run test:rules` | <https://adoptium.net> |
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
.\venv\Scripts\python -m uvicorn api:app --port 8000
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
copy .env.example .env
```

> `cp` is not a Windows command — use `copy` in PowerShell and cmd. In Git
> Bash, `cp .env.example .env` works.

Now edit `cardiac\.env` and fill in the Firebase values —
see [Credentials each teammate needs](#credentials-each-teammate-needs).

The app **refuses to start** with an incomplete Firebase config, and names the
missing keys. That is deliberate: the alternative is a confusing
`auth/invalid-api-key` or `permission-denied` several screens later.

### 4. Run both halves

Two terminals, both open at the same time. The frontend calls the API from the
browser, so the API must be running first.

| Terminal | Command | Serves |
|---|---|---|
| 1 | `cd cardiac_ml` → `.\venv\Scripts\python -m uvicorn api:app --port 8000` | ML API |
| 2 | `cd cardiac` → `npm run dev` | React app |

### 5. Deploy the security rules and indexes

Do this **before any real use.** Without it the database is wide open to
anyone who has the project ID — which is shipped in every browser bundle.

```powershell
firebase login
firebase use cardiac-analysis
firebase deploy --only firestore:rules,firestore:indexes
```

Only one teammate needs to do this, and only when `firestore.rules` or
`firestore.indexes.json` changes. It affects the shared Firebase project, so
agree on it before running it.

---

## Ports

| Port | Process | Started by | Notes |
|---|---|---|---|
| **5173** | Vite dev server | `npm run dev` | Vite silently moves to **5174** if taken — read the URL it prints |
| **8000** | FastAPI ML + payments API | `uvicorn api:app --port 8000` | `VITE_ML_API_URL` must match |
| **8080** | Firestore emulator | `npm run test:rules` | test only |
| **9099** | Auth emulator | emulator suite | test only |
| **4000** | Emulator UI | emulator suite | test only |

The API's CORS allow-list already covers `localhost` and `127.0.0.1` on 5173
and 5174. If you run the frontend anywhere else, set `CARDIAC_ALLOWED_ORIGINS`
on the API process or the browser will block every call.

---

## Credentials each teammate needs

There are three separate things, and they are not equally secret. Treating
them the same is the usual source of either a leaked key or a blocked
teammate.

### 1. Firebase web config — needed by everyone, not secret

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

So it is fine to paste them to a teammate over chat. It is still **not** fine
to commit `.env` — not because the values are secret, but because the file is
per-environment, and the habit is what keeps the genuinely secret files below
out of the repository.

### 2. Razorpay keys — server-side only, genuinely secret

Needed **only** to exercise the payment step. Everything else — risk
prediction, consultations, video, prescriptions — runs without them.

| Variable | Secret? | Purpose |
|---|---|---|
| `RAZORPAY_KEY_ID` | No — the browser receives it | Identifies the account |
| `RAZORPAY_KEY_SECRET` | **Yes** | Signs and verifies payments |
| `RAZORPAY_WEBHOOK_SECRET` | **Yes** | Verifies webhook callbacks |

**Get them:** <https://dashboard.razorpay.com> → *Account & Settings* →
*API Keys* → *Generate Test Key*. The secret is shown **once**.

Each teammate needs their **own test keys** from their own Razorpay account,
or one shared test account whose secret is sent through something better than
a group chat. Never put them in a `VITE_` variable — that publishes them.

### 3. Firebase service-account JSON — most secret of all

Needed only to **record** a payment. The payment endpoints write to Firestore
with admin credentials, which is exactly why `firestore.rules` can forbid
every client write to `/payments` — a browser can never mark itself paid.

**Get it:** Firebase Console → ⚙ Project settings → *Service accounts* →
*Generate new private key*.

This file **bypasses every security rule.** Store it outside the repository,
never commit it, and never send it over chat. Point the API at it with
`GOOGLE_APPLICATION_CREDENTIALS`.

### Configuring the payment API

The API does **not** read a `.env` file — there is no `python-dotenv`
dependency. Set the variables in the shell that starts uvicorn, in the same
terminal, before the server command:

```powershell
$env:RAZORPAY_KEY_ID = "rzp_test_xxxxxxxxxxxxx"
$env:RAZORPAY_KEY_SECRET = "your_test_secret"
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\Users\you\secrets\cardiac-adminsdk.json"
.\venv\Scripts\python -m uvicorn api:app --port 8000
```

`$env:` assignments last only for that terminal window. Set them again each
time, or add them to your Windows user environment variables.

`cardiac_ml\.env.example` documents every server-side variable. Copy it to
`cardiac_ml\.env` as your own record of what you have set — the API will not
read it, but you will not have to remember.

### What payments can and cannot do

Be clear about this before demoing:

- **Without Razorpay keys** — `GET /payments/config` honestly returns
  `{"configured": false}` and the UI says payment is unavailable. It never
  pretends a payment succeeded. Everything else works.
- **With test keys** (`rzp_test_...`) — the full checkout flow works end to
  end and signatures verify, but **no real money moves.** Use Razorpay's
  published test card numbers. This is what teammates should use.
- **With `firebase-admin` missing or no service-account JSON** — checkout
  still signs correctly, but recording the payment returns HTTP 503.
  `firebase-admin` is in `requirements.txt`; the JSON key is not and cannot be.
- **Live payments** (`rzp_live_...`) need a Razorpay account that has
  completed **KYC/business verification**, which takes days and requires
  business documents. **Cloning this repository does not give anyone the
  ability to take real payments**, and nothing in this setup should be
  described as doing so.

---

## Running the tests

All five suites, from a fresh clone. 179 assertions total, all passing.

### Frontend logic — no setup needed

```powershell
cd cardiac
node scripts/test_assessment_encoding.mjs
node scripts/test_consultation_status.mjs
node scripts/test_prescription_pdf.mjs
```

28 + 17 + 14 assertions. Plain Node, no test runner, no services required.

### Payment security — no credentials needed

```powershell
cd cardiac_ml
.\venv\Scripts\python test_payment_security.py
```

21 assertions: signature verification, webhook raw-body hashing, replay
rejection, idempotency, payout routing. Uses fixed dummy secrets, so it needs
no Razorpay account.

### ML API — needs the API running

```powershell
cd cardiac_ml
.\venv\Scripts\python -m uvicorn api:app --port 8000     # terminal 1
.\venv\Scripts\python test_api.py                        # terminal 2
```

23 assertions: liveness, CORS, predictions against rows with known ground
truth, server-side input validation, risk bands.

### Firestore security rules — needs Java

```powershell
npm run test:rules
```

76 assertions against the Firestore emulator. This is the suite that matters
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
| App loads, risk assessment fails with a network error | ML API not running, or on another port | Start uvicorn on 8000; check `VITE_ML_API_URL` matches |
| Risk assessment fails, console shows a CORS error | Frontend on an origin the API does not allow | Vite moved to 5174 — already allowed — or set `CARDIAC_ALLOWED_ORIGINS` on the API |
| `model.pkl / model_meta.json not found` | Running uvicorn from the wrong folder | `cd cardiac_ml` first |
| `permission-denied` from Firestore | Rules not deployed, or the doctor doc is keyed wrong | `firebase deploy --only firestore:rules`; a doctor's document ID **must be** their Auth UID |
| A query fails asking for an index | Composite index missing | `firebase deploy --only firestore:indexes`, or click the link in the error |
| `npm run test:rules` hangs or fails to start | Java missing, or a stale emulator holding 8080 | Install a JDK. Then: `Get-NetTCPConnection -LocalPort 8080` and stop the process it names |
| Edits do not appear in the browser | An old Vite server on 5173 is serving stale code | Read the URL Vite printed; close the other server |
| Camera does not work on a second device | Not a secure context | Use `npm run dev:lan` (HTTPS) — see [Video consultation](#video-consultation) |
| Payment says "not configured" | No Razorpay keys — working as intended | See [Configuring the payment API](#configuring-the-payment-api) |
| Payment returns HTTP 503 when recording | No service-account JSON | Set `GOOGLE_APPLICATION_CREDENTIALS` |

---

## Portability

The repository has no dependency on any one machine:

- No absolute paths anywhere in the source. `api.py` resolves `model.pkl`
  relative to its own file; the frontend resolves everything through Vite.
- No credentials in source control. Firebase config, Razorpay keys and the
  Admin SDK path are all read from the environment, with `.env.example`
  templates for each.
- `model.pkl` is committed, so a fresh clone predicts without retraining —
  and `train_model.py` reproduces it exactly from the committed dataset.
- Machine-specific files — `.env`, `scripts/seed.config.json`,
  `cardiac_mobile/firebase.local.json`, service-account JSON, `venv/`,
  `node_modules/`, `dist/` — are git-ignored, each with a committed
  `.example` counterpart where one is useful.

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
| `payments/{id}` | Payment record | Server only |

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
call ends, the patient lands on the payment page; the prescription unlocks
once the server has verified the payment signature.

If Razorpay is not configured, the payment page says so plainly rather than
blocking the demo or faking success. `VITE_DEFAULT_CONSULTATION_FEE` supplies
the fee when a doctor record has no `fee` field of its own.

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
- **Clients can never mark a payment paid** — that requires an HMAC signature
  verified by the server with a secret the browser never sees

Secrets live in environment variables and are git-ignored. The repository
contains no API secret, no service-account key and no private key; see
[Credentials each teammate needs](#credentials-each-teammate-needs) for what
is secret and what only looks like it.

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
