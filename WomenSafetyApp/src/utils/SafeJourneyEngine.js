import notifee, { AndroidImportance, AndroidColor, EventType } from '@notifee/react-native';
import { DeviceEventEmitter, Vibration } from 'react-native';
import Sound from 'react-native-sound';

class SafeJourneyEngine {
  static isTracking = false;
  static stationaryStartTime = null;
  static isWarningActive = false;
  static warningTimer = null;
  static warningSiren = null;

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
        // 5 Minutes = 300,000 ms (Abhi testing ke liye hum ise 30 seconds = 30000ms rakh sakte hain)
        const THRESHOLD_TIME = 5 * 60 * 1000; 

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
    this.isWarningActive = true;
    
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

    // Custom Alarm for Warning
    try {
      this.warningSiren = new Sound('siren.mp3', Sound.MAIN_BUNDLE, (error) => {
        if (!error) {
          this.warningSiren.setVolume(0.5); // Thodi kam aawaz taaki ghabrahat na ho
          this.warningSiren.setNumberOfLoops(3);
          this.warningSiren.play();
        }
      });
      Vibration.vibrate([500, 500, 500], true);
    } catch(e) {}

    // 30 Second Countdown for Auto-SOS
    this.warningTimer = setTimeout(() => {
      if (this.isWarningActive) {
        console.log("No response from user! Triggering Auto-SOS!");
        this.stopWarningAlarm();
        // Yeh line tere App.tsx ke hardware button wale function ko automatically chala degi!
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
    if (this.warningSiren) {
      try { this.warningSiren.stop(); this.warningSiren.release(); } catch(e){}
      this.warningSiren = null;
    }
    try { Vibration.cancel(); } catch(e){}
  }
}

export default SafeJourneyEngine;