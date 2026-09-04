import notifee, { TriggerType, RepeatFrequency, AndroidImportance } from '@notifee/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';

class NotificationManager {
  // Channel create karna zaroori hai Android ke liye
  static async createChannel() {
    await notifee.createChannel({
      id: 'rescuen_alerts',
      name: 'RESCUEN Safety Alerts',
      importance: AndroidImportance.HIGH,
    });
  }

  // 1. Daily 6:00 AM Safety Quote
  static async scheduleDailyMorningAlert() {
    await this.createChannel();

    // Aaj raat ya kal subha 6 baje ka time nikalna
    const date = new Date();
    date.setHours(6, 0, 0, 0);

    // Agar aaj subha 6 baj chuke hain, toh kal subha 6 baje ka set karo
    if (date.getTime() < Date.now()) {
      date.setDate(date.getDate() + 1);
    }

    const trigger = {
      type: TriggerType.TIMESTAMP,
      timestamp: date.getTime(),
      repeatFrequency: RepeatFrequency.DAILY, // Har roz repeat hoga
    };

    // Alag-alag quotes dene ke liye hum array use kar sakte hain
    const quotes = [
      "Your safety is our priority. Have a fearless and productive day! 🛡️",
      "Stay alert, stay safe. RESCUEN is guarding you. 💪",
      "A new day brings new opportunities. Walk with confidence! ✨"
    ];
    const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];

    await notifee.createTriggerNotification(
      {
        id: 'daily_6am_alert',
        title: 'Good Morning from RESCUEN 🇮🇳',
        body: randomQuote,
        android: {
          channelId: 'rescuen_alerts',
          smallIcon: 'ic_launcher', // Tera app icon
          pressAction: {
            id: 'default',
          },
        },
      },
      trigger,
    );
    console.log("Premium: Daily 6 AM Alert Scheduled!");
  }

  // 2. Exact 7-Day Play Store Review Alert (Sirf Ek Baar)
  static async scheduleReviewPush() {
    // Check karo ki kya humne already schedule kar diya hai?
    const isScheduled = await AsyncStorage.getItem('isReviewScheduled');
    if (isScheduled === 'true') {
      return; // Agar ho chuka hai, toh dobara nahi karna
    }

    await this.createChannel();

    // Aaj se theek 7 din (Days * Hours * Minutes * Seconds * Milliseconds)
    const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
    const triggerDate = Date.now() + sevenDaysInMs;

    const trigger = {
      type: TriggerType.TIMESTAMP,
      timestamp: triggerDate,
    };

    await notifee.createTriggerNotification(
      {
        id: 'playstore_review_alert',
        title: 'Help us make India safer! 🇮🇳',
        body: 'Tap here to rate RESCUEN 5-stars on Play Store and support the mission.',
        data: { type: 'review' }, // Is data se hum action handle karenge
        android: {
          channelId: 'rescuen_alerts',
          smallIcon: 'ic_launcher',
          pressAction: {
            id: 'default',
          },
        },
      },
      trigger,
    );

    // Save kar do taaki baar-baar trigger na ho
    await AsyncStorage.setItem('isReviewScheduled', 'true');
    console.log("Premium: 7-Day Review Alert Scheduled!");
  }

  // 3. Notification pe click karne ka action (Direct Play Store)
  static setupNotificationListeners() {
    notifee.onBackgroundEvent(async ({ type, detail }) => {
      if (type === notifee.EventType.PRESS && detail.notification.data?.type === 'review') {
        Linking.openURL('https://play.google.com/store/apps/details?id=com.officialrescuen.app');
      }
    });

    notifee.onForegroundEvent(({ type, detail }) => {
      if (type === notifee.EventType.PRESS && detail.notification.data?.type === 'review') {
        Linking.openURL('https://play.google.com/store/apps/details?id=com.officialrescuen.app');
      }
    });
  }
}

export default NotificationManager;