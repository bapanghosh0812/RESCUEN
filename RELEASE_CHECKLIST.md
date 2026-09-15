# RESCUEN — Play Store Release Checklist

Follow this in order before publishing a new version. Boxes marked **(you)** need
your action outside this repo (Firebase / Play Console / Google Cloud).

## 1. Security must-dos (do these once, before any public release)
- [ ] **(you)** Rotate the old leaked credentials (they were once committed):
  - Gemini API key → regenerate in Google AI Studio.
  - Gmail App Password for `rescuensupport@gmail.com` → delete old, create new
    (Google Account → Security → App passwords).
- [ ] **(you)** Set them as Firebase secrets, then they are injected at runtime:
  ```bash
  firebase functions:secrets:set GEMINI_API_KEY
  firebase functions:secrets:set GMAIL_USER
  firebase functions:secrets:set GMAIL_APP_PASSWORD
  ```
- [ ] **(you)** Restrict the Google Maps API key (AndroidManifest) to the app's
  package name + release SHA-1 in Google Cloud Console → Credentials.
- [ ] **(you)** Enable **App Check** (Play Integrity) in Firebase Console. This is
  the key control that stops anyone but the genuine app from calling the backend.

## 2. Deploy the backend + rules
- [ ] `cd functions && npm install`
- [ ] `firebase deploy --only firestore:rules,storage,functions`
- [ ] Confirm in the Firebase console that Firestore/Storage rules are the new ones
  (signed-in only, evidence write-only).

## 3. Auth wiring for the release build
- [ ] **(you)** Add the release signing SHA-1 to Firebase (Project Settings → your
  Android app → Add fingerprint), else Google Sign-In / phone OTP fail:
  - SHA-1: `6730f7db64b2a53dcdb29e07b1ae87294063044c`
  - (If Play App Signing is on, also add the App-signing SHA-1 shown in Play Console.)

## 4. Build the artifact
- Testing on your own phone → APK:
  ```bash
  TEMP='E:/WomenSafetyApp/buildtmp' TMP='E:/WomenSafetyApp/buildtmp' /e/WomenSafetyApp/WomenSafetyApp/android/gradlew -p /e/WomenSafetyApp/WomenSafetyApp/android assembleRelease -PreactNativeArchitectures=arm64-v8a -x lintVitalRelease --no-daemon
  ```
  → `WomenSafetyApp/android/app/build/outputs/apk/release/app-release.apk`
- Play Store upload → AAB (all ABIs):
  ```bash
  TEMP='E:/WomenSafetyApp/buildtmp' TMP='E:/WomenSafetyApp/buildtmp' /e/WomenSafetyApp/WomenSafetyApp/android/gradlew -p /e/WomenSafetyApp/WomenSafetyApp/android bundleRelease -x lintVitalRelease --no-daemon
  ```
  → `WomenSafetyApp/android/app/build/outputs/bundle/release/app-release.aab`
- [ ] Bump `versionCode` (currently 23) and `versionName` in
  `WomenSafetyApp/android/app/build.gradle` for each new upload.

## 5. Play Console
- [ ] **(you)** Create a release on the **Internal testing** track first, upload the
  AAB, add yourself as a tester, install via the Play link (no Play Protect block).
- [ ] **(you)** Complete the **Data safety** form honestly — the app collects precise
  location, phone number, contacts, and audio evidence. Declare each and its purpose.
- [ ] **(you)** SMS/Call Log permission: Play requires a Permissions Declaration for
  `SEND_SMS`. Justify it as core emergency functionality (the SOS family alert).
- [ ] After internal testing looks good → promote to Production.

## Notes
- Never commit `keystore.properties`, `*.keystore`, or function secrets — all are
  git-ignored.
- Sideloaded installs may show "blocked by Play Protect" because the app requests
  SMS/Call permissions; that disappears when installed via the Play Store.
