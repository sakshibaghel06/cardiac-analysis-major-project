# CardioCare mobile app

The Flutter patient app shares Firebase Authentication and Firestore with the
website. It supports patient sign-in/sign-up, risk assessments through the
FastAPI model, assessment history, consultation requests, and a summary of
prescriptions. A Firebase project and authorized Android/iOS app registrations
are required for authenticated use.

## Configure Firebase

Copy the example and fill it with values supplied by the authorized Firebase
project owner:

```powershell
if (-not (Test-Path .\firebase.local.json)) {
    Copy-Item .\firebase.example.json .\firebase.local.json
} else {
    Write-Host "Keeping the existing firebase.local.json."
}
```

In Firebase Console, use **Project settings → General → Your apps**. Configure
the shared API key, sender ID, and project ID; use the web app ID for
`FIREBASE_APP_ID`, the Android app ID for `FIREBASE_ANDROID_APP_ID`, and the iOS
app ID for `FIREBASE_IOS_APP_ID`. The Android/iOS registrations must match the
application identifiers in this project. Do not infer the intended Firebase
project from `.firebaserc`. The JSON file is git-ignored and must not contain a
service-account key.

Email/password sign-in must be enabled in Firebase Authentication. The
corresponding Firestore rules and authorized doctor/hospital reference records
must already exist; this app does not deploy rules or seed a remote database.

## Run on Windows

Install Flutter with Dart SDK 3.9.2 or newer and a JDK 17 or 21 for Android
builds; accept the Android SDK licenses with `flutter doctor --android-licenses`.
From the repository root, start the backend in one PowerShell terminal:

```powershell
Set-Location .\cardiac_ml
.\venv\Scripts\python -m uvicorn api:app --host 0.0.0.0 --port 8000
```

In another terminal:

```powershell
Set-Location .\cardiac_mobile
flutter pub get
flutter devices
flutter run --dart-define-from-file=firebase.local.json
```

The example uses `http://10.0.2.2:8000`, the Android emulator's route to the
Windows host. On a physical Android phone, edit `PREDICTION_API_URL` in
`firebase.local.json` to `http://<Windows-LAN-IPv4>:8000`, connect both devices
to the same network, and allow the port through Windows Firewall. Find the
host's IPv4 address with `ipconfig`. The backend must listen on `0.0.0.0` for
the phone to reach it. The Android debug manifest permits cleartext HTTP for
local development; production builds should use an HTTPS API URL.

The iOS Simulator requires macOS and is not runnable from Windows. For an iOS
device, configure a reachable HTTPS API endpoint and the matching iOS Firebase
app registration.

Stop either process with **Ctrl+C**. Never deploy Firestore rules, change a
Firebase project, or modify remote data as part of local setup without project
owner approval.

## Checks

```powershell
flutter analyze
flutter test
```
