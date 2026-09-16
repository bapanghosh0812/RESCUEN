import notifee, { AndroidImportance, AndroidColor, EventType } from '@notifee/react-native';
import { DeviceEventEmitter, Vibration } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Sound from 'react-native-sound';
import Tts from 'react-native-tts';
import { t, getLang } from './i18n';

class SafeJourneyEngine {
  static isTracking = false;
  static stationaryStartTime = null;
  static isWarningActive = false;
  static warningTimer = null;
  static warningSiren = null;
  static voiceInterval = null;
  static finalVoiceTimer = null;

  // Read the user's language, first name, and whether voice alerts are enabled.
  static async getVoiceCtx() {
    let lang = 'en', name = 'friend', voiceOn = true;
    try { lang = (await AsyncStorage.getItem('user_language')) || 'en'; } catch (e) {}
    try { const s = await AsyncStorage.getItem('userSession'); if (s) { const n = (JSON.parse(s).name || '').trim().split(' ')[0]; if (n) name = n; } } catch (e) {}
    try { const s = await AsyncStorage.getItem('app_settings'); if (s) { const v = JSON.parse(s).followMeVoice; if (v === false) voiceOn = false; } } catch (e) {}
    return { lang, name, voiceOn };
  }
  static speak(text, lang) {
    try { Tts.stop(); Tts.setDefaultLanguage(getLang(lang).tts); } catch (e) {}
    try { Tts.setDefaultRate(0.5); } catch (e) {}
    try { Tts.speak(text); } catch (e) {}
  }

  // 1. Follow Me Mode Start Karna
  static async startTracking() {
    this.isTracking = true;
    this.stationaryStartTime = null;
    this.isWarningActive = false;
    
    // Background Service Zinda Rakhne Ke Liye Notification
    const channelId = await notifee.createChannel({
      id: 'safe_journey_channel',
      name: 'Safe Journey Tracking',
      importance: AndroidImportance.LOW, // Low taaki bar bar sound na kare
    });

    await notifee.displayNotification({
      id: 'follow_me_active',
      title: '🛡️ Follow Me Mode Active',
      body: 'RESCUEN is guarding your journey securely.',
      android: {
        channelId,
        asForegroundService: true,
        ongoing: true,
        color: AndroidColor.BLUE,
        pressAction: { id: 'default' },
      },
    });

    console.log("Premium: Follow Me Engine Started!");
  }

  // 2. Stop Tracking
  static async stopTracking() {
    this.isTracking = false;
    this.stationaryStartTime = null;
    this.stopWarningAlarm();
    
    try {
      await notifee.stopForegroundService();
      await notifee.cancel('follow_me_active');
    } catch(e) {}
    console.log("Premium: Follow Me Engine Stopped!");
  }

  // 3. Location & Speed Analyze Karna (App.tsx isko data dega)
  static processLocation(speed, latitude, longitude) {
    if (!this.isTracking || this.isWarningActive) return;

    const speedKmph = speed ? (speed * 3.6) : 0;

    if (speedKmph < 2) { // Agar speed 2 km/h se kam hai (stationary)
      if (!this.stationaryStartTime) {
        this.stationaryStartTime = Date.now();
      } else {
        const timePassedMs = Date.now() - this.stationaryStartTime;
        // 3 minutes stationary (no movement) before the "Are you safe?" check.
        const THRESHOLD_TIME = 3 * 60 * 1000;

        if (timePassedMs >= THRESHOLD_TIME) {
          this.triggerAreYouSafeWarning();
        }
      }
    } else {
      // Agar victim move karne laga, toh timer reset kar do
      this.stationaryStartTime = null;
    }
  }

  // 4. "Are You Safe?" Full-Screen Lock Wake-up
  static async triggerAreYouSafeWarning() {
    if (this.isWarningActive) return; // already prompting — don't double-trigger
    this.isWarningActive = true;
    // Tell the app to show an in-app "Are you safe?" prompt so the user always
    // has a way to cancel before the 30s auto-SOS (prevents false alarms).
    try { DeviceEventEmitter.emit('ShowSafeCheck'); } catch (e) {}

    const channelId = await notifee.createChannel({
      id: 'are_you_safe_alert',
      name: 'Are You Safe Alerts',
      importance: AndroidImportance.HIGH,
      sound: 'default',
      vibration: true,
      vibrationPattern: [500, 500, 500, 500],
    });

    // Wakes up locked screen
    await notifee.displayNotification({
      id: 'safe_warning_popup',
      title: '⚠️ ARE YOU SAFE?',
      body: 'You have been stopped for a while. Tap to dismiss or SOS will trigger in 30s!',
      data: { type: 'safe_warning' },
      android: {
        channelId,
        color: AndroidColor.RED,
        importance: AndroidImportance.HIGH,
        fullScreenAction: { id: 'default' }, // THE MAGIC WAKE UP
        pressAction: { id: 'dismiss_warning' }, // Agar user touch kare toh dismiss ho
      },
    });

    // Custom Alarm for Warning (siren kept low so the AI voice is clearly heard)
    try {
      this.warningSiren = new Sound('siren.mp3', Sound.MAIN_BUNDLE, (error) => {
        if (!error) {
          this.warningSiren.setVolume(0.35);
          this.warningSiren.setNumberOfLoops(3);
          this.warningSiren.play();
        }
      });
      Vibration.vibrate([500, 500, 500], true);
    } catch(e) {}

    // 🔊 AI VOICE: repeat "Are you safe?" every 3 seconds in the user's language.
    const { lang, name, voiceOn } = await this.getVoiceCtx();
    if (voiceOn) {
      const sayCheck = () => this.speak(t(lang, 'areYouSafe'), lang);
      sayCheck();
      this.voiceInterval = setInterval(() => { if (this.isWarningActive) sayCheck(); }, 3000);
    }

    // At 27s (last 3 seconds): stop asking and announce, by name, that SOS is being activated.
    this.finalVoiceTimer = setTimeout(() => {
      if (this.isWarningActive) {
        if (this.voiceInterval) { clearInterval(this.voiceInterval); this.voiceInterval = null; }
        if (voiceOn) this.speak(t(lang, 'autoSos', { name }), lang);
      }
    }, 27000);

    // At 30s: no response → activate SOS (let the spoken warning keep playing).
    this.warningTimer = setTimeout(() => {
      if (this.isWarningActive) {
        console.log("No response from user! Triggering Auto-SOS!");
        if (this.voiceInterval) { clearInterval(this.voiceInterval); this.voiceInterval = null; }
        if (this.warningSiren) { try { this.warningSiren.stop(); this.warningSiren.release(); } catch (e) {} this.warningSiren = null; }
        try { Vibration.cancel(); } catch (e) {}
        DeviceEventEmitter.emit('TriggerRescueSOS', { source: 'FollowMe' });
      }
    }, 30000); // 30 seconds
  }

  // 5. User Ne Bola "I Am Safe"
  static async dismissWarning() {
    this.isWarningActive = false;
    this.stationaryStartTime = null; // Reset for next stop
    this.stopWarningAlarm();
    try {
      await notifee.cancel('safe_warning_popup');
    } catch(e) {}
  }

  static stopWarningAlarm() {
    if (this.warningTimer) clearTimeout(this.warningTimer);
    if (this.finalVoiceTimer) { clearTimeout(this.finalVoiceTimer); this.finalVoiceTimer = null; }
    if (this.voiceInterval) { clearInterval(this.voiceInterval); this.voiceInterval = null; }
    try { Tts.stop(); } catch (e) {}
    if (this.warningSiren) {
      try { this.warningSiren.stop(); this.warningSiren.release(); } catch(e){}
      this.warningSiren = null;
    }
    try { Vibration.cancel(); } catch(e){}
  }
}

export default SafeJourneyEngine;