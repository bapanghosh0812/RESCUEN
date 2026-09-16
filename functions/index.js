const { onDocumentCreated, onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const nodemailer = require('nodemailer');
const path = require('path');

admin.initializeApp();

// ---------------------------------------------------------------------------
// SCALING / "LOAD BALANCING"
// Cloud Functions v2 run on Cloud Run: Google's front end already load-balances
// requests and AUTOSCALES instances up and down automatically — there is no
// separate load balancer to add. These global defaults just set the envelope:
//  - maxInstances 80: autoscale headroom (raise as the user base grows; guards
//    against runaway cost from a bug/abuse spike).
//  - concurrency 80: each warm instance serves many requests at once, so we hit
//    far fewer cold starts and stay smooth under load.
//  - 256MiB / 60s: enough for these light handlers.
// The critical SOS-broadcast trigger overrides these below (kept always-warm).
// ---------------------------------------------------------------------------
setGlobalOptions({
    region: "us-central1",
    maxInstances: 80,
    concurrency: 80,
    memory: "256MiB",
    timeoutSeconds: 60,
});

// ---------------------------------------------------------------------------
// SECRETS (never hardcode credentials in source — they end up in git history).
// Set them once with the Firebase CLI, then deploy:
//   firebase functions:secrets:set GEMINI_API_KEY
//   firebase functions:secrets:set GMAIL_USER
//   firebase functions:secrets:set GMAIL_APP_PASSWORD
// See README.md -> "Deployment & secrets".
// ---------------------------------------------------------------------------
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const GMAIL_USER = defineSecret("GMAIL_USER");
const GMAIL_APP_PASSWORD = defineSecret("GMAIL_APP_PASSWORD");

// Latest Gemini flash model. Change here when a newer one ships.
const GEMINI_MODEL = "gemini-3.8-flash";

const FCM_MULTICAST_LIMIT = 500; // FCM caps sendEachForMulticast at 500 tokens/call.

/** Haversine distance in km. */
function getDistanceInKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/** Send a data message to many tokens, transparently chunked to FCM's limit. */
async function sendMulticastChunked(baseMessage, tokens) {
    let sent = 0;
    for (let i = 0; i < tokens.length; i += FCM_MULTICAST_LIMIT) {
        const batch = tokens.slice(i, i + FCM_MULTICAST_LIMIT);
        const res = await admin.messaging().sendEachForMulticast({ ...baseMessage, tokens: batch });
        sent += res.successCount;
    }
    return sent;
}

// ---------------------------------------------------------------------------
// SERVER-SIDE SMS (reliability backup).
// The app also sends SMS from the victim's own phone, but that fails if the
// device is dead, seized, out of signal, or SMS permission was denied. A
// server-sent SMS via a gateway (Twilio / MSG91 / Fast2SMS ...) is the reliable
// path. This is an EXTENSION POINT: it stays a safe no-op until a provider is
// configured, so it never breaks deploys or the alert flow.
//
// To activate: implement the provider call below and add its key as a secret,
// then bind that secret to sendEmergencyAlert. Until then family SMS still goes
// out from the device — this only ADDS a second, more reliable channel.
// ---------------------------------------------------------------------------
async function sendServerSms(numbers, text) {
    const results = [];
    if (!process.env.SMS_PROVIDER || !process.env.SMS_API_KEY) {
        console.log("sendServerSms: no gateway configured — skipping (device SMS still fires).");
        return { configured: false, results };
    }
    // Example shape (fill in for your provider when ready):
    //   for (const to of numbers) {
    //     const r = await fetch(process.env.SMS_PROVIDER_URL, { method: 'POST', headers: {...}, body: ... });
    //     results.push({ to, ok: r.ok });
    //   }
    return { configured: true, results };
}

/** Append an auditable delivery record (admin-only; clients can't read it). */
async function logDelivery(sessionId, payload) {
    try {
        await admin.firestore().collection('sos_delivery_log').add({
            sessionId: sessionId || 'unknown',
            ...payload,
            at: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (e) {
        console.error("logDelivery error:", e);
    }
}

// ===========================================================================
// FIRESTORE TRIGGERS
// ===========================================================================

// 1. WHEN AN SOS IS RAISED -> BROADCAST TO NEARBY USERS (within 1 km)
// minInstances:0 = no always-on cost. Set to 1 (with `firebase deploy --force`)
// to keep a worker warm so the community alert fires with zero cold-start delay
// — that adds a small monthly bill. Device-side family SMS + siren are instant
// regardless (they don't hit the server).
exports.sendEmergencyAlert = onDocumentCreated(
    // Critical path: 1 always-warm worker (zero cold-start when an SOS fires) and
    // extra autoscale headroom so a burst of simultaneous emergencies never queues.
    { document: "active_emergencies/{userId}", minInstances: 1, maxInstances: 200, memory: "512MiB" },
    async (event) => {
    const snap = event.data;
    if (!snap) return;

    const emergencyData = snap.data() || {};
    const victimEmail = event.params.userId;

    if (!emergencyData.user || !emergencyData.l) {
        console.warn("sendEmergencyAlert: missing user/location on", victimEmail);
        return;
    }

    const victimName = emergencyData.user.name || "Someone";
    const victimPhone = emergencyData.user.myPhone || "N/A";
    const vLat = emergencyData.l.latitude;
    const vLng = emergencyData.l.longitude;
    const victimHash = emergencyData.h;
    const mapLink = `https://maps.google.com/?q=${vLat},${vLng}`;

    try {
        // --- (a) Push to nearby users, scanning only the same geohash cell.
        // Locations come from `presence` (privacy-safe, no phone/family/token);
        // legacy `users` docs are also scanned for backward compatibility during
        // migration. FCM tokens are then read from the admin-only user docs.
        const prefix = victimHash ? victimHash.substring(0, 4) : "";
        const db = admin.firestore();

        const scanForNearby = async (collectionName) => {
            let q = db.collection(collectionName);
            if (prefix) q = q.orderBy('h').startAt(prefix).endAt(prefix + '');
            const snap = await q.get();
            const emails = [];
            snap.forEach(doc => {
                const d = doc.data();
                const email = d.email || doc.id;
                if (email && email !== victimEmail && d.lastKnownLocation) {
                    const distance = getDistanceInKm(vLat, vLng, d.lastKnownLocation.latitude, d.lastKnownLocation.longitude);
                    if (distance <= 1.0) emails.push(email);
                }
            });
            return emails;
        };

        const nearbyEmails = Array.from(new Set([
            ...(await scanForNearby('presence')),
            ...(await scanForNearby('users')),
        ]));

        const tokens = [];
        if (nearbyEmails.length > 0) {
            const userDocs = await db.getAll(...nearbyEmails.map(e => db.collection('users').doc(e)));
            userDocs.forEach(d => {
                const u = d.data();
                if (u && u.fcmToken) tokens.push(u.fcmToken);
            });
        }

        if (tokens.length > 0) {
            const sent = await sendMulticastChunked({
                data: {
                    type: 'SOS_ALERT',
                    victimEmail: String(victimEmail),
                    victimName: String(victimName),
                    victimPhone: String(victimPhone),
                    mapLink: String(mapLink),
                    sentAt: Date.now().toString(),
                },
                android: { priority: 'high', ttl: 0 },
                apns: { headers: { 'apns-priority': '10' }, payload: { aps: { 'content-available': 1 } } },
            }, tokens);
            console.log(`SOS Alert delivered to ${sent}/${tokens.length} nearby devices.`);
            // Write the true count of people within 1 km so the victim's live
            // metrics are accurate (not just app-open clients that self-report).
            try { await snap.ref.update({ nearbyCount: tokens.length }); } catch (e) {}
            await logDelivery(victimEmail, { channel: 'fcm_nearby', attempted: tokens.length, delivered: sent });
        }

        // --- (b) Reliable server-side SMS backup to family + police.
        // Family numbers are private and intentionally NOT in the broadcast doc;
        // read them from the owner's user doc via the Admin SDK.
        const victimSnap = await db.collection('users').doc(victimEmail).get();
        const familyNumbers = victimSnap.exists && Array.isArray(victimSnap.data().familyNumbers)
            ? victimSnap.data().familyNumbers : [];
        const smsBody = `🚨 RESCUEN EMERGENCY ALERT 🚨\n${victimName} is in danger and needs help NOW.\n📍 Live location: ${mapLink}\nPlease reach them or call the police immediately.\n\n— Sent automatically by RESCUEN Team`;
        const smsTargets = [...familyNumbers.filter(n => n && String(n).length === 10), '112'];
        const smsResult = await sendServerSms(smsTargets, smsBody);
        await logDelivery(victimEmail, { channel: 'server_sms', configured: smsResult.configured, targets: smsTargets.length });
    } catch (error) {
        console.error("SOS Broadcast Error:", error);
    }
});

// 2. WHEN AN SOS IS DEACTIVATED -> STOP THE SIREN ON THE DEVICES THAT WERE ALERTED
exports.cancelEmergencyAlert = onDocumentDeleted("active_emergencies/{userId}", async (event) => {
    const snap = event.data;
    if (!snap) return;

    const data = snap.data() || {};
    const victimEmail = event.params.userId;

    // Cancel ONLY for the exact people who were alerted / were helping.
    const recipients = Array.from(new Set([
        ...(data.notifiedUsers || []),
        ...(data.activeHelpers || []),
    ])).filter(email => email && email !== victimEmail);

    if (recipients.length === 0) return;

    try {
        const db = admin.firestore();
        const docs = await db.getAll(...recipients.map(email => db.collection('users').doc(email)));
        const tokens = [];
        docs.forEach(d => {
            const u = d.data();
            if (u && u.fcmToken) tokens.push(u.fcmToken);
        });

        if (tokens.length > 0) {
            await sendMulticastChunked({
                data: { type: 'CANCEL_SOS', victimEmail: String(victimEmail), sentAt: Date.now().toString() },
                android: { priority: 'high', ttl: 0 },
            }, tokens);
        }
    } catch (error) {
        console.error("Error cancelling SOS sirens:", error);
    }
});

// ===========================================================================
// CALLABLE FUNCTIONS
// ===========================================================================

// --- SECURE GEMINI AI BACKEND WITH FUNCTION CALLING ---
exports.askGemini = onCall({ secrets: [GEMINI_API_KEY] }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'You must be signed in to use the assistant.');
    }
    try {
        const userMessage = (request.data && request.data.userMessage) || "";
        const contextData = (request.data && request.data.contextData) || {};
        if (!userMessage || typeof userMessage !== 'string') {
            throw new HttpsError('invalid-argument', 'userMessage is required.');
        }

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
        const aiTools = [{
            functionDeclarations: [
                { name: "trigger_sos", description: "Triggers the emergency SOS alarm, sends location to family, and starts the secure evidence vault. Use this ONLY if the user says they are in danger, need help, or want to activate SOS." },
                { name: "activate_follow_me", description: "Activates the Safe Journey tracking mode to monitor the user's location. Use this if the user asks to track them, follow them, or says they are traveling alone." },
                { name: "deactivate_follow_me", description: "Stops the tracking mode. Use this if the user says they have reached safely or want to stop tracking." },
            ],
        }];
        const systemPrompt = `You are the RESCUEN AI Safety Assistant — a warm, calm, reliable guide inside the RESCUEN personal-safety app. Answer accurately and briefly. Reply in the SAME language the user writes in (English, Hindi, Hinglish, Bengali, etc.).

WHAT RESCUEN IS:
A community-powered emergency app. When a user triggers SOS, RESCUEN instantly (a) sirens + vibrates, (b) silently SMSes their saved family contacts and police (100) with a live Google Maps location link, (c) broadcasts to every RESCUEN user within a 1 KM radius so nearby people can rush to help, and (d) records tamper-resistant audio evidence to a private, owner-only vault.

HOW TO TRIGGER SOS (tell users all three):
1. Hold the big red SOS button for 2 seconds on the Home screen.
2. Triple-press the volume key (works even from a locked screen).
3. Tell me (the AI) that you are in danger — I trigger it for you.

KEY FEATURES & HOW THEY WORK:
- 1 KM Community Radar: nearby users get a high-priority alert with the victim's live location, distance and ETA, and can tap "I am going to help". Uses geohash proximity.
- Family + Police SMS: up to 5 family numbers + police (100), sent automatically with a live map link.
- Follow-Me (Safe Journey): monitors your journey; if you stay stopped unexpectedly it asks "Are you safe?" and auto-triggers SOS if you don't respond.
- Secure Evidence Vault: audio (and, where available, photos) recorded during SOS, stored privately — only the owner can access it, never other users.
- Emergency helplines: one-tap dial 112 (all-in-one), 1091 (women), 108 (ambulance).
- Fake Call: a decoy incoming call to help you exit an unsafe situation.
- Verified onboarding: Google sign-in + phone OTP; emergency numbers are change-locked for 60 days to prevent tampering.
- Privacy: location and identity are only shared during an active emergency; family numbers are never exposed to anyone.

EXACT IN-APP NAVIGATION (give these precise steps — never guess):
- The app has a bottom bar with 3 tabs: HOME, AI HELP, PROFILE.
- Trigger SOS: HOME tab → hold the big red SOS button for 2 seconds. Or triple-press the volume key. Or tell me.
- Evidence Vault (recordings & photos): PROFILE tab → "Settings & Privacy" → under "PRIVACY & SECURITY" tap "Evidence Vault". First time you set a 4-digit PIN and verify with an OTP; after that you enter your PIN to see ALL your own SOS audio recordings and captured photos. Only you can open it.
- Settings: PROFILE tab → "Settings & Privacy" button.
- Edit emergency contacts: PROFILE tab → "Edit Emergency Contacts" (or Settings → PROFILE → Edit emergency contacts). Numbers can be changed once every 60 days.
- Follow-Me (Safe Journey): HOME tab → "Start Follow-Me" button; toggles are in Settings → "SAFE JOURNEY".
- Emergency helplines (112 / 1091 / 108): AI HELP tab → the coloured helpline buttons.
- Fake Call: AI HELP tab → "Fake Call" button.
- Change language / voice language: Settings → "LANGUAGE & REGION" → "App & voice language".
- Turn siren/vibration/countdown/flash on or off: Settings → "EMERGENCY & SOS".
- Notifications settings: Settings → "NOTIFICATIONS".
- Contact support / report an issue: AI HELP tab → "Report Issue / Contact Support", or Settings → "HELP & ABOUT" → Contact support.
- Logout / Delete account: Settings → "ACCOUNT" (delete has a 30-day grace period).
- Privacy policy / Terms: Settings → "PRIVACY & SECURITY".

BEHAVIOUR RULES:
1. Answer any question about RESCUEN's features, setup, permissions, or general personal-safety tips, clearly and correctly.
2. If the user's message implies they are in danger, scared, being followed, or need help — immediately use the 'trigger_sos' tool.
3. If the user wants to be tracked/monitored while travelling alone, use 'activate_follow_me'; if they say they reached safely, use 'deactivate_follow_me'.
4. When a user asks WHERE something is or HOW to do it (e.g. "where is my evidence?"), give the EXACT navigation steps from the list above — tab by tab. Be precise; never guess a wrong location. Never invent features RESCUEN does not have; if genuinely unsure, say so and point to Settings.
5. NEVER reveal anyone's phone number or family numbers.
6. Context (nearby/last SOS data): ${JSON.stringify(contextData)} — use it only to answer the user's own questions; do not leak other people's private details.`;

        const model = genAI.getGenerativeModel({ model: GEMINI_MODEL, tools: aiTools });
        const chat = model.startChat({
            history: [
                { role: "user", parts: [{ text: systemPrompt }] },
                { role: "model", parts: [{ text: "Understood. I am ready to protect the user." }] },
            ],
        });
        const result = await chat.sendMessage(userMessage);
        const response = result.response;
        const functionCalls = response.functionCalls();

        if (functionCalls && functionCalls.length > 0) {
            return { success: true, isFunctionCall: true, functionName: functionCalls[0].name, text: `Executing AI Command: ${functionCalls[0].name}` };
        }
        return { success: true, isFunctionCall: false, text: response.text() };
    } catch (error) {
        console.error("Gemini Server Error:", error);
        return { success: false, text: "System is experiencing heavy load. Please use manual buttons if in danger." };
    }
});

// --- SECURE EMAIL REPORTING BACKEND ---
exports.sendSupportEmail = onCall({ secrets: [GMAIL_USER, GMAIL_APP_PASSWORD] }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'You must be signed in to contact support.');
    }
    try {
        const supportUser = process.env.GMAIL_USER;
        const supportPass = process.env.GMAIL_APP_PASSWORD;
        const { name, email, phone, message } = request.data || {};
        // Only require the essentials — don't strictly validate the number/email.
        if (!name || !email || !message) {
            return { success: false, error: "Missing fields" };
        }
        if (!supportUser || !supportPass) {
            return { success: false, error: "Email support is not configured yet." };
        }
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: supportUser, pass: supportPass },
        });
        // 1) Deliver the report to the support inbox.
        await transporter.sendMail({
            from: `"RESCUEN App" <${supportUser}>`,
            to: supportUser,
            replyTo: email,
            subject: `New Support Report from ${name}`,
            text: `You have received a new support message from the RESCUEN App.\n\nUSER DETAILS\n------------\nName:  ${name}\nEmail: ${email}\nPhone: ${phone || 'N/A'}\n\nMESSAGE\n-------\n${message}\n`,
        });
        // 2) Send the user a rich, professional auto-acknowledgement that quotes
        //    their own message back and carries the RESCUEN logo (small, inline).
        try {
            const esc = (s) => String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const safeMsg = esc(message).replace(/\r?\n/g, '<br>');
            const html = `
<div style="margin:0;padding:0;background:#f4f7f6;">
  <div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6ebf1;">
    <div style="background:#004aad;padding:18px 24px;text-align:center;">
      <img src="cid:rescuenlogo" width="42" height="42" alt="RESCUEN" style="border-radius:10px;vertical-align:middle;display:inline-block;" />
      <span style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:1px;vertical-align:middle;margin-left:10px;">RESCUEN</span>
    </div>
    <div style="padding:28px 24px;color:#1a2233;">
      <h2 style="margin:0 0 8px;font-size:20px;color:#0a2540;">Hi ${esc(name)}, we've got your message ✅</h2>
      <p style="font-size:14px;line-height:22px;color:#444444;margin:0 0 18px;">
        Thank you for reaching out to <b>RESCUEN Support</b>. Your message has reached our team and we're already looking into it. You can expect a personal reply within <b>1–2 working days</b>.
      </p>
      <div style="background:#f4f7f6;border-left:4px solid #004aad;border-radius:8px;padding:14px 16px;margin:0 0 18px;">
        <p style="font-size:11px;font-weight:bold;color:#8a94a6;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px;">Your message to us</p>
        <p style="font-size:14px;line-height:22px;color:#1a2233;margin:0;">${safeMsg}</p>
      </div>
      <div style="background:#fff5f5;border:1px solid #f5b7b1;border-radius:8px;padding:14px 16px;margin:0 0 20px;">
        <p style="font-size:13px;line-height:20px;color:#c0392b;margin:0;font-weight:bold;">
          ⚠️ If you are in immediate danger, use the SOS button in the RESCUEN app or call your local emergency number right now — please don't wait for this email.
        </p>
      </div>
      <p style="font-size:14px;line-height:22px;color:#444444;margin:0 0 2px;">Stay safe,</p>
      <p style="font-size:14px;line-height:22px;color:#0a2540;margin:0;font-weight:bold;">Team RESCUEN</p>
    </div>
    <div style="background:#0a2540;padding:16px 24px;text-align:center;">
      <p style="font-size:11px;color:#9aa5b1;margin:0 0 4px;">RESCUEN — Women's safety, reimagined.</p>
      <p style="font-size:11px;color:#9aa5b1;margin:0;">This is an automated acknowledgement — just reply to this email to add anything more.</p>
    </div>
  </div>
</div>`;
            await transporter.sendMail({
                from: `"RESCUEN Support" <${supportUser}>`,
                to: email,
                subject: 'We received your message — RESCUEN Support',
                text: `Hi ${name},\n\nThank you for contacting RESCUEN. We've received your message and our team will review it and get back to you within 1–2 working days.\n\nYOUR MESSAGE\n-----------\n${message}\n\n⚠️ If you are in immediate danger, please use the SOS button in the app or call your local emergency number right away — do not wait for this email reply.\n\nStay safe,\nTeam RESCUEN`,
                html,
                attachments: [{
                    filename: 'rescuen-logo.png',
                    path: path.join(__dirname, 'assets', 'logo.png'),
                    cid: 'rescuenlogo',
                }],
            });
        } catch (e) { console.error('Auto-reply failed:', e); /* best-effort */ }
        return { success: true };
    } catch (error) {
        console.error("Email Sending Error:", error);
        return { success: false, error: "Could not send message." };
    }
});

// ===========================================================================
// REST API  (onRequest)  — a secured HTTP surface for reliable programmatic
// access (e.g. wearables, a web dashboard, or retry-driven clients).
//
// Security model:
//  - HTTPS only (Cloud Functions terminates TLS).
//  - Every non-health route requires a valid Firebase ID token
//    (Authorization: Bearer <token>). Optionally a Firebase App Check token
//    (X-Firebase-AppCheck) which is verified when present.
//  - Strict method + path allowlist and input validation.
//  - It only WRITES the emergency doc; the existing trigger owns the broadcast,
//    so there is a single, auditable alert path (no duplicated logic).
// ===========================================================================
function sendJson(res, status, body) {
    res.set('Content-Type', 'application/json');
    res.set('Cache-Control', 'no-store');
    res.status(status).json(body);
}

async function requireAuth(req) {
    const header = req.get('Authorization') || '';
    const match = header.match(/^Bearer (.+)$/);
    if (!match) throw new HttpsError('unauthenticated', 'Missing bearer token.');
    const decoded = await admin.auth().verifyIdToken(match[1]);

    // Verify App Check if a token is supplied (recommended: enforce once enabled).
    const appCheckToken = req.get('X-Firebase-AppCheck');
    if (appCheckToken) {
        try { await admin.appCheck().verifyToken(appCheckToken); }
        catch (e) { throw new HttpsError('unauthenticated', 'Invalid App Check token.'); }
    }
    return decoded;
}

exports.restApi = onRequest({ cors: true }, async (req, res) => {
    try {
        const path = (req.path || '/').replace(/\/+$/, '') || '/';

        if (req.method === 'GET' && (path === '/health' || path === '/')) {
            return sendJson(res, 200, { ok: true, service: 'rescuen', time: Date.now() });
        }

        if (req.method === 'POST' && path === '/v1/sos/trigger') {
            await requireAuth(req);
            const b = req.body || {};
            const email = String(b.email || '').trim();
            const lat = Number(b.latitude), lng = Number(b.longitude);
            if (!email || !Number.isFinite(lat) || !Number.isFinite(lng)) {
                return sendJson(res, 400, { ok: false, error: 'email, latitude, longitude required' });
            }
            const user = {
                name: String(b.name || 'User'),
                email,
                myPhone: String(b.myPhone || ''),
                familyNumbers: Array.isArray(b.familyNumbers) ? b.familyNumbers.slice(0, 5).map(String) : [],
            };
            await admin.firestore().collection('active_emergencies').doc(email).set({
                location: { latitude: lat, longitude: lng },
                l: new admin.firestore.GeoPoint(lat, lng),
                h: String(b.h || ''),
                user,
                source: 'rest',
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                notifiedUsers: [],
                activeHelpers: [],
            }, { merge: true });
            return sendJson(res, 202, { ok: true, message: 'SOS accepted; broadcast in progress.' });
        }

        if (req.method === 'POST' && path === '/v1/sos/cancel') {
            await requireAuth(req);
            const email = String((req.body || {}).email || '').trim();
            if (!email) return sendJson(res, 400, { ok: false, error: 'email required' });
            await admin.firestore().collection('active_emergencies').doc(email).delete();
            return sendJson(res, 200, { ok: true, message: 'SOS cancelled.' });
        }

        return sendJson(res, 404, { ok: false, error: 'Not found' });
    } catch (err) {
        const code = err && err.code === 'unauthenticated' ? 401 : 500;
        return sendJson(res, code, { ok: false, error: code === 401 ? 'Unauthorized' : 'Internal error' });
    }
});
