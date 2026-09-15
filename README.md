<div align="center">

# 🛡️ RESCUEN — The Ultimate Personal Safety Companion

**A production, community-powered emergency response app for Android.**

One touch. A 1 km rescue network, your family, and the authorities — alerted at once.

[![Platform](https://img.shields.io/badge/platform-Android-3ddc84)](https://play.google.com/store/apps/details?id=com.officialrescuen.app)
[![React Native](https://img.shields.io/badge/React%20Native-0.84-61dafb)](https://reactnative.dev/)
[![Firebase](https://img.shields.io/badge/Backend-Firebase-ffca28)](https://firebase.google.com/)
[![License](https://img.shields.io/badge/license-Proprietary-blue)](#-license)

</div>

---

## Overview

RESCUEN turns every nearby phone into a first responder. When a user triggers an SOS,
the app instantly broadcasts their live location to every RESCUEN user within a
**1 kilometre radius**, silently texts their saved family contacts and the police,
sounds a loud siren, and begins recording tamper-resistant evidence — all while the
screen can stay locked.

It is built for real emergencies: background-resilient, one-handed, and usable in the
few seconds a person may have.

## ✨ Key Features

| | Feature | What it does |
|---|---|---|
| 🚨 | **Instant SOS** | Hold the on-screen panic button, **triple-press the volume key** (works from a locked screen), or ask the AI assistant — any of them fire the full alert chain. |
| 📡 | **1 km Community Radar** | A geohash-indexed broadcast reaches only nearby users, so help is genuinely close. Rescuers see the victim, distance, and a live route. |
| 👨‍👩‍👧 | **Silent Family + Police SMS** | Direct SMS to up to 5 family contacts and emergency services (100) with a live Google Maps link — no extra taps. |
| 🧭 | **Follow-Me (dead-man's switch)** | Monitors your journey; if you stop unexpectedly it asks *"Are you safe?"* and auto-triggers SOS if you don't respond. |
| 🔐 | **Secure Evidence Vault** | On SOS, records a "black-box" audio stream and AI-detected photo frames, uploaded to write-only secure storage as court-usable evidence. |
| 🤖 | **RESCUEN AI Assistant** | A Gemini-powered assistant with server-side function-calling that can trigger SOS, start Follow-Me, and answer safety questions in multiple languages. |
| 🔑 | **Verified Onboarding** | Google Sign-In + phone OTP verification, with a 60-day change lock on emergency numbers to prevent tampering. |
| ☎️ | **One-tap helplines** | Direct-dial 112 (emergency), 1091 (women), 108 (ambulance) from the assistant screen. |
| 🗑️ | **Privacy-first account control** | 30-day soft-delete with a grace period, and a transparent permissions flow explained in six Indian languages. |

## 🏗️ Architecture

```
┌───────────────────────────┐        ┌──────────────────────────────┐
│      RESCUEN app (RN)      │        │        Firebase backend       │
│                            │        │                              │
│  App.tsx  ── UI & flows    │  FCM   │  sendEmergencyAlert  (trigger)│
│  RescuenBrain ── AI bridge │◀──────▶│  cancelEmergencyAlert(trigger)│
│  SafeJourneyEngine ── DMS  │  calls │  askGemini        (callable)  │
│  SecureVaultManager ── evi │◀──────▶│  sendSupportEmail (callable)  │
│  NotificationManager       │        │                              │
│                            │  data  │  Firestore · Storage · Auth   │
│  Native (Kotlin) volume-   │◀──────▶│  Cloud Messaging · Functions  │
│  key + lock-screen bridge  │        │                              │
└───────────────────────────┘        └──────────────────────────────┘
```

- **Client:** React Native `0.84` (New Architecture / Fabric), TypeScript. A thin
  Kotlin layer (`MainActivity.kt`) adds the volume-key SOS and lock-screen wake-up.
- **Proximity:** 9-character geohashes on every user and emergency doc; queries use a
  4-char prefix range so lookups stay bounded as the user base grows.
- **Realtime:** Firestore snapshot listeners for live emergencies + FCM high-priority
  data messages for background/locked-screen delivery.
- **AI:** Gemini `2.5-flash` runs **server-side only** (the key never ships in the app),
  using function-calling to convert natural language into safety actions.

## 🔒 Security & Privacy

Security is treated as a first-class feature, not an afterthought:

- **No secrets in source.** Gemini and email credentials are stored as Firebase
  secrets (`firebase functions:secrets:set …`) and injected at runtime.
- **Signed-in-only data.** `firestore.rules` and `storage.rules` require an
  authenticated RESCUEN user for every read/write, with a default-deny fallthrough.
- **Write-only evidence vault.** Recorded evidence can be uploaded but **never read
  back from a device** — only the trusted backend/console can retrieve it.
- **Least-privilege callables.** All callable functions reject unauthenticated calls
  to prevent quota abuse and spam.
- **Server-side proximity.** Distance filtering for alerts happens in Cloud Functions,
  not on the client.
- **Private data isn't broadcast.** A `presence` layer exposes only name/location for
  the radar; phone and family numbers never leave the owner's private document, and
  the `users` collection can't be range-scanned (`list` is denied).
- **Secured REST API.** `restApi` exposes `/health`, `/v1/sos/trigger`, `/v1/sos/cancel`,
  each requiring a Firebase ID token (and App Check when enabled).

> Data in Firebase Storage is encrypted in transit (TLS) and at rest. This is strong
> transport/at-rest protection — it is intentionally **not** described as end-to-end
> encryption.

## 🚀 Getting Started

### Prerequisites
- Node.js ≥ 22, JDK 17, Android Studio + SDK
- A Firebase project (`google-services.json` in `WomenSafetyApp/android/app/`)
- Firebase CLI: `npm i -g firebase-tools`

### Run the app
```bash
cd WomenSafetyApp
npm install
npm run android      # build & launch on a connected device/emulator
```

### Deploy the backend & security rules
```bash
# 1) Install function deps
cd functions && npm install && cd ..

# 2) Set secrets (one-time; you'll be prompted for each value)
firebase functions:secrets:set GEMINI_API_KEY
firebase functions:secrets:set GMAIL_USER
firebase functions:secrets:set GMAIL_APP_PASSWORD

# 3) Deploy rules + functions
firebase deploy --only firestore:rules,storage,functions
```

## 🗺️ Hardening roadmap

- **Identity model:** documents are currently keyed by email while Firebase Auth
  identifies users by `uid` (phone sessions carry no email). Migrating to `uid`-keyed
  documents will allow true per-owner write rules.
- **Client privacy:** move the nearby-user lookup fully server-side so raw locations
  and phone numbers of other users are never exposed to a client.
- **Scale:** shard high-write collections and add regional function deployments as the
  user base grows.

## 🧰 Tech Stack

**Mobile:** React Native, TypeScript, Kotlin · **Maps/Location:** react-native-maps,
Geolocation, geohashing · **Backend:** Firebase (Auth, Firestore, Cloud Functions,
Cloud Messaging, Storage) · **AI:** Google Gemini · **Notifications:** Notifee.

## 👤 Author

**Bapan Ghosh** — Full-Stack & Cross-Platform Developer
🌐 [bapanghosh.netlify.app](https://bapanghosh.netlify.app/) · ✉️ rescuensupport@gmail.com

## 📄 License

© Bapan Ghosh. All rights reserved. This is proprietary software; it may not be copied,
distributed, or used without explicit written permission from the author.
