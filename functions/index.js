const { onDocumentCreated, onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const nodemailer = require('nodemailer');

admin.initializeApp();

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
exports.sendEmergencyAlert = onDocumentCreated("active_emergencies/{userId}", async (event) => {
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
            await logDelivery(victimEmail, { channel: 'fcm_nearby', attempted: tokens.length, delivered: sent });
        }

        // --- (b) Reliable server-side SMS backup to family + police.
        // Family numbers are private and intentionally NOT in the broadcast doc;
        // read them from the owner's user doc via the Admin SDK.
        const victimSnap = await db.collection('users').doc(victimEmail).get();
        const familyNumbers = victimSnap.exists && Array.isArray(victimSnap.data().familyNumbers)
            ? victimSnap.data().familyNumbers : [];
        const smsBody = `URGENT EMERGENCY: ${victimName} is in danger. Live location: ${mapLink}`;
        const smsTargets = [...familyNumbers.filter(n => n && String(n).length === 10), '100'];
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
        const systemPrompt = `You are RESCUEN AI Security Manager.
        RULES:
        1. YOU MUST ANSWER questions about RESCUEN app features, emergency SOS, app security, and the 1KM radar.
        2. If the user's message implies they are in danger, immediately use the 'trigger_sos' tool.
        3. If the user wants to be monitored during a journey, use the 'activate_follow_me' tool.
        4. SOS Data Context: ${JSON.stringify(contextData)}. Provide nearest available active SOS details if asked. NEVER reveal family numbers.`;

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", tools: aiTools });
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
        const { name, email, phone, message } = request.data || {};
        if (!name || !email || !phone || !message) {
            return { success: false, error: "Missing fields" };
        }
        const supportUser = GMAIL_USER.value();
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: supportUser, pass: GMAIL_APP_PASSWORD.value() },
        });
        await transporter.sendMail({
            from: `"RESCUEN App" <${supportUser}>`,
            to: supportUser,
            replyTo: email,
            subject: `New Support Report from ${name}`,
            text: `You have received a new support message from the RESCUEN App.\n\nUSER DETAILS\n------------\nName:  ${name}\nEmail: ${email}\nPhone: ${phone}\n\nMESSAGE\n-------\n${message}\n`,
        });
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
