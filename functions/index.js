const { onDocumentCreated, onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { onCall } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const nodemailer = require('nodemailer'); // 🔥 NAYA EMAIL ENGINE IMPORT KIYA

admin.initializeApp();

/**
 * 🔥 Distance calculation on server (PRO Standard)
 */
function getDistanceInKm(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; 
}

// 1. JAB SOS DABTA HAI -> BROADCAST TO NEARBY USERS (1KM)
exports.sendEmergencyAlert = onDocumentCreated("active_emergencies/{userId}", async (event) => {
    const snap = event.data;
    if (!snap) return;

    const emergencyData = snap.data();
    const victimName = emergencyData.user.name;
    const victimEmail = event.params.userId;
    const victimPhone = emergencyData.user.myPhone;
    
    const vLat = emergencyData.l.latitude;
    const vLng = emergencyData.l.longitude;
    const victimHash = emergencyData.h;

    try {
        // 🔥 PRO SCALING FIX: Get only users in the same Geohash area
        const prefix = victimHash ? victimHash.substring(0, 4) : "";
        let usersQuery = admin.firestore().collection('users');
        
        if (prefix) {
            usersQuery = usersQuery.orderBy('h').startAt(prefix).endAt(prefix + '\uf8ff');
        }

        const usersSnap = await usersQuery.get();
        const tokens = [];

        usersSnap.forEach(doc => {
            const userDoc = doc.data();
            
            if (userDoc.fcmToken && userDoc.email !== victimEmail && userDoc.lastKnownLocation) {
                const uLat = userDoc.lastKnownLocation.latitude;
                const uLng = userDoc.lastKnownLocation.longitude;
                
                const distance = getDistanceInKm(vLat, vLng, uLat, uLng);
                
                if (distance <= 1.0) {
                    tokens.push(userDoc.fcmToken);
                }
            }
        });

        if (tokens.length > 0) {
            const mapLink = `http://maps.google.com/?q=$$${vLat},${vLng}`;
            
            const message = {
                data: { 
                    type: 'SOS_ALERT', 
                    victimEmail: String(victimEmail),
                    victimName: String(victimName),
                    victimPhone: String(victimPhone),
                    mapLink: String(mapLink),
                    sentAt: Date.now().toString() 
                },
                android: {
                    priority: 'high', 
                    ttl: 0 
                },
                apns: {
                    headers: { 'apns-priority': '10' },
                    payload: { aps: { 'content-available': 1 } }
                },
                tokens: tokens
            };
            
            await admin.messaging().sendEachForMulticast(message);
            console.log(`SOS Alert sent successfully to ${tokens.length} devices.`);
        }
    } catch (error) {
        console.error("SOS Broadcast Error:", error);
    }
});

// 2. JAB SOS DEACTIVATE HOTA HAI -> STOP SIREN
exports.cancelEmergencyAlert = onDocumentDeleted("active_emergencies/{userId}", async (event) => {
    const victimEmail = event.params.userId;
    
    try {
        const usersSnap = await admin.firestore().collection('users').get();
        const tokens = [];
        
        usersSnap.forEach(doc => {
            const userDoc = doc.data();
            if (userDoc.fcmToken && userDoc.email !== victimEmail) {
                tokens.push(userDoc.fcmToken);
            }
        });

        if (tokens.length > 0) {
            const message = {
                data: { 
                    type: 'CANCEL_SOS', 
                    victimEmail: String(victimEmail),
                    sentAt: Date.now().toString()
                },
                android: { priority: 'high', ttl: 0 },
                tokens: tokens
            };
            await admin.messaging().sendEachForMulticast(message);
        }
    } catch (error) {
        console.error("Error cancelling SOS sirens:", error);
    }
});

// --- 🤖 SECURE GEMINI AI BACKEND WITH FUNCTION CALLING ---
const GEMINI_API_KEY = "AIzaSyAEoeUqHOnHPfgnFnca5x0hoeR805_osds"; // Tera api key
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

exports.askGemini = onCall(async (request) => {
    try {
        const userMessage = request.data.userMessage;
        const contextData = request.data.contextData;

        // 🔥 THE PURE AI TOOLS (FUNCTION DECLARATIONS)
        const aiTools = [{
            functionDeclarations: [
                {
                    name: "trigger_sos",
                    description: "Triggers the emergency SOS alarm, sends location to family, and starts the secure evidence vault. Use this ONLY if the user says they are in danger, need help, or want to activate SOS."
                },
                {
                    name: "activate_follow_me",
                    description: "Activates the Safe Journey tracking mode to monitor the user's location. Use this if the user asks to track them, follow them, or says they are traveling alone."
                },
                {
                    name: "deactivate_follow_me",
                    description: "Stops the tracking mode. Use this if the user says they have reached safely or want to stop tracking."
                }
            ]
        }];

        const systemPrompt = `You are RESCUEN AI Security Manager. 
        RULES:
        1. YOU MUST ANSWER questions about RESCUEN app features, emergency SOS, app security, and the 1KM radar.
        2. If the user's message implies they are in danger, immediately use the 'trigger_sos' tool.
        3. If the user wants to be monitored during a journey, use the 'activate_follow_me' tool.
        4. SOS Data Context: ${JSON.stringify(contextData)}. Provide nearest available active SOS details if asked. NEVER reveal family numbers.`;

        // Tool pass kar rahe hain AI ko
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash",
            tools: aiTools 
        });

        const chat = model.startChat({
            history: [
                { role: "user", parts: [{ text: systemPrompt }] },
                { role: "model", parts: [{ text: "Understood. I am ready to protect the user." }] }
            ]
        });

        const result = await chat.sendMessage(userMessage);
        const response = result.response;

        // Check if AI decided to call a function
        const functionCalls = response.functionCalls();
        
        if (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0];
            return { 
                success: true, 
                isFunctionCall: true, 
                functionName: call.name, // Yeh direct app ko command dega!
                text: `Executing AI Command: ${call.name}` 
            };
        } else {
            // Normal chat response
            return { success: true, isFunctionCall: false, text: response.text() };
        }
    } catch (error) {
        console.error("Gemini Server Error:", error);
        return { success: false, text: "System is experiencing heavy load. Please use manual buttons if in danger." };
    }
});

// --- 📧 PHASE 4.5: SECURE EMAIL REPORTING BACKEND ---

// 🔥 YAHAN APNA EMAIL AUR GMAIL APP PASSWORD DALNA HAI 🔥
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'rescuensupport@gmail.com',
        pass: 'pluh eftu wvxe xdmo' 
    }
});

exports.sendSupportEmail = onCall(async (request) => {
    try {
        const { name, email, phone, message } = request.data;

        // Backend security check
        if (!name || !email || !phone || !message) {
            return { success: false, error: "Missing fields" };
        }

        const mailOptions = {
            from: '"RESCUEN App" <rescuensupport@gmail.com>',
            to: 'rescuensupport@gmail.com', 
            replyTo: email, // Agar tu email ka direct reply kare, toh user ko jaye
            subject: `🚨 New Support Report from ${name}`,
            text: `
You have received a new support message from the RESCUEN App.

📋 USER DETAILS:
----------------
Name: ${name}
Email: ${email}
Phone: ${phone}

📝 MESSAGE:
-----------
${message}
            `
        };

        await transporter.sendMail(mailOptions);
        return { success: true };
    } catch (error) {
        console.error("Email Sending Error:", error);
        return { success: false, error: error.message };
    }
});