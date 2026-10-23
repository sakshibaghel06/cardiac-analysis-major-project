# Test Checklist

Status legend:

- **Automated** — a script verifies it; the result below is from an actual run
- **Verified** — checked in a browser during development
- **Manual** — you must run it; needs two signed-in accounts or live credentials

---

## 0. Start everything

```bash
cd cardiac_ml && venv/Scripts/python -m uvicorn api:app --port 8000
```
```bash
cd cardiac && npm run dev
```

⚠️ If port 5173 is already taken, Vite silently moves to 5174. Check the
URL it prints — an old server on 5173 will serve stale code.

---

## 1. Machine learning — **Automated**

```bash
cd cardiac_ml && venv/Scripts/python train_model.py
```

| Check | Result |
|---|---|
| Dataset loads (303 real records) | ✅ |
| Target binarised `num > 0` | ✅ 139 positive / 164 negative |
| Logistic Regression baseline trains | ✅ CV acc 0.7529 ± 0.0517 |
| Random Forest trains | ✅ CV acc 0.7519 ± 0.0566 |
| Accuracy / precision / recall / F1 / ROC-AUC reported | ✅ all in `metrics.json` |
| Confusion matrix reported | ✅ TN 29, FP 4, FN 3, TP 25 |
| Model chosen on measured validation performance | ✅ CV recall |
| Reproducible | ✅ `random_state = 42` throughout |
| Preprocessing saved with the model | ✅ single sklearn `Pipeline` |
| No data leakage | ✅ scaler/encoder fitted inside CV folds |

**Quote cross-validated accuracy ≈ 75 %, not the 88.5 % test figure** — see
`cardiac_ml/FEATURE_ANALYSIS.md` §3.

---

## 2. Prediction API — **Automated**

| Check | Result |
|---|---|
| `GET /health` | ✅ 200, `random_forest` loaded |
| CORS header for `localhost:5173` | ✅ `access-control-allow-origin` present |
| Known disease row → predicts disease | ✅ p = 0.949, HIGH |
| Known healthy row → predicts healthy | ✅ p = 0.052, LOW |
| `age: 5` rejected | ✅ HTTP 422 |
| `cp: 0` rejected (what the old form sent) | ✅ HTTP 422 |
| `fbs: 110` rejected (raw mg/dL) | ✅ HTTP 422 |
| `trestbps: 999` rejected | ✅ HTTP 422 |
| Missing field rejected | ✅ HTTP 422 |
| Risk bands span the range | ✅ LOW → HIGH across profiles |

> Those known rows are **training** rows, so they show the pipeline is wired
> correctly — not that the model generalises. Generalisation is §1's CV numbers.

---

## 3. Firestore security — **Automated**

```bash
npm run test:rules
```

**76 passed, 0 failed.** Covers:

- Patient cannot read another patient's profile, assessment, consultation or prescription
- Patient cannot edit doctor or hospital records
- Patient cannot rewrite or delete their own risk result
- Patient cannot write a risk outside `LOW`/`MODERATE`/`HIGH`
- Patient cannot self-accept a consultation
- Patient cannot mark a payment paid
- Patient cannot create a prescription
- Doctor **with** a care link can read their patient
- Doctor **without** a care link cannot read that patient — profile, assessment or consultation
- Doctor cannot edit another doctor's record
- Doctor cannot rewrite the patient's risk
- Only the two participants can read or write a video room or push ICE candidates
- Signed-out users are refused everywhere
- Payout destinations are unreadable by patients **and** doctors
- Unlisted collections denied by default
- A patient cannot change their own role to doctor
- A new user cannot sign up as a doctor
- A user cannot create a profile under someone else's uid
- A patient cannot create a doctors document for themselves

---

## 4. Payment signature — **Automated**

| Check | Result |
|---|---|
| Genuine Razorpay signature accepted | ✅ |
| Guessed signature rejected | ✅ |
| Signature from wrong secret rejected | ✅ |
| Replayed signature for a different payment rejected | ✅ |
| Empty signature rejected | ✅ |
| Constant-time comparison used | ✅ `hmac.compare_digest` |

---

## 5. Routing and guards — **Verified**

| Route (signed out) | Lands on |
|---|---|
| `/risk`, `/result`, `/consultations`, `/consult-doctor` | `/` |
| `/prescription/:id`, `/video-consultation/:id` | `/` |
| `/doctor/dashboard`, `/doctor/request/:id` | `/` (single login) |
| `/doctor/login` *(retired)* | `/` |
| `/doctor/consultations`, `/doctor/patients` *(were blank)* | `/doctor/dashboard` → `/` |
| `/emergency` | `/` |
| unknown route | `/` |

No route renders a blank page.

---

## 6. Risk assessment form — **Verified**

| Check | Result |
|---|---|
| Exactly 9 fields | ✅ |
| `cp` offers 1,2,3,4 (not 0–3) | ✅ |
| Ranges match the API | ✅ age 18–120, BP 70–250, chol 100–600, HR 60–230 |
| Out-of-range shows an inline error | ✅ "Must be between 18 and 120" |
| Error clears when corrected | ✅ |
| Incomplete submit blocked | ✅ 9 errors, no API call |
| Emergency symptom → immediate warning | ✅ "Seek emergency medical help now." |
| Submits exactly the 9 model features | ✅ no hardcoded extras |
| Save blocked when signed out | ✅ |

---

## 7. Authentication — **Manual**

- [ ] Sign up creates an Auth user **and** a `users/{uid}` document with `role: "patient"`
- [ ] Sign up rejects passwords under 6 characters
- [ ] Sign up rejects mismatched confirmation
- [ ] Login with a wrong password shows "Incorrect email or password."
- [ ] Forgot password shows the same message whether or not the account exists
- [ ] An account created before this change gets a `users` document on next login
- [ ] Doctor login lands on the doctor dashboard
- [ ] A patient who opens `/doctor/dashboard` is bounced to `/patient/dashboard`

---

## 8. Consultation flow — **Manual**

Needs a patient account and a doctor account whose **`doctors` document ID is
the doctor's Auth UID**.

- [ ] Patient: assessment → result → choose city, hospital, doctor
- [ ] A doctor with no linked Auth account is refused with a clear message
- [ ] Request appears in Firestore as `pending`
- [ ] Doctor sees it on their dashboard
- [ ] Doctor opens it and sees the patient's report and risk
- [ ] Accept → status `accepted` **and** a `care_links/{doctorUid}_{patientUid}` document appears
- [ ] Patient's status page updates live, without a refresh
- [ ] Reject → status `rejected` and the care link is **removed**
- [ ] Patient can cancel while pending; cannot cancel after acceptance
- [ ] Legacy `PENDING` requests are actionable (status read is case-insensitive)

---

## 9. Video consultation — **Manual**

Two browser **profiles** on `http://localhost` — not two tabs. Windows gives
one process exclusive camera access, so the second tab gets `NotReadableError`.

For two devices: `npm run dev:lan`, then open the `https://192.168.x.x:5173`
URL on both and accept the certificate warning once per device.

- [ ] Both sides see their **own** camera preview (this was permanently black before)
- [ ] Patient sees the doctor; doctor sees the patient
- [ ] Audio works both ways
- [ ] Mute / unmute
- [ ] Camera off / on
- [ ] End call returns doctor → dashboard, patient → status page
- [ ] The remaining participant is told the other person left
- [ ] **Doctor reloads mid-call → reconnects** (used to deadlock on a stale answer)
- [ ] **Patient reloads mid-call → reconnects**
- [ ] Deny camera permission → message tells you to allow it, with a working Try Again
- [ ] Camera in use elsewhere → message says so specifically
- [ ] No camera, working mic → joins audio-only rather than failing
- [ ] Open over plain `http://<LAN-IP>` → message names the origin and says use localhost or HTTPS, **not** "permission denied"
- [ ] A third account opening the consultation URL is refused

---

## 9a. Doctor dashboard — **Manual** (needs a doctor account)

Seven sections in one screen. The sidebar links used to point at
`/doctor/consultations`, `/doctor/patients` and `/doctor/profile`, none of
which were routes — every one rendered a blank page. They are now sections.

- [ ] Dashboard — six stat tiles, all computed from Firestore (no typed-in numbers)
- [ ] Consultation Requests — pending only; badge count matches
- [ ] Patients — derived from this doctor's own consultations, one row per patient
- [ ] Risk Assessments — only patients with an accepted consultation appear
- [ ] Upcoming Consultations — accepted; Join Call and Prescription buttons
- [ ] Prescriptions — issued by this doctor
- [ ] Consultation History — completed, declined and cancelled
- [ ] Sidebar badges update after accepting a request
- [ ] A second doctor sees **none** of the first doctor's patients

Verified without an account: all 7 sections wired to state, all 4 data
functions used, **zero literal numbers** in the stat tiles, and no navigation
to the three dead routes.

---

## 10. Prescription — **Manual**

- [ ] Doctor sees the write form; patient sees read-only
- [ ] Blank diagnosis blocked
- [ ] A medicine row missing name/dosage/frequency/duration is blocked
- [ ] A completely empty row is ignored, not an error
- [ ] Add and remove medicine rows
- [ ] Saving marks the consultation `completed`
- [ ] Patient sees it under My Consultations → View Prescription
- [ ] Patient cannot create one (rules refuse — see §3)

---

## 11. Payment — **Manual**, needs Razorpay test keys

```bash
set RAZORPAY_KEY_ID=rzp_test_xxx
set RAZORPAY_KEY_SECRET=xxx
set GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\serviceAccount.json
```

- [ ] Without keys, the app says payments are not configured (never fakes success)
- [ ] `GET /payments/config` reports `configured: false` → `true` once set
- [ ] Fee shown on the consultation card
- [ ] Test card completes and the consultation flips to `paid`
- [ ] Closing the widget leaves it unpaid, with no error
- [ ] Paying twice is refused (HTTP 409)
- [ ] Re-posting the same verification is idempotent
- [ ] Tampering with the amount is refused (server checks against the consultation)
- [ ] A forged signature is refused and the payment marked `failed`

---

## 12. Known gaps

| Gap | Impact |
|---|---|
| Risk value is written by the browser | Rules validate shape and range and make assessments immutable, but cannot prove it came from the model. Needs a Cloud Function or the API writing via Admin SDK. |
| `thalach` measured differently in training vs app | Stress-test max HR vs a fitness-tracker reading. Documented in `FEATURE_ANALYSIS.md` §2. |
| 2 doctor records have no Auth account | Patients are blocked from selecting them. Create accounts or set `available: false`. |
| 5 legacy requests reference an unknown doctor | Reported by `scripts/migrate_firestore.mjs`; not deleted. |
| No patient profile edit screen | Profile is created at signup; there is no screen to edit it yet. |
| No Flutter patient app | Not started. |
| Rules not yet deployed | **Your database is currently open.** `firebase deploy --only firestore:rules` |
