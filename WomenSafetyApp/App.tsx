import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, StatusBar, Image, ScrollView, TextInput, Vibration, Modal, ActivityIndicator, PermissionsAndroid, Linking, LogBox, Platform, NativeModules, Dimensions, Animated, AppState, DeviceEventEmitter, Switch, TouchableWithoutFeedback } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Geolocation from 'react-native-geolocation-service';
import Sound from 'react-native-sound';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import functions from '@react-native-firebase/functions';
import storage from '@react-native-firebase/storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import MapView, { Marker, Circle, Polyline, PROVIDER_GOOGLE } from 'react-native-maps'; 
import { getDistance } from 'geolib'; 
import messaging from '@react-native-firebase/messaging';
import Pdf from 'react-native-pdf';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import notifee, { AndroidImportance, AndroidColor, EventType } from '@notifee/react-native';

// 🔥 TERE NAYE FOLAADI ENGINES IMPORT KIYE HAIN
import RescuenBrain from './src/utils/RescuenBrain';
import SecureVaultManager from './src/utils/SecureVaultManager';
import SafeJourneyEngine from './src/utils/SafeJourneyEngine';
import NotificationManager from './src/utils/NotificationManager';
import EvidenceCamera from './src/utils/EvidenceCamera';
import { LANGS, getLang } from './src/utils/i18n';
import { launchImageLibrary } from 'react-native-image-picker';

const DirectSms = NativeModules.DirectSms;

LogBox.ignoreAllLogs(true);

try {
  Sound.setCategory('Playback', true); 
} catch(e) {
  console.log(e);
}

let globalBgSiren = null; 
let resolveForegroundTask = null;

const isStaleAlert = (timestampStr) => {
  if (!timestampStr) return false;
  const sentTime = parseInt(timestampStr, 10);
  const fiveMinutes = 5 * 60 * 1000;
  return (Date.now() - sentTime) > fiveMinutes;
};

const encodeGeohash = (latitude, longitude, precision = 9) => {
  const B32 = "0123456789bcdefghjkmnpqrstuvwxyz";
  let lat = [-90.0, 90.0], lon = [-180.0, 180.0];
  let hash = "", bit = 0, ch = 0, even = true;
  while (hash.length < precision) {
    let mid = even ? (lon[0] + lon[1]) / 2 : (lat[0] + lat[1]) / 2;
    if (even) {
      if (longitude > mid) { ch |= 1 << (4 - bit); lon[0] = mid; } else { lon[1] = mid; }
    } else {
      if (latitude > mid) { ch |= 1 << (4 - bit); lat[0] = mid; } else { lat[1] = mid; }
    }
    even = !even;
    if (bit < 4) { bit++; } else { hash += B32[ch]; bit = 0; ch = 0; }
  }
  return hash;
};

// Only these fields are safe to broadcast into `active_emergencies`, which
// nearby users can read. NEVER include familyNumbers, familyNum, fcmToken or
// lastNumberUpdate — those are private and must stay in the owner's user doc.
const sanitizeUserForBroadcast = (u = {}) => ({
  name: u.name || '',
  email: u.email || '',
  myPhone: u.myPhone || '',
  gender: u.gender || '',
});

const formatCallTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

// Wellness hub — opens fresh, real content on YouTube (never stale).
const WELLNESS = [
  { icon: '🛡️', title: 'Women Safety Tips', desc: 'Stay-safe guides & real situations', q: 'women safety tips and self awareness' },
  { icon: '🥋', title: 'Self-Defense', desc: 'Practical moves anyone can learn', q: 'self defense techniques for women beginners' },
  { icon: '🧘‍♀️', title: 'Yoga & Meditation', desc: 'Calm the mind, build strength', q: 'yoga for beginners daily practice' },
  { icon: '🏃‍♀️', title: 'Exercise & Fitness', desc: 'Home workouts, no equipment', q: 'home workout no equipment beginners' },
  { icon: '🥗', title: 'Healthy Living Tips', desc: 'Nutrition, sleep & wellbeing', q: 'healthy lifestyle tips daily routine' },
  { icon: '📚', title: 'Books & Learning', desc: 'Growth, confidence & safety', q: 'best self help and confidence books summary' },
  { icon: '🧠', title: 'Mental Health', desc: 'Stress, anxiety & self-care', q: 'mental health self care tips' },
  { icon: '🚨', title: 'Emergency Preparedness', desc: 'Be ready for anything', q: 'personal emergency preparedness tips' },
];

// Pretty date+time for evidence items, e.g. "16 Sep 2026, 11:40 AM".
const EVIDENCE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtEvidenceTime = (ts) => {
  if (!ts) return 'Unknown time';
  try {
    const d = new Date(ts);
    let h = d.getHours(); const ampm = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${d.getDate()} ${EVIDENCE_MONTHS[d.getMonth()]} ${d.getFullYear()}, ${h}:${mm} ${ampm}`;
  } catch (e) { return 'Unknown time'; }
};
// Classify an evidence item from its type string into display metadata.
const evidenceMeta = (typeStr = '') => {
  const t = String(typeStr).toLowerCase();
  if (t.includes('video')) return { icon: '🎬', label: 'Video + Audio', color: '#8e44ad', cam: t.includes('front') ? 'Front camera' : t.includes('back') ? 'Rear camera' : null };
  if (t.includes('audio')) return { icon: '🎙️', label: 'Audio recording', color: '#2980b9', cam: null };
  if (t.includes('capture') || t.includes('photo')) return { icon: '📷', label: 'Captured photo', color: '#16a085', cam: null };
  return { icon: '📄', label: 'Evidence file', color: '#7f8c8d', cam: null };
};

try {
  notifee.registerForegroundService((notification) => {
    return new Promise((resolve) => {
      resolveForegroundTask = resolve;
    });
  });
} catch(e) {}

notifee.onBackgroundEvent(async ({ type, detail }) => {
  if (type === EventType.DISMISSED || type === EventType.PRESS) {}
});

messaging().setBackgroundMessageHandler(async remoteMessage => {
  if (remoteMessage.data?.type === 'CANCEL_SOS') {
    if (globalBgSiren) {
      try { globalBgSiren.stop(); globalBgSiren.release(); } catch(e){}
      globalBgSiren = null;
    }
    try { await notifee.cancelAllNotifications(); } catch(e){}
    return; 
  }
  
  if (remoteMessage.data?.type !== 'SOS' && remoteMessage.data?.type !== 'SOS_ALERT') {
    return; 
  }

  if (isStaleAlert(remoteMessage.data?.sentAt)) return;

  if (remoteMessage.data && remoteMessage.data.victimEmail) {
    try {
      await AsyncStorage.setItem('last_sos_received', JSON.stringify({
        body: remoteMessage.notification?.body || 'Emergency Alert!',
        email: remoteMessage.data.victimEmail,
        name: remoteMessage.data.victimName || 'Unknown',
        phone: remoteMessage.data.victimPhone || 'N/A',
        link: remoteMessage.data.mapLink || 'Link not available',
        time: new Date().toLocaleString()
      }));
    } catch(e) {}
  }

  try {
      const channelId = await notifee.createChannel({
          id: 'high_priority_sos',
          name: 'Critical SOS Alerts',
          importance: AndroidImportance.HIGH,
          sound: 'default', 
          vibration: true,
          vibrationPattern: [300, 500, 300, 500],
      });

      await notifee.displayNotification({
          title: `🚨 EMERGENCY: ${remoteMessage.data?.victimName || 'Someone'} needs help!`,
          body: 'Tap here to open RESCUEN and view location.',
          android: {
              channelId,
              color: AndroidColor.RED,
              importance: AndroidImportance.HIGH,
              pressAction: { id: 'default', launchActivity: 'default' },
              fullScreenAction: { id: 'default' }, 
              timeoutAfter: 300000, 
          },
      });
  } catch(e) { console.log(e); }

  if (globalBgSiren) {
    try { globalBgSiren.stop(); globalBgSiren.release(); } catch(e){}
    globalBgSiren = null; 
  }

  try {
    globalBgSiren = new Sound('siren.mp3', Sound.MAIN_BUNDLE, (error) => {
      if (!error) {
        try {
          globalBgSiren.setVolume(1.0);
          globalBgSiren.setNumberOfLoops(10); 
          globalBgSiren.play((success) => {
             if (globalBgSiren) {
               try { globalBgSiren.release(); } catch(e){}
               globalBgSiren = null;
             }
          });
        } catch (playError) {}
      }
    });
  } catch(e){}
});

const CustomAILoader = () => {
  const spinValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spinValue, { toValue: 1, duration: 1200, useNativeDriver: true })
    ).start();
  }, [spinValue]);

  const spin = spinValue.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={{ width: 60, height: 60, justifyContent: 'center', alignItems: 'center' }}>
      <Animated.View style={{
        position: 'absolute', width: 60, height: 60, borderRadius: 30, borderWidth: 3.5,
        borderTopColor: '#004aad', borderRightColor: '#2ecc71', borderBottomColor: '#e74c3c', borderLeftColor: '#f1c40f',
        transform: [{ rotate: spin }]
      }} />
      <Image source={require('./android/app/src/main/res/drawable/ai_icon.png')} style={{ width: 45, height: 45, resizeMode: 'contain' }} />
    </View>
  );
};

// Premium 6-box OTP input: auto-fill (SMS), per-digit 3D bounce, auto-submit.
const OtpInput = ({ value, onChange, onComplete }) => {
  const inputRef = useRef(null);
  const anims = useRef([...Array(6)].map(() => new Animated.Value(1))).current;
  useEffect(() => {
    const idx = value.length - 1;
    if (idx >= 0 && idx < 6) {
      anims[idx].setValue(0.5);
      Animated.spring(anims[idx], { toValue: 1, friction: 4, tension: 140, useNativeDriver: true }).start();
    }
    if (value.length === 6 && onComplete) onComplete(value);
  }, [value]);
  return (
    <View>
      <TouchableWithoutFeedback onPress={() => { try { inputRef.current && inputRef.current.focus(); } catch (e) {} }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
          {[...Array(6)].map((_, i) => {
            const filled = i < value.length;
            const active = i === value.length;
            return (
              <Animated.View key={i} style={[styles.otpBox, filled && styles.otpBoxFilled, active && styles.otpBoxActive, { transform: [{ scale: anims[i] }] }]}>
                <Text style={styles.otpDigit}>{value[i] || ''}</Text>
              </Animated.View>
            );
          })}
        </View>
      </TouchableWithoutFeedback>
      <TextInput ref={inputRef} value={value} onChangeText={(t) => onChange(t.replace(/[^0-9]/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} autoFocus textContentType="oneTimeCode" autoComplete="sms-otp" caretHidden style={{ position: 'absolute', opacity: 0.01, height: 1, width: 1 }} />
    </View>
  );
};

// Success burst: bouncing check + message.
const OtpSuccess = ({ text }) => {
  const scale = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, friction: 4, tension: 90, useNativeDriver: true }).start();
  }, []);
  return (
    <View style={{ alignItems: 'center', paddingVertical: 30 }}>
      <Animated.View style={{ width: 90, height: 90, borderRadius: 45, backgroundColor: '#2ecc71', justifyContent: 'center', alignItems: 'center', transform: [{ scale }] }}>
        <Text style={{ fontSize: 46, color: '#fff' }}>✓</Text>
      </Animated.View>
      <Text style={{ fontSize: 18, fontWeight: '900', color: '#1e7e46', marginTop: 18, textAlign: 'center' }}>{text}</Text>
    </View>
  );
};

const MainApp = () => {
  const insets = useSafeAreaInsets();

  const [currentScreen, setCurrentScreen] = useState('Splash'); 
  const [isLoading, setIsLoading] = useState(false); 
  
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [otpTimer, setOtpTimer] = useState(0);
  
  const [isAgreed, setIsAgreed] = useState(false);
  const [hasScrolledToEnd, setHasScrolledToEnd] = useState(false);
  
  const [user, setUser] = useState({ name: '', email: '', gender: '', familyNumbers: [''], myPhone: '', lastNumberUpdate: 0 });
  const [confirmResult, setConfirmResult] = useState(null); 
  const [otpCode, setOtpCode] = useState('');
  const isVerifyingRef = useRef(false);
  const [isPhoneVerified, setIsPhoneVerified] = useState(false);

  const [currentLocationText, setCurrentLocationText] = useState('🛰️ Locating Safe Server...');
  const [currentCoords, setCurrentCoords] = useState(null); 
  const [isSOSActive, setIsSOSActive] = useState(false);
  const [safeTest, setSafeTest] = useState(false); // "Test SOS (safe)": records evidence, sends NO alerts
  const [isFollowMe, setIsFollowMe] = useState(false);
  const [followMeStationarySec, setFollowMeStationarySec] = useState(0);
  const followMeRefPos = useRef(null);
  const followMeMoveCount = useRef(0); // consecutive seconds of real movement (jitter filter)
  const isSOSActiveRef = useRef(false);
  const [showSafeCheck, setShowSafeCheck] = useState(false);
  const [safeCheckCountdown, setSafeCheckCountdown] = useState(30);
  const [fakeCallState, setFakeCallState] = useState('none'); // 'none' | 'incoming' | 'active'
  const [fakeCallSecs, setFakeCallSecs] = useState(0);

  // --- Premium settings (persisted) ---
  const [settings, setSettings] = useState({
    autoAlertPolice: true, sirenOnSos: true, sosVibration: true, shareLocationFamily: true,
    followMe: false, followMeVoice: true, autoSosNoResponse: true,
    nearbyAlerts: true, dailyTip: true, notifSound: true, notifVibration: true, reviewReminder: true,
    hideLocationWhenSafe: false, videoEvidence: true,
    darkMode: false, reduceMotion: false,
  });
  const settingsRef = useRef(settings);
  // Dark mode: rebuild the entire stylesheet from the palette when toggled, so
  // every `styles.X` reference re-themes instantly with no per-screen changes.
  const dark = !!settings.darkMode;
  const styles = useMemo(() => makeStyles(dark), [dark]);
  const updateSetting = (key, value) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      AsyncStorage.setItem('app_settings', JSON.stringify(next)).catch(() => {});
      return next;
    });
  };
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => {
    AsyncStorage.getItem('app_settings').then(s => { if (s) { try { setSettings(prev => ({ ...prev, ...JSON.parse(s) })); } catch (e) {} } }).catch(() => {});
  }, []);

  // --- Evidence Vault (PIN-locked, owner-only) ---
  const [vaultStep, setVaultStep] = useState('loading'); // loading|setPin|confirmPin|otp|enterPin|unlocked
  const [vaultPin, setVaultPin] = useState('');
  const [vaultPinFirst, setVaultPinFirst] = useState('');
  const [vaultOtp, setVaultOtp] = useState('');
  const [vaultConfirm, setVaultConfirm] = useState(null);
  const [vaultError, setVaultError] = useState('');
  const [vaultOtpSuccess, setVaultOtpSuccess] = useState(false);
  const [vaultItems, setVaultItems] = useState([]);
  const [vaultLoading, setVaultLoading] = useState(false);

  // --- Language ---
  const [userLang, setUserLang] = useState('en');
  const [showLangModal, setShowLangModal] = useState(false);
  const updateLang = (code) => { setUserLang(code); AsyncStorage.setItem('user_language', code).catch(() => {}); setShowLangModal(false); };
  useEffect(() => { AsyncStorage.getItem('user_language').then(l => { if (l) setUserLang(l); }).catch(() => {}); }, []);
  
  const [queryPrefix, setQueryPrefix] = useState(null);
  const [rawEmergencies, setRawEmergencies] = useState([]);
  
  const [nearbyEmergency, setNearbyEmergency] = useState(null);
  const [nearbyEmergenciesList, setNearbyEmergenciesList] = useState([]); 
  const [showHeroModal, setShowHeroModal] = useState(false);

  const [victimMapHelpers, setVictimMapHelpers] = useState([]); 
  
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteInputText, setDeleteInputText] = useState('');
  const [deletedAccountMsg, setDeletedAccountMsg] = useState(null); 

  const [showEditModal, setShowEditModal] = useState(false);
  const [editData, setEditData] = useState({ myPhone: '', familyNumbers: [''] });
  const [editOtpStep, setEditOtpStep] = useState('form'); // 'form' | 'otp'
  const [editOtp, setEditOtp] = useState('');
  const [editConfirm, setEditConfirm] = useState(null);
  const [editError, setEditError] = useState('');

  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState([
    { sender: 'ai', text: 'Hello! I am RESCUEN AI Security Manager. How can I assist you today?' }
  ]);
  const [isAITyping, setIsAITyping] = useState(false);
  const [showAIChips, setShowAIChips] = useState(true); 
  const chatScrollRef = useRef(null);

  // 🔥 NEW REPORT FORM STATES
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportData, setReportData] = useState({ name: '', email: '', phone: '', message: '' });
  const [isSendingReport, setIsSendingReport] = useState(false);

  const sirenSound = useRef(null);
  const mapRef = useRef(null);
  const lastCoordsRef = useRef(null); // freshest known location, for SOS fallback
  const [ignoredEmergencies, setIgnoredEmergencies] = useState([]);

  const [isHelperRegistered, setIsHelperRegistered] = useState(false);
  const [isAcknowledged, setIsAcknowledged] = useState(false);

  const [broadcastMetrics, setBroadcastMetrics] = useState({ totalNotified: 0, helpers: 0 });
  const [hasAllTheTimePermission, setHasAllTheTimePermission] = useState(false);
  
  const isTriggering = useRef(false);
  const actionLock = useRef(false);

  const [loginPhaseIdx, setLoginPhaseIdx] = useState(0);
  const [displayedText, setDisplayedText] = useState('');
  const dotAnimY = useRef(new Animated.Value(0)).current;
  const sosPulse = useRef(new Animated.Value(0)).current; // radar-ping ring behind SOS

  const loginPhrases = [
    { text: "Let's create", bg: "#e6f4ea", dot: "#34a853", txtColor: "#000" },
    { text: "Let's brainstorm", bg: "#e8f0fe", dot: "#4285f4", txtColor: "#000" },
    { text: "Let's collaborate", bg: "#fce8e6", dot: "#ea4335", txtColor: "#000" },
    { text: "RESCUEN", bg: "#1a1a2e", dot: "#00d2ff", txtColor: "#fff" }, 
    { text: "Let's explore", bg: "#fef7e0", dot: "#fbbc05", txtColor: "#000" },
    { text: "Let's protect", bg: "#f3e8ff", dot: "#9b59b6", txtColor: "#000" },
    { text: "Let's unite", bg: "#e0f2f1", dot: "#009688", txtColor: "#000" },
    { text: "RESCUEN", bg: "#004aad", dot: "#ffffff", txtColor: "#fff" } 
  ];

  useEffect(() => {
    let interval;
    if (otpTimer > 0) interval = setInterval(() => setOtpTimer(t => t - 1), 1000);
    return () => clearInterval(interval);
  }, [otpTimer]);

  useEffect(() => {
    let typingInterval;
    let waitTimeout;

    if (currentScreen === 'Login') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(dotAnimY, { toValue: -8, duration: 400, useNativeDriver: true }),
          Animated.timing(dotAnimY, { toValue: 0, duration: 400, useNativeDriver: true })
        ])
      ).start();

      const currentFullText = loginPhrases[loginPhaseIdx].text;
      let charIndex = 0;
      setDisplayedText('');

      typingInterval = setInterval(() => {
        if (charIndex < currentFullText.length) {
          setDisplayedText(currentFullText.substring(0, charIndex + 1));
          charIndex++;
        } else {
          clearInterval(typingInterval);
          waitTimeout = setTimeout(() => {
            setLoginPhaseIdx((prev) => (prev + 1) % loginPhrases.length);
          }, 1500); 
        }
      }, 70); 
    }

    return () => { 
      if (typingInterval) clearInterval(typingInterval); 
      if (waitTimeout) clearTimeout(waitTimeout);
      dotAnimY.stopAnimation();
    };
  }, [loginPhaseIdx, currentScreen]);

  const pdfSource = { uri: 'bundle-assets://rescuen1.pdf', cache: true };

  const renderChatText = (text) => {
    const regex = /(https?:\/\/[^\s]+|[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/g;
    const parts = text.split(regex);
    return parts.map((part, index) => {
      if (!part) return null;
      if (part.match(/^https?:\/\//)) {
        return (
          <Text key={index} style={{color: '#3498db', textDecorationLine: 'underline', fontWeight: 'bold'}} onPress={() => Linking.openURL(part)}>
            {part}
          </Text>
        );
      } else if (part.match(/^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+$/)) {
        return (
          <Text key={index} style={{color: '#e74c3c', textDecorationLine: 'underline', fontWeight: 'bold'}} onPress={() => Linking.openURL(`mailto:${part}`)}>
            {part}
          </Text>
        );
      }
      return <Text key={index}>{part}</Text>;
    });
  };

  const requestEssentialPermissions = async (userEmail) => {
    try {
      if (Platform.OS === 'android') {
        if (Platform.Version >= 33) {
          await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
        }
        await PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.SEND_SMS,
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
            PermissionsAndroid.PERMISSIONS.CAMERA
        ]);
      }
      const authStatus = await messaging().requestPermission();
      const enabled = authStatus === messaging.AuthorizationStatus.AUTHORIZED || authStatus === messaging.AuthorizationStatus.PROVISIONAL;

      if (enabled && userEmail) {
        const token = await messaging().getToken();
        await firestore().collection('users').doc(userEmail).update({ fcmToken: token }).catch(()=>{});
      }
    } catch (error) {}
  };

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('TriggerRescueSOS', (eventData) => {
        // Respect the "Auto-SOS if no response" setting for Follow-Me triggers.
        if (eventData?.source === 'FollowMe' && !settingsRef.current.autoSosNoResponse) return;
        triggerSOS();
    });
    return () => subscription.remove();
  }, [currentCoords, user]);

  // Follow-Me "Are you safe?" in-app prompt so the auto-SOS can always be cancelled.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('ShowSafeCheck', () => setShowSafeCheck(true));
    return () => sub.remove();
  }, []);

  useEffect(() => { if (isSOSActive) setShowSafeCheck(false); }, [isSOSActive]);

  // Visible countdown while the "Are you safe?" prompt is showing.
  useEffect(() => {
    let iv;
    if (showSafeCheck) {
      setSafeCheckCountdown(30);
      iv = setInterval(() => setSafeCheckCountdown(c => (c > 0 ? c - 1 : 0)), 1000);
    }
    return () => { if (iv) clearInterval(iv); };
  }, [showSafeCheck]);

  useEffect(() => { isSOSActiveRef.current = isSOSActive; }, [isSOSActive]);

  // Keep the CPU awake (partial wake lock) for the whole emergency window so the
  // "Are you safe?" voice, countdown and location keep running with the screen
  // off / app minimised. Released the instant BOTH SOS and Follow-Me are off.
  useEffect(() => {
    try {
      const wl = NativeModules.RescuenWakeLock;
      if (!wl) return;
      if (isFollowMe || isSOSActive) { wl.acquire(); } else { wl.release(); }
    } catch (e) {}
  }, [isFollowMe, isSOSActive]);

  // Reliable Follow-Me stationary monitor — GPS can go quiet when truly still,
  // so we track "how long stopped" on a steady 1-second timer and show it live.
  //
  // GPS jitter fix: a stationary phone's fix normally drifts a few metres (and can
  // spike much more for a single reading). We therefore (1) size the "moved"
  // threshold to the fix's own accuracy radius (with a 35 m floor) so ordinary
  // drift is ignored, and (2) require the movement to be SUSTAINED for 2 seconds
  // before accepting it as real — a lone noisy spike never resets the timer.
  useEffect(() => {
    let iv;
    if (isFollowMe) {
      followMeRefPos.current = lastCoordsRef.current || currentCoords || null;
      followMeMoveCount.current = 0;
      setFollowMeStationarySec(0);
      iv = setInterval(() => {
        const c = lastCoordsRef.current;
        if (!c) return;
        if (!followMeRefPos.current) { followMeRefPos.current = c; return; }
        const moved = getDistance(followMeRefPos.current, c);
        // Ignore drift within the GPS error radius; never react below a 35 m floor.
        const acc = (typeof c.accuracy === 'number' && c.accuracy > 0) ? c.accuracy : 15;
        const jitterThreshold = Math.max(35, acc * 1.5);
        if (moved > jitterThreshold) {
          // Only accept it once movement persists for 2 consecutive seconds.
          followMeMoveCount.current += 1;
          if (followMeMoveCount.current >= 2) {
            followMeRefPos.current = c;
            followMeMoveCount.current = 0;
            setFollowMeStationarySec(0);
          }
        } else {
          followMeMoveCount.current = 0; // back inside the safe radius → not moving
          setFollowMeStationarySec(s => {
            if (s >= 180) return 180;
            const next = s + 1;
            if (next >= 180 && !isSOSActiveRef.current) { try { SafeJourneyEngine.triggerAreYouSafeWarning(); } catch (e) {} }
            return next;
          });
        }
      }, 1000);
    } else {
      setFollowMeStationarySec(0);
      followMeRefPos.current = null;
      followMeMoveCount.current = 0;
    }
    return () => { if (iv) clearInterval(iv); };
  }, [isFollowMe]);

  // Fake Call: ring with vibration while incoming; count up while active.
  useEffect(() => {
    let timer;
    if (fakeCallState === 'incoming') {
      try { Vibration.vibrate([0, 1000, 2000], true); } catch (e) {}
    } else if (fakeCallState === 'active') {
      try { Vibration.cancel(); } catch (e) {}
      setFakeCallSecs(0);
      timer = setInterval(() => setFakeCallSecs(s => s + 1), 1000);
    } else {
      try { Vibration.cancel(); } catch (e) {}
    }
    return () => { if (timer) clearInterval(timer); };
  }, [fakeCallState]);

  const toggleFollowMe = async () => {
    try {
      if (isFollowMe) {
        await SafeJourneyEngine.stopTracking();
        setIsFollowMe(false);
        setShowSafeCheck(false);
      } else {
        await SafeJourneyEngine.startTracking();
        setIsFollowMe(true);
        Alert.alert("🛡️ Follow-Me Active", "RESCUEN is guarding your journey. If you stay stopped unexpectedly, we'll check on you — and auto-trigger SOS if you don't respond.");
      }
    } catch (e) { console.log(e); }
  };

  useEffect(() => {
    const unsubscribe = messaging().onMessage(async remoteMessage => {
      if (remoteMessage.data?.type === 'CANCEL_SOS') {
        if (sirenSound.current) { try{sirenSound.current.stop();}catch(e){} }
        if (globalBgSiren) { try{globalBgSiren.stop(); globalBgSiren.release();}catch(e){} globalBgSiren = null; }
        return; 
      }
      
      if (remoteMessage.data?.type === 'SOS' || remoteMessage.data?.type === 'SOS_ALERT') {
        if (isStaleAlert(remoteMessage.data?.sentAt)) return;

        Alert.alert('🚨 EMERGENCY ALERT!', remoteMessage.notification?.body || 'Someone needs help nearby!');
        
        if (remoteMessage.data && remoteMessage.data.victimEmail) {
          await AsyncStorage.setItem('last_sos_received', JSON.stringify({
            body: remoteMessage.notification?.body || 'Emergency Alert!',
            email: remoteMessage.data.victimEmail,
            name: remoteMessage.data.victimName || 'Unknown',
            phone: remoteMessage.data.victimPhone || 'N/A',
            link: remoteMessage.data.mapLink || 'Link not available',
            time: new Date().toLocaleString()
          })).catch(() => {});
        }

        if (sirenSound.current && !isSOSActive) { try{sirenSound.current.play();}catch(e){} }
      }
    });
    return unsubscribe;
  }, [isSOSActive]);

  useEffect(() => {
    GoogleSignin.configure({
      webClientId: '991521421004-t3rp40bq9lt3qbhcpcalc9ba6moe1r67.apps.googleusercontent.com',
    });
    
    try {
      sirenSound.current = new Sound('siren.mp3', Sound.MAIN_BUNDLE, (error) => {
        if (!error) sirenSound.current.setNumberOfLoops(-1);
      });
    } catch(e){}

    const initApp = async () => {
      try {
        const deletedEmail = await AsyncStorage.getItem('deletedEmail');
        if (deletedEmail) setDeletedAccountMsg(deletedEmail);

        const sessionData = await AsyncStorage.getItem('userSession');
        if (sessionData) {
          const parsedUser = JSON.parse(sessionData);
          if (!parsedUser.familyNumbers || parsedUser.familyNumbers.length === 0) {
            parsedUser.familyNumbers = parsedUser.familyNum ? [parsedUser.familyNum] : [''];
          }
          setUser(parsedUser);
          
          const savedSOSState = await AsyncStorage.getItem('is_sos_active');
          const isBatteryFixed = await AsyncStorage.getItem('battery_fixed');
          
          if (isBatteryFixed === 'yes') {
            setCurrentScreen('Dashboard'); 
            checkAndRequestLocation(); 
            
            if (savedSOSState === 'true') {
              setIsSOSActive(true);
              setTimeout(() => {
                if (sirenSound.current) { try{sirenSound.current.setVolume(1.0); sirenSound.current.play();}catch(e){} }
              }, 500);
            }
          } else {
            setCurrentScreen('BatteryWarning');
          }
          
          requestEssentialPermissions(parsedUser.email); 
          
          // 🔥 START PREMIUM NOTIFICATIONS (respect the user's saved toggles)
          if (NotificationManager) {
              let ns = {};
              try { const raw = await AsyncStorage.getItem('app_settings'); if (raw) ns = JSON.parse(raw); } catch (e) {}
              if (ns.dailyTip !== false) NotificationManager.scheduleDailyMorningAlert();
              if (ns.reviewReminder !== false) NotificationManager.scheduleReviewPush();
              NotificationManager.setupNotificationListeners();
          }

        } else { 
          const pendingRegEmail = await AsyncStorage.getItem('safe_reg_email');
          if (pendingRegEmail) {
             const pendingRegName = await AsyncStorage.getItem('safe_reg_name');
             setUser(prev => ({...prev, email: pendingRegEmail, name: pendingRegName || ''}));
             setIsAgreed(false); setHasScrolledToEnd(false);
             setCurrentScreen('TC');
          } else {
             setCurrentScreen('Login'); 
          }
        }
      } catch (e) { setCurrentScreen('Login'); }
    };

    initApp();
    return () => { if (sirenSound.current) { try{sirenSound.current.release();}catch(e){} } };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active' && currentScreen === 'Dashboard') {
        checkAndRequestLocation();
      }
    });
    return () => { subscription.remove(); };
  }, [currentScreen]);

  // Gentle radar-ping loop behind the SOS button (only while it's on screen).
  useEffect(() => {
    let loop;
    if (currentScreen === 'Dashboard' && hasAllTheTimePermission && !isSOSActive && !settings.reduceMotion) {
      sosPulse.setValue(0);
      loop = Animated.loop(Animated.timing(sosPulse, { toValue: 1, duration: 1600, useNativeDriver: true }));
      loop.start();
    }
    return () => { if (loop) { try { loop.stop(); } catch (e) {} } };
  }, [currentScreen, hasAllTheTimePermission, isSOSActive, settings.reduceMotion]);

  const checkAndRequestLocation = async () => {
    try {
      let fineLoc = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      if (!fineLoc) {
        Alert.alert(
          "Location Permission Required",
          "RESCUEN collects location data to enable live SOS tracking and 1KM radar alerts even when the app is closed or not in use.\n\nTap 'I Understand & Continue' to grant access.",
          [
            { text: "Cancel", style: "cancel", onPress: () => setHasAllTheTimePermission(false) },
            {
              text: "I Understand & Continue",
              onPress: async () => {
                const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
                if (granted === PermissionsAndroid.RESULTS.GRANTED) {
                  let bgLoc = false;
                  if (Platform.OS === 'android' && Platform.Version >= 29) {
                     bgLoc = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION);
                  } else { bgLoc = true; }
                  if (bgLoc) { setHasAllTheTimePermission(true); startGPS(); }
                  else { setHasAllTheTimePermission(false); }
                } else { setHasAllTheTimePermission(false); }
              }
            }
          ],
          { cancelable: false }
        );
        return; 
      }

      let bgLoc = false;
      if (Platform.OS === 'android' && Platform.Version >= 29) {
         bgLoc = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION);
      } else { bgLoc = true; }

      if (bgLoc) {
        setHasAllTheTimePermission(true);
        startGPS();
      } else { setHasAllTheTimePermission(false); }
    } catch (err) { console.warn(err); }
  };

  const startGPS = () => {
    Geolocation.getCurrentPosition(
      (pos) => {
        const loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, speed: pos.coords.speed, accuracy: pos.coords.accuracy };
        setCurrentCoords(loc);
        if (pos.coords.accuracy <= 10) { setCurrentLocationText('🟢 Exact Pin-Point Locked'); }
        else { setCurrentLocationText('🟡 Refining Accuracy...'); }
      },
      (error) => {}, { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );

    Geolocation.watchPosition(
      (pos) => {
        const loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, speed: pos.coords.speed, accuracy: pos.coords.accuracy };
        setCurrentCoords(loc);

        // Pass data to SafeJourneyEngine (Phase 2)
        if (SafeJourneyEngine) SafeJourneyEngine.processLocation(loc.speed, loc.latitude, loc.longitude);
        
        if (pos.coords.accuracy <= 10) { setCurrentLocationText('🟢 Exact Pin-Point Locked'); } 
        else { setCurrentLocationText('🟡 Refining Accuracy...'); }
      },
      (error) => {}, { enableHighAccuracy: true, accuracy: {android: 'high'}, distanceFilter: 1, interval: 2000, fastestInterval: 1000, maximumAge: 0 }
    );
  };

  useEffect(() => {
    if (currentCoords) lastCoordsRef.current = currentCoords;
    // "Hide my location when safe": don't publish location unless an SOS is active.
    if (currentCoords && user && user.email && !(settings.hideLocationWhenSafe && !isSOSActive)) {
       const hash = encodeGeohash(currentCoords.latitude, currentCoords.longitude);
       // Publish location to `presence` (no phone/family/token — safe for nearby
       // users to read for the radar) and mirror to the user doc for backward
       // compatibility during the migration.
       firestore().collection('presence').doc(user.email).set({
         email: user.email, name: user.name || '', gender: user.gender || '',
         h: hash, lastKnownLocation: currentCoords,
         updatedAt: firestore.FieldValue.serverTimestamp(),
       }, { merge: true }).catch(() => {});
       firestore().collection('users').doc(user.email).update({ lastKnownLocation: currentCoords, h: hash }).catch(() => {});
    }
  }, [currentCoords, user.email]);

  useEffect(() => {
    let watchId;
    let unsubMetrics = null;
    let victimMapListener = null;

    if (isSOSActive && user.email) {
      watchId = Geolocation.watchPosition(
        (pos) => {
          const loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, speed: pos.coords.speed, accuracy: pos.coords.accuracy };
          setCurrentCoords(loc);
          const hash = encodeGeohash(loc.latitude, loc.longitude);
          firestore().collection('active_emergencies').doc(user.email).set({
            location: loc,
            l: new firestore.GeoPoint(loc.latitude, loc.longitude),
            h: hash, user: sanitizeUserForBroadcast(user), timestamp: firestore.FieldValue.serverTimestamp()
          }, { merge: true }).catch(()=>{});
        },
        (err) => {}, { enableHighAccuracy: true, distanceFilter: 20, interval: 5000, fastestInterval: 2000 }
      );
      
      unsubMetrics = firestore().collection('active_emergencies').doc(user.email)
        .onSnapshot(doc => {
           try {
             if(doc.exists) {
                const data = doc.data();
                setBroadcastMetrics({
                   totalNotified: (typeof data?.nearbyCount === 'number' ? data.nearbyCount : (data?.notifiedUsers?.length || 0)),
                   helpers: data?.activeHelpers?.length || 0
                });
             }
           } catch(err) {}
        });

      if (queryPrefix) {
        victimMapListener = firestore().collection('presence')
          .orderBy('h').startAt(queryPrefix).endAt(queryPrefix + '\uf8ff')
          .onSnapshot(snap => {
            try {
              const center = lastCoordsRef.current || currentCoords;
              let usersList = [];
              snap.forEach(doc => {
                const data = doc.data();
                if (data.email !== user.email && data.lastKnownLocation && center) {
                   const dist = getDistance(center, data.lastKnownLocation);
                   if (dist <= 1000) usersList.push({ ...data, dist }); // ONLY within the 1 km radar
                }
              });
              usersList.sort((a,b) => a.dist - b.dist);
              setVictimMapHelpers(usersList.slice(0, 20));
            } catch(e){}
          });
      }
    }
    return () => { 
      if(watchId !== undefined) Geolocation.clearWatch(watchId); 
      if(unsubMetrics) unsubMetrics();
      if(victimMapListener) victimMapListener();
    }
  }, [isSOSActive, user.email, queryPrefix]);

  useEffect(() => {
    if (currentCoords) {
       const hash = encodeGeohash(currentCoords.latitude, currentCoords.longitude, 9);
       const prefix = hash.substring(0, 4); 
       if (prefix !== queryPrefix) setQueryPrefix(prefix); 
    }
  }, [currentCoords]);

  useEffect(() => {
    let subscriber = null;
    if (!queryPrefix || (currentScreen !== 'Dashboard' && currentScreen !== 'AIHelp')) return;
    
    subscriber = firestore().collection('active_emergencies')
      .orderBy('h').startAt(queryPrefix).endAt(queryPrefix + '\uf8ff')
      .onSnapshot(snap => {
         let list = [];
         snap.forEach(doc => { list.push({ ...doc.data(), id: doc.id }); });
         setRawEmergencies(list);
      }, err => console.log(err));

    return () => { if(subscriber) subscriber(); };
  }, [queryPrefix, currentScreen]);

  useEffect(() => {
    if (!currentCoords || rawEmergencies.length === 0) {
       setNearbyEmergenciesList([]); setShowHeroModal(false); setNearbyEmergency(null);
       if (sirenSound.current && !isSOSActive) { try{sirenSound.current.stop();}catch(e){} } 
       return;
    }
    
    let allNearby = [];
    let myEmail = user.email;

    rawEmergencies.forEach(data => {
       if (data.id !== myEmail && data.location) {
          const dist = getDistance(currentCoords, data.location);
          if (dist <= 1000) { if (!allNearby.some(e => e.user.email === data.user.email)) allNearby.push(data); }
       }
    });

    setNearbyEmergenciesList(allNearby);
    const validEmergency = allNearby.find(e => !ignoredEmergencies.includes(e.id));

    if (validEmergency && settings.nearbyAlerts) {
       if (!validEmergency.notifiedUsers || !validEmergency.notifiedUsers.includes(myEmail)) {
          firestore().collection('active_emergencies').doc(validEmergency.id)
             .update({ notifiedUsers: firestore.FieldValue.arrayUnion(myEmail) }).catch(()=>{});
       }
       setNearbyEmergency(validEmergency); setShowHeroModal(true);
       if (sirenSound.current && !isSOSActive) { try{sirenSound.current.play();}catch(e){} }
    } else {
       setShowHeroModal(false); setNearbyEmergency(null);
       if (sirenSound.current && !isSOSActive) { try{sirenSound.current.stop();}catch(e){} }
       if (globalBgSiren) { try{globalBgSiren.stop(); globalBgSiren.release();}catch(e){} globalBgSiren = null; }
    }
  }, [currentCoords, rawEmergencies, ignoredEmergencies, isSOSActive, user.email]);

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    try {
      await GoogleSignin.hasPlayServices();
      try { await GoogleSignin.signOut(); } catch (e) {} 
      const response = await GoogleSignin.signIn();
      const idToken = response.data?.idToken || response.idToken;
      const credential = auth.GoogleAuthProvider.credential(idToken);
      const userCredential = await auth().signInWithCredential(credential);

      const fbUser = userCredential.user;
      const userEmail = fbUser.email || "error@rescuen.com";
      const userName = fbUser.displayName || "User";

      const userDoc = await firestore().collection('users').doc(userEmail).get();

      if (userDoc.exists) {
        const dbData = userDoc.data() || {};
        if (dbData.pendingDelete) {
          await firestore().collection('users').doc(userEmail).update({ pendingDelete: firestore.FieldValue.delete() });
          await AsyncStorage.removeItem('deletedEmail');
          setDeletedAccountMsg(null);
          Alert.alert("Welcome Back!", "Your account deletion request has been cancelled.");
        }
        
        if (!dbData.familyNumbers || dbData.familyNumbers.length === 0) {
          dbData.familyNumbers = dbData.familyNum ? [dbData.familyNum] : [''];
        }
        setUser(dbData);
        requestEssentialPermissions(dbData.email);

        if (dbData.tcAccepted === true) {
            await AsyncStorage.setItem('userSession', JSON.stringify(dbData));
            setCurrentScreen('BatteryWarning');
        } else {
            await AsyncStorage.setItem('safe_reg_email', userEmail);
            await AsyncStorage.setItem('safe_reg_name', userName);
            setIsAgreed(false); setHasScrolledToEnd(false);
            setCurrentScreen('TC'); 
        }
      } else {
        setUser({ name: userName, email: userEmail, gender: '', familyNumbers: [''], myPhone: '', lastNumberUpdate: 0 });
        await AsyncStorage.setItem('safe_reg_email', userEmail);
        await AsyncStorage.setItem('safe_reg_name', userName);
        setIsAgreed(false); setHasScrolledToEnd(false); 
        setCurrentScreen('TC');
      }
    } catch (error) { Alert.alert("Login Error", error.message); } 
    finally { setIsLoading(false); }
  };

  const handleTCProceed = async () => { setCurrentScreen('ProfileSetup'); };

  // Prefer LINKING the phone to the already-signed-in Google account so the
  // session keeps its stable uid + email identity (this is what lets the backend
  // and security rules bind data to a real owner). If linking isn't possible
  // (no current user, or the number is already linked elsewhere), fall back to
  // standard phone sign-in so OTP verification never breaks.
  const requestPhoneCode = async () => {
    const phoneNumber = '+91' + user.myPhone;
    const currentUser = auth().currentUser;
    if (currentUser) {
      try {
        return await currentUser.linkWithPhoneNumber(phoneNumber);
      } catch (linkErr) {
        console.log('linkWithPhoneNumber fallback:', linkErr?.code || linkErr);
      }
    }
    return await auth().signInWithPhoneNumber(phoneNumber);
  };

  const sendOTP = async () => {
    if (user.myPhone.length !== 10) return Alert.alert("Validation", "Enter a valid 10-digit number.");
    if (isSendingOtp || isOtpSent) return;
    setIsSendingOtp(true);
    try {
      const confirmation = await requestPhoneCode();
      setConfirmResult(confirmation);
      setIsOtpSent(true); setOtpTimer(60);
      Alert.alert("OTP Sent", "Check your messages.");
    } catch (error) { Alert.alert("Error", String(error.message)); }
    finally { setIsSendingOtp(false); }
  };

  const resendOTP = async () => {
    if (otpTimer > 0) return;
    setIsSendingOtp(true); setOtpCode(''); isVerifyingRef.current = false;
    try {
      const confirmation = await requestPhoneCode();
      setConfirmResult(confirmation); setOtpTimer(60);
      Alert.alert("OTP Resent", "A new OTP has been sent.");
    } catch (error) { Alert.alert("Error", String(error.message)); }
    finally { setIsSendingOtp(false); }
  };

  const verifyOTP = async (codeToVerify = null) => {
    const finalOtp = codeToVerify || otpCode;
    const cleanOtp = finalOtp.replace(/[^0-9]/g, '').slice(0, 6); 
    if (cleanOtp.length !== 6) return;
    if (isVerifyingRef.current || isVerifyingOtp) return; 
    
    isVerifyingRef.current = true; setIsVerifyingOtp(true);

    try {
      await confirmResult.confirm(cleanOtp);
      setIsPhoneVerified(true); setOtpTimer(0); 
      Alert.alert("Success", "Verified Successfully! ✅");
    } catch (error) { 
      try {
        const currentUser = auth().currentUser;
        if (currentUser) {
          setIsPhoneVerified(true); setOtpTimer(0); 
          Alert.alert("Success", "Verified Automatically! ✅");
        } else {
          Alert.alert("Verification Error", "Invalid OTP. Please check and try again."); 
          setOtpCode(''); 
        }
      } catch(e){}
    } finally {
      setIsVerifyingOtp(false);
      setTimeout(() => { isVerifyingRef.current = false; }, 1000); 
    }
  };

  useEffect(() => {
    const cleanOtp = otpCode.replace(/[^0-9]/g, '');
    if (cleanOtp.length === 6 && confirmResult && !isPhoneVerified && !isVerifyingRef.current) {
      verifyOTP(cleanOtp);
    }
  }, [otpCode, confirmResult, isPhoneVerified]);

  const handleFamilyNumChange = (text, index) => {
    const newNumbers = [...user.familyNumbers];
    newNumbers[index] = text.replace(/[^0-9]/g, '').slice(0, 10);
    setUser({...user, familyNumbers: newNumbers});
  };

  const addFamilyNumber = () => {
    if (user.familyNumbers.length < 5) setUser({...user, familyNumbers: [...user.familyNumbers, '']});
  };

  const removeFamilyNumber = (index) => {
    const newNumbers = [...user.familyNumbers];
    newNumbers.splice(index, 1);
    setUser({...user, familyNumbers: newNumbers});
  };

  const saveProfileAndLogin = async () => {
    if (!isPhoneVerified) return Alert.alert("Security Check", "Verify your phone number first.");
    if (!user.familyNumbers[0] || user.familyNumbers[0].length !== 10) return Alert.alert("Missing Field", "First family emergency number is mandatory (10-digits).");
    if (!user.name.trim()) return Alert.alert("Missing Field", "Please enter your full name.");
    if (!user.gender) return Alert.alert("Missing Field", "Please select your gender.");

    const validFamilyNums = user.familyNumbers.filter(n => n && n.length === 10);
    if(validFamilyNums.length === 0) return Alert.alert("Missing Field", "Enter at least one valid 10-digit number.");

    const savedEmail = await AsyncStorage.getItem('safe_reg_email');
    const savedName = await AsyncStorage.getItem('safe_reg_name');

    let finalEmail = user.email || savedEmail;
    let finalName = user.name || savedName;
    if (!finalEmail) return Alert.alert("Critical Error", "Email is lost.");

    setIsSavingProfile(true); 
    try {
      const hash = currentCoords ? encodeGeohash(currentCoords.latitude, currentCoords.longitude) : "";
      const finalData = {
        name: finalName, email: finalEmail, gender: user.gender, familyNumbers: validFamilyNums, familyNum: validFamilyNums[0], 
        myPhone: user.myPhone, lastNumberUpdate: Date.now(), tcAccepted: true, h: hash, joinedAt: firestore.FieldValue.serverTimestamp()
      };
      if(currentCoords) finalData.lastKnownLocation = currentCoords;
      
      await firestore().collection('users').doc(finalEmail).set(finalData);
      // Publish safe presence (no phone/family) for the nearby radar.
      await firestore().collection('presence').doc(finalEmail).set({
        email: finalEmail, name: finalName, gender: user.gender || '',
        h: hash, ...(currentCoords ? { lastKnownLocation: currentCoords } : {}),
        updatedAt: firestore.FieldValue.serverTimestamp(),
      }, { merge: true }).catch(() => {});
      await AsyncStorage.setItem('userSession', JSON.stringify(finalData));
      await AsyncStorage.removeItem('safe_reg_email');
      await AsyncStorage.removeItem('safe_reg_name');
      
      setUser(finalData);
      setCurrentScreen('BatteryWarning'); 
      requestEssentialPermissions(finalEmail); 
    } catch (error) { Alert.alert("Database Error", String(error.message)); } 
    finally { setIsSavingProfile(false); }
  };

  const handleOpenEditModal = () => {
    // Always open — family numbers can be edited anytime. Only the user's OWN
    // number has a 60-day change lock (enforced on save).
    setEditData({ myPhone: user.myPhone, familyNumbers: [...(user.familyNumbers && user.familyNumbers.length ? user.familyNumbers : [''])] });
    setEditOtpStep('form'); setEditOtp(''); setEditError(''); setEditConfirm(null);
    setShowEditModal(true);
  };

  const handleEditFamilyNumChange = (text, index) => {
    const newNumbers = [...editData.familyNumbers];
    newNumbers[index] = text.replace(/[^0-9]/g, '').slice(0, 10);
    setEditData({...editData, familyNumbers: newNumbers});
  };
  const addEditFamilyNumber = () => {
    if (editData.familyNumbers.length < 5) setEditData({ ...editData, familyNumbers: [...editData.familyNumbers, ''] });
  };
  const removeEditFamilyNumber = (index) => {
    const newNumbers = [...editData.familyNumbers];
    newNumbers.splice(index, 1);
    setEditData({ ...editData, familyNumbers: newNumbers.length ? newNumbers : [''] });
  };

  const doSaveNumbers = async () => {
    const validFamilyNums = editData.familyNumbers.filter(n => n && n.length === 10);
    const phoneChanged = editData.myPhone !== user.myPhone;
    setIsLoading(true);
    try {
      const now = Date.now();
      const payload = { myPhone: editData.myPhone, familyNumbers: validFamilyNums, familyNum: validFamilyNums[0] };
      if (phoneChanged) payload.lastPhoneUpdate = now; // only the OWN-number lock resets on a phone change
      const updatedUser = { ...user, ...payload };
      await firestore().collection('users').doc(user.email).update(payload);
      await AsyncStorage.setItem('userSession', JSON.stringify(updatedUser));
      setUser(updatedUser);
      setEditOtpStep('form'); setShowEditModal(false);
      Alert.alert("Success", "Your emergency contacts have been updated safely!");
    } catch (error) { Alert.alert("Update Error", String(error.message || error)); }
    finally { setIsLoading(false); }
  };

  const saveEditedNumbers = async () => {
    const validFamilyNums = editData.familyNumbers.filter(n => n && n.length === 10);
    if (editData.myPhone.length !== 10) return Alert.alert("Invalid Number", "Enter a valid 10-digit phone number.");
    if (validFamilyNums.length === 0) return Alert.alert("Missing Contact", "At least 1 family emergency number (10 digits) is required.");
    // MY OWN number: 60-day change lock + OTP verification. Family numbers: anytime.
    if (editData.myPhone !== user.myPhone) {
      const lastPhone = user.lastPhoneUpdate || 0;
      const daysPassed = (Date.now() - lastPhone) / (1000 * 60 * 60 * 24);
      if (lastPhone !== 0 && daysPassed < 60) {
        return Alert.alert("Number Change Locked", `Your own number can be changed once every 60 days (try again in ${Math.ceil(60 - daysPassed)} days).\n\nFamily numbers can be added, edited or removed anytime — just leave your own number unchanged and save.`);
      }
      setIsLoading(true); setEditError('');
      try {
        const conf = await auth().signInWithPhoneNumber('+91' + editData.myPhone);
        setEditConfirm(conf); setEditOtp(''); setEditOtpStep('otp');
      } catch (e) { setEditError('Could not send OTP. Check the number and network.'); }
      finally { setIsLoading(false); }
      return;
    }
    doSaveNumbers(); // phone unchanged → save family numbers anytime, no OTP
  };

  const verifyEditOtp = async () => {
    const code = editOtp.replace(/[^0-9]/g, '').slice(0, 6);
    if (code.length !== 6) { setEditError('Enter the 6-digit OTP'); return; }
    if (!editConfirm) { setEditError('OTP expired — go back and try again'); return; }
    try {
      await editConfirm.confirm(code); // new number verified for real
      setEditError('');
      await doSaveNumbers();
    } catch (e) { setEditError('Invalid OTP, try again'); setEditOtp(''); }
  };

  const startForegroundService = async () => {
    try {
      const channelId = await notifee.createChannel({ id: 'rescuen_sos_channel', name: 'Emergency SOS Alert', importance: AndroidImportance.HIGH });
      await notifee.displayNotification({
        id: 'active_sos_notification', title: '🚨 RESCUEN PROTECTION ACTIVE', body: 'Your live location is being broadcasted securely.',
        android: { channelId, asForegroundService: true, ongoing: true, color: AndroidColor.RED, pressAction: { id: 'default' } },
      });
    } catch (e) { console.log("Foreground Service Error: ", e); }
  };

  const triggerSOS = async () => {
    if (isSOSActive || isTriggering.current || actionLock.current) return;
    isTriggering.current = true; actionLock.current = true;

    try {
      await AsyncStorage.setItem('is_sos_active', 'true');
      setIsSOSActive(true);
      setBroadcastMetrics({ totalNotified: 0, helpers: 0 });
      
      try { Vibration.cancel(); } catch(e){}
      const st = settingsRef.current;
      if (st.sirenOnSos && sirenSound.current) { try { sirenSound.current.setVolume(1.0); sirenSound.current.play(); } catch(e) {} }
      if (st.sosVibration) { try { Vibration.vibrate([0, 1000, 500, 1000, 500, 1000, 500, 1000], true); } catch (e) {} }

      try { await startForegroundService(); } catch(e) {}
      
      // 🔥 START SECURE VAULT RECORDING (PHASE 3)
      // When video evidence is on, the camera records audio+video together, so we
      // must NOT also grab the mic here (that would conflict). Audio-only recorder
      // runs only when video evidence is disabled.
      if (SecureVaultManager && !st.videoEvidence) SecureVaultManager.startAudioEvidence(user.email);

      // Use freshest location; fall back to last known so an SOS is never lost
      // just because GPS hasn't re-locked at the moment of the trigger.
      const coords = currentCoords || lastCoordsRef.current;

      if (coords && user && user.email) {
        const hash = encodeGeohash(coords.latitude, coords.longitude);
        const emergencyDoc = {
          location: coords, l: new firestore.GeoPoint(coords.latitude, coords.longitude),
          h: hash, user: sanitizeUserForBroadcast(user),
          timestamp: firestore.FieldValue.serverTimestamp(), notifiedUsers: [], activeHelpers: [],
        };
        // Critical write — this is what fires the community broadcast + server
        // SMS. Retry across transient network failures instead of silently
        // swallowing them (the device SMS below is an independent backup).
        const ref = firestore().collection('active_emergencies').doc(user.email);
        let written = false;
        for (let attempt = 0; attempt < 3 && !written; attempt++) {
          try { await ref.set(emergencyDoc, { merge: true }); written = true; }
          catch (e) { await new Promise(r => setTimeout(r, 800 * (attempt + 1))); }
        }
      }

      const lat = coords ? coords.latitude : 0;
      const lng = coords ? coords.longitude : 0;
      const mapLink = coords ? `https://maps.google.com/?q=${lat},${lng}` : 'Location Unavailable';
      // "Always share live location with family" — include the live map link only if enabled.
      const smsBody = st.shareLocationFamily
        ? `🚨 RESCUEN EMERGENCY ALERT 🚨\n${user.name} is in danger and needs help NOW.\n📍 Live location: ${mapLink}\nPlease reach them or call the police immediately.\n\n— Sent automatically by RESCUEN Team`
        : `🚨 RESCUEN EMERGENCY ALERT 🚨\n${user.name} is in danger and needs help NOW.\nPlease call/reach them immediately or alert the police.\n\n— Sent automatically by RESCUEN Team`;

      try {
        const hasPermission = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.SEND_SMS);
        const validNumbers = (user.familyNumbers || []).filter(n => n && n.length === 10);
        // Emergency services: 112 is India's ERSS number, which (unlike the 100
        // voice line) accepts SMS. Included only if "Auto-alert police" is on.
        const recipients = st.autoAlertPolice ? ['112', ...validNumbers] : [...validNumbers];

        if (hasPermission && typeof DirectSms !== 'undefined') {
          validNumbers.forEach(num => { try { DirectSms.sendDirectSms(num, smsBody); } catch(e){} });
          if (st.autoAlertPolice) { try { DirectSms.sendDirectSms('112', smsBody); } catch(e){} }
        } else if (recipients.length > 0) {
          const separator = Platform.OS === 'ios' ? ',' : ';';
          const joinedNums = recipients.join(separator);
          const url = `sms:${joinedNums}?body=${encodeURIComponent(smsBody)}`;
          Linking.openURL(url).catch(err => {});
        }
      } catch(e){}

    } catch (error) { console.log(error); } 
    finally { isTriggering.current = false; setTimeout(() => { actionLock.current = false; }, 2000); }
  };

  // SOS fires immediately on a 2-second HOLD of the panic button — the hold
  // itself is the accidental-trigger guard, so no extra countdown delays help.
  const requestSOS = () => {
    if (isSOSActive || isTriggering.current) return;
    triggerSOS();
  };

  const deactivateSOS = async () => {
    if (actionLock.current) return;
    actionLock.current = true;

    try {
      setIsSOSActive(false);
      AsyncStorage.removeItem('is_sos_active').catch(()=>{});
      
      try { Vibration.cancel(); } catch(e){}
      if (sirenSound.current) { try { sirenSound.current.stop(); sirenSound.current.setCurrentTime(0); } catch(e) {} }
      if (globalBgSiren) { try { globalBgSiren.stop(); globalBgSiren.release(); } catch(e){} globalBgSiren = null; }

      // 🔥 STOP SECURE VAULT RECORDING & SUBMIT REPORT (PHASE 3)
      if (SecureVaultManager) {
        SecureVaultManager.stopAudioEvidence(user.email);
        SecureVaultManager.submitEncryptedReport(user, currentCoords, "Auto-generated report from SOS deactivation.");
      }

      if (user && user.email) {
        firestore().collection('active_emergencies').doc(user.email).delete().catch(()=>{});
      }
      
      if (resolveForegroundTask) { resolveForegroundTask(); resolveForegroundTask = null; }
      
      try {
        await notifee.stopForegroundService();
        await notifee.cancel('active_sos_notification');
      } catch(e) {}
      
      Alert.alert("Alarm Deactivated", "Emergency broadcast stopped successfully.");
    } catch (e) { console.log(e); } 
    finally { setTimeout(() => { actionLock.current = false; }, 2000); }
  };

  const handleLogout = async () => {
    setIsLoading(true);
    try {
      if (user && user.email) {
        await firestore().collection('users').doc(user.email).update({ fcmToken: firestore.FieldValue.delete() }).catch(() => {});
      }
      await AsyncStorage.removeItem('userSession'); 
      await AsyncStorage.removeItem('safe_reg_email');
      await AsyncStorage.removeItem('safe_reg_name');
      try { await GoogleSignin.signOut(); } catch (e) {}
      await auth().signOut();
      setUser({ name: '', email: '', gender: '', familyNumbers: [''], myPhone: '', lastNumberUpdate: 0 });
      setIsPhoneVerified(false); setConfirmResult(null); setCurrentScreen('Login');
    } catch (error) { console.log(error); }
    setIsLoading(false);
  };

  const handleConfirmDelete = async () => {
    if (deleteInputText !== 'DELETE') { return Alert.alert("Error", "Please type exactly 'DELETE' (all caps) to confirm."); }
    setIsLoading(true);
    try {
      const deleteDate = new Date();
      deleteDate.setDate(deleteDate.getDate() + 30);
      await firestore().collection('users').doc(user.email).update({ pendingDelete: true, deleteAt: firestore.Timestamp.fromDate(deleteDate) });

      const msg = `Account (${user.email}) is scheduled for deletion.\nLog in within 30 days to cancel.`;
      await AsyncStorage.setItem('deletedEmail', msg);
      setDeletedAccountMsg(msg);
      await handleLogout();
      setShowDeleteModal(false); setDeleteInputText('');
    } catch (error) { Alert.alert("Error", "Could not process delete request."); } 
    finally { setIsLoading(false); }
  };

  const handleAIChipSelect = (option) => {
    if (option === '💬 Custom Chat...') {
      setShowAIChips(false);
      setChatMessages(prev => [...prev, { sender: 'user', text: "I have a custom query." }, { sender: 'ai', text: "Sure! Please type your question below. I can understand multiple languages and help you with app security." }]);
      return;
    }
    
    // 🔥 NEW CONTACT SUPPORT CHIP ACTION
    if (option === '📧 Contact Support / Report') {
      setShowReportForm(true);
      return;
    }
    
    setChatMessages(prev => [...prev, { sender: 'user', text: option }]);
    handleSendChatMessage(option, true);
  };

  const handleSendChatMessage = async (overrideMessage = null, fromChip = false) => {
    const userMessage = overrideMessage || chatInput.trim();
    if (!userMessage) return;
    
    if (!fromChip) {
      setChatMessages(prev => [...prev, { sender: 'user', text: userMessage }]);
      setChatInput('');
    }
    setIsAITyping(true);

    let contextData = {};
    contextData.userLanguage = getLang(userLang).name;
    const lastSosData = await AsyncStorage.getItem('last_sos_received');
    if (lastSosData) contextData.lastReceivedSOS = JSON.parse(lastSosData);
    if (nearbyEmergenciesList.length > 0) contextData.activeNearbyEmergencies = nearbyEmergenciesList;

    // 🔥 PHASE 4: TERA ASLI PURE AI BRAIN FIRE HO RAHA HAI YAHAN
    const aiResponse = await RescuenBrain.processCommand(userMessage, contextData);
    
    setChatMessages(prev => [...prev, { sender: 'ai', text: aiResponse.text }]);
    setIsAITyping(false);
  };

  // ---- Settings screen building blocks ----
  const renderSetToggle = (icon, label, key, desc) => (
    <View style={styles.setRow}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={styles.setLabel}>{icon}  {label}</Text>
        {desc ? <Text style={styles.setDesc}>{desc}</Text> : null}
      </View>
      <Switch value={!!settings[key]} onValueChange={(v) => updateSetting(key, v)} trackColor={{ true: '#004aad', false: '#d0d5dd' }} thumbColor="#ffffff" />
    </View>
  );
  const renderSetNav = (icon, label, onPress, opts = {}) => (
    <TouchableOpacity style={styles.setRow} onPress={onPress} activeOpacity={0.7}>
      <Text style={[styles.setLabel, opts.danger && { color: '#e74c3c' }]}>{icon}  {label}</Text>
      <Text style={[styles.setArrow, opts.danger && { color: '#e74c3c' }]}>{opts.value ? opts.value + '   ›' : '›'}</Text>
    </TouchableOpacity>
  );
  const renderSetSection = (title, children) => (
    <View style={styles.setSection}>
      <Text style={styles.setSectionTitle}>{title}</Text>
      <View style={styles.setSectionCard}>{children}</View>
    </View>
  );
  const shareApp = () => { try { Linking.openURL('https://play.google.com/store/apps/details?id=com.officialrescuen.app'); } catch (e) {} };

  // ---- Profile photo (add / modify / delete) ----
  const [profileUploading, setProfileUploading] = useState(false);
  const selectProfilePhoto = async () => {
    try {
      const res = await launchImageLibrary({ mediaType: 'photo', quality: 0.7, maxWidth: 800, maxHeight: 800 });
      if (res.didCancel || !res.assets || !res.assets[0] || !res.assets[0].uri) return;
      const uri = res.assets[0].uri;
      const uid = auth().currentUser?.uid;
      if (!uid) return;
      setProfileUploading(true);
      const ref = storage().ref(`users/${uid}/profile/avatar.jpg`);
      await ref.putFile(uri);
      const url = await ref.getDownloadURL();
      await firestore().collection('users').doc(user.email).update({ photoURL: url }).catch(() => {});
      const updated = { ...user, photoURL: url };
      await AsyncStorage.setItem('userSession', JSON.stringify(updated)).catch(() => {});
      setUser(updated);
    } catch (e) { Alert.alert('Error', 'Could not update photo. Please try again.'); }
    finally { setProfileUploading(false); }
  };
  const deleteProfilePhoto = async () => {
    try {
      setProfileUploading(true);
      const uid = auth().currentUser?.uid;
      try { await storage().ref(`users/${uid}/profile/avatar.jpg`).delete(); } catch (e) {}
      await firestore().collection('users').doc(user.email).update({ photoURL: firestore.FieldValue.delete() }).catch(() => {});
      const updated = { ...user }; delete updated.photoURL;
      await AsyncStorage.setItem('userSession', JSON.stringify(updated)).catch(() => {});
      setUser(updated);
    } catch (e) {} finally { setProfileUploading(false); }
  };
  const pickProfilePhoto = () => {
    const opts = [{ text: 'Choose from Gallery', onPress: selectProfilePhoto }];
    if (user.photoURL) opts.push({ text: 'Remove Photo', style: 'destructive', onPress: deleteProfilePhoto });
    opts.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Profile Photo', 'Add, change or remove your photo', opts);
  };

  // ---- Evidence Vault logic ----
  const hashPin = (pin) => { let h = 5381; const s = 'rescuen_vault_' + pin; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return String(h); };
  const loadEvidence = async () => {
    setVaultLoading(true);
    try {
      const uid = auth().currentUser?.uid;
      if (!uid) { setVaultItems([]); setVaultLoading(false); return; }
      const root = storage().ref(`users/${uid}/evidence_vault`);
      const sessions = await root.listAll();
      let items = [];
      const parse = (name) => {
        const m = String(name).match(/^(\d{10,})_?(.*)$/); // "<timestamp>_<type>"
        return { ts: m ? parseInt(m[1], 10) : null, typeStr: m ? m[2] : String(name) };
      };
      for (const folder of sessions.prefixes) {
        const inner = await folder.listAll();
        for (const it of inner.items) { const p = parse(it.name); items.push({ session: folder.name, ref: it, ts: p.ts, typeStr: p.typeStr }); }
      }
      for (const it of sessions.items) { const p = parse(it.name); items.push({ session: 'general', ref: it, ts: p.ts, typeStr: p.typeStr }); }
      items.sort((a, b) => (b.ts || 0) - (a.ts || 0)); // newest first
      setVaultItems(items);
    } catch (e) { setVaultItems([]); }
    setVaultLoading(false);
  };
  const openVaultStep = async () => {
    setVaultError(''); setVaultPin(''); setVaultPinFirst(''); setVaultOtp('');
    try {
      const saved = await AsyncStorage.getItem('vault_pin_hash');
      setVaultStep(saved ? 'enterPin' : 'setPin');
    } catch (e) { setVaultStep('setPin'); }
  };
  const submitSetPin = () => {
    if (vaultPin.length !== 4) { setVaultError('Enter a 4-digit PIN'); return; }
    setVaultPinFirst(vaultPin); setVaultPin(''); setVaultError(''); setVaultStep('confirmPin');
  };
  const submitConfirmPin = async () => {
    if (vaultPin !== vaultPinFirst) { setVaultError('PINs do not match'); setVaultPin(''); return; }
    setVaultError('');
    try {
      const conf = await auth().signInWithPhoneNumber('+91' + (user.myPhone || ''));
      setVaultConfirm(conf); setVaultOtp(''); setVaultStep('otp');
    } catch (e) {
      // OTP is MANDATORY — never save the PIN without real verification.
      setVaultError('Could not send OTP. Check your network and try again.');
    }
  };
  const verifyVaultOtp = async () => {
    const code = vaultOtp.replace(/[^0-9]/g, '').slice(0, 6);
    if (code.length !== 6) { setVaultError('Enter the 6-digit OTP'); return; }
    if (!vaultConfirm) { setVaultError('OTP session expired. Go back and set the PIN again.'); return; }
    try {
      await vaultConfirm.confirm(code); // MUST succeed — real OTP verification, no bypass
      await AsyncStorage.setItem('vault_pin_hash', hashPin(vaultPinFirst));
      setVaultError(''); setVaultOtpSuccess(true);
      setTimeout(() => { setVaultOtpSuccess(false); setVaultStep('unlocked'); loadEvidence(); }, 1700);
    } catch (e) {
      setVaultError('Invalid OTP, try again'); setVaultOtp('');
    }
  };
  const submitEnterPin = async () => {
    try {
      const saved = await AsyncStorage.getItem('vault_pin_hash');
      if (saved && saved === hashPin(vaultPin)) { setVaultError(''); setVaultStep('unlocked'); loadEvidence(); }
      else { setVaultError('Wrong PIN'); setVaultPin(''); }
    } catch (e) { setVaultError('Something went wrong'); }
  };
  useEffect(() => { if (currentScreen === 'Vault') openVaultStep(); }, [currentScreen]);

  return (
    <View style={[styles.main, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent={true} />

      {/* Hidden background evidence recorder — records rear+front (alternating)
          during SOS while the SOS screen stays in front. Isolated & best-effort. */}
      <EvidenceCamera active={(isSOSActive || safeTest) && settings.videoEvidence} />

      <View style={styles.header}>
        <Image source={require('./android/app/src/main/res/drawable/logo.png')} style={styles.logo} />
        <Text style={styles.headerTitle}>RESCUEN</Text>
        
        <View style={styles.headerIconsContainer}>
          <TouchableOpacity onPress={() => Linking.openURL('https://www.instagram.com/hello.officialrescuen?igsh=aGpkZ2V1azhyNGsx')}>
            <Image source={{uri: 'https://cdn-icons-png.flaticon.com/512/2111/2111463.png'}} style={styles.socialIcon} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Linking.openURL('https://whatsapp.com/channel/0029Vb7ZOwYJ93wNB8znbq3M')}>
            <Image source={{uri: 'https://cdn-icons-png.flaticon.com/512/733/733585.png'}} style={styles.socialIcon} />
          </TouchableOpacity>
        </View>
      </View>

      {currentScreen === 'Login' ? (
         <View style={[styles.loginBgContainer, { backgroundColor: loginPhrases[loginPhaseIdx].bg }]}>
            <View style={styles.loginTextCenter}>
              <Text style={[styles.loginDynamicText, { color: loginPhrases[loginPhaseIdx].txtColor }]}>
                {displayedText}
                <Animated.Text style={{color: loginPhrases[loginPhaseIdx].dot, transform: [{translateY: dotAnimY}]}}>●</Animated.Text>
              </Text>
            </View>

            {deletedAccountMsg && (
              <View style={[styles.warningBox, {marginHorizontal: 20, position: 'absolute', top: 50}]}><Text style={styles.warningText}>⚠️ {deletedAccountMsg}</Text></View>
            )}

            <View style={styles.loginBottomArea}>
              <TouchableOpacity style={styles.googleLoginBtn} onPress={handleGoogleLogin} disabled={isLoading}>
                {isLoading ? <ActivityIndicator color="#000000" /> : (
                  <View style={{flexDirection: 'row', alignItems: 'center'}}>
                    <Image source={{uri: 'https://cdn-icons-png.flaticon.com/512/300/300221.png'}} style={{width: 22, height: 22, marginRight: 12}} />
                    <Text style={styles.googleBtnText}>Continue with Google</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
         </View>
      ) : (
        <ScrollView 
          contentContainerStyle={styles.scrollContent}
          ref={chatScrollRef}
          onContentSizeChange={() => {
            if (currentScreen === 'AIHelp' && chatScrollRef.current) {
              chatScrollRef.current.scrollToEnd({ animated: true });
            }
          }}
          scrollEnabled={currentScreen !== 'TC' && currentScreen !== 'ReadTC'} 
        >
          
          {currentScreen === 'Splash' && (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color="#004aad" />
              <Text style={{marginTop: 20, color: '#004aad', fontWeight: 'bold'}}>Initializing Systems...</Text>
            </View>
          )}

          {currentScreen === 'TC' && (
            <View style={[styles.card, {flex: 1, height: Dimensions.get('window').height * 0.75, padding: 15}]}>
              <Text style={[styles.cardTitle, {marginBottom: 0}]}>Legal Terms</Text>
              <Text style={{fontSize: 11, color: '#e74c3c', fontWeight: 'bold', marginBottom: 10}}>⚠️ SCROLL PDF TO BOTTOM TO ACCEPT</Text>
              
              <View style={{flex: 1, backgroundColor: '#f9f9f9', borderRadius: 12, overflow: 'hidden', borderWidth: 1.5, borderColor: '#eeeeee', marginBottom: 15}}>
                  <Pdf
                      source={pdfSource}
                      onLoadComplete={(numberOfPages,filePath) => {}}
                      onPageChanged={(page,numberOfPages) => {
                          if (page === numberOfPages) {
                              setHasScrolledToEnd(true);
                          }
                      }}
                      onError={(error) => {}}
                      onPressLink={(uri) => {
                          Linking.openURL(uri);
                      }}
                      style={{flex: 1, width: '100%'}}
                      trustAllCerts={false}
                  />
              </View>
              <TouchableOpacity 
                style={{alignItems: 'center', marginVertical: 10, padding: 5}} 
                onPress={() => Linking.openURL('https://sites.google.com/view/rescuen-app-policy/home')}
              >
                <Text style={{color: '#3498db', fontWeight: '900', fontSize: 14, textDecorationLine: 'underline'}}>
                  🌐 OPEN PRIVACY POLICY IN BROWSER
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.checkRow, !hasScrolledToEnd && {opacity: 0.3}]} onPress={() => setIsAgreed(!isAgreed)} disabled={!hasScrolledToEnd}>
                <View style={[styles.checkbox, isAgreed && styles.checked]} />
                <Text style={styles.checkLabel}>I ACCEPT THE LEGAL TERMS</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.btn, (!isAgreed || !hasScrolledToEnd) && {backgroundColor: '#cccccc'}]} 
                disabled={!isAgreed || !hasScrolledToEnd}
                onPress={handleTCProceed}
              >
                <Text style={styles.btnText}>PROCEED</Text>
              </TouchableOpacity>
            </View>
          )}

          {currentScreen === 'ReadTC' && (
            <View style={[styles.card, {flex: 1, height: Dimensions.get('window').height * 0.75, padding: 15}]}>
              <Text style={[styles.cardTitle, {marginBottom: 10}]}>Legal Documents</Text>
              
              <View style={{flex: 1, backgroundColor: '#f9f9f9', borderRadius: 12, overflow: 'hidden', borderWidth: 1.5, borderColor: '#eeeeee', marginBottom: 15}}>
                  <Pdf
                      source={pdfSource}
                      onPressLink={(uri) => { Linking.openURL(uri); }}
                      style={{flex: 1, width: '100%'}}
                      trustAllCerts={false}
                  />
              </View>
              <TouchableOpacity 
                style={{alignItems: 'center', marginBottom: 15, padding: 5}} 
                onPress={() => Linking.openURL('https://sites.google.com/view/rescuen-app-policy/home')}
              >
                <Text style={{color: '#3498db', fontWeight: '900', fontSize: 14, textDecorationLine: 'underline'}}>
                  🌐 OPEN PRIVACY POLICY IN BROWSER
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.btn, {backgroundColor: '#34495e'}]} onPress={() => setCurrentScreen('ProfileView')}>
                <Text style={styles.btnText}>CLOSE & GO BACK</Text>
              </TouchableOpacity>
            </View>
          )}

          {currentScreen === 'ProfileSetup' && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Set Up Rescue Profile</Text>

              <Text style={styles.label}>CHOOSE YOUR LANGUAGE</Text>
              <View style={{flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10}}>
                {LANGS.map(l => (
                  <TouchableOpacity key={l.code} style={[styles.langChip, userLang === l.code && styles.langChipActive]} onPress={() => updateLang(l.code)}>
                    <Text style={[styles.langChipText, userLang === l.code && {color: '#fff'}]}>{l.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>YOUR PHONE NUMBER</Text>
              <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15}}>
                <TextInput 
                  style={[styles.input, {flex: 0.6, marginBottom: 0, backgroundColor: isPhoneVerified ? '#e8f8f5' : '#f8f9fa'}]} 
                  placeholder="10-digit number" 
                  placeholderTextColor="#888888"
                  keyboardType="numeric" 
                  maxLength={10} 
                  value={user.myPhone}
                  onChangeText={(t) => setUser(prev => ({...prev, myPhone: t}))} 
                  editable={!isOtpSent && !isPhoneVerified} 
                />
                
                <TouchableOpacity 
                  style={[styles.btn, {flex: 0.38, marginTop: 0, height: 55, backgroundColor: isPhoneVerified ? '#2ecc71' : (isOtpSent ? '#bdc3c7' : '#004aad')}]} 
                  onPress={sendOTP} 
                  disabled={isSendingOtp || isOtpSent || isPhoneVerified} 
                >
                  {isSendingOtp ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={[styles.btnText, {fontSize: 12}]}>{isPhoneVerified ? "VERIFIED" : (isOtpSent ? "SENT ✅" : "SEND OTP")}</Text>}
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>ENTER 6-DIGIT OTP</Text>
              <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5}}>
                <TextInput 
                  style={[styles.input, {flex: 0.6, marginBottom: 0, textAlign: 'center', fontSize: 18, letterSpacing: 5, backgroundColor: (isOtpSent && !isPhoneVerified) ? '#ffffff' : '#f0f0f0'}]} 
                  placeholder="------" 
                  placeholderTextColor="#cccccc"
                  keyboardType="number-pad" 
                  maxLength={6}
                  value={otpCode} 
                  onChangeText={(text) => {
                    const strictNumbersOnly = text.replace(/[^0-9]/g, '').slice(0, 6);
                    setOtpCode(strictNumbersOnly);
                  }} 
                  textContentType="oneTimeCode" 
                  autoComplete="sms-otp"
                  editable={isOtpSent && !isPhoneVerified && !isVerifyingOtp} 
                  onSubmitEditing={() => verifyOTP()} 
                /> 
                <TouchableOpacity 
                  style={[styles.btn, {flex: 0.38, marginTop: 0, height: 55, backgroundColor: (isOtpSent && otpCode.length === 6 && !isPhoneVerified) ? '#e67e22' : '#bdc3c7'}]} 
                  onPress={() => verifyOTP()} 
                  disabled={isVerifyingOtp || !isOtpSent || isPhoneVerified || otpCode.length !== 6}
                >
                  {isVerifyingOtp ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={[styles.btnText, {fontSize: 12}]}>CONFIRM</Text>}
                </TouchableOpacity>
              </View>

              <View style={{flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'center', marginBottom: 20, paddingLeft: 5}}>
                <TouchableOpacity onPress={resendOTP} disabled={otpTimer > 0 || isSendingOtp || !isOtpSent || isPhoneVerified}>
                  <Text style={{fontSize: 13, fontWeight: 'bold', color: (!isOtpSent || otpTimer > 0 || isPhoneVerified) ? '#95a5a6' : '#004aad', textDecorationLine: (!isOtpSent || otpTimer > 0 || isPhoneVerified) ? 'none' : 'underline'}}>
                    RESEND OTP
                  </Text>
                </TouchableOpacity>
                {isOtpSent && otpTimer > 0 && !isPhoneVerified && (
                  <Text style={{fontSize: 13, fontWeight: 'bold', color: '#e74c3c', marginLeft: 8}}>
                    in 00:{otpTimer < 10 ? `0${otpTimer}` : otpTimer}
                  </Text>
                )}
              </View>

              <Text style={styles.label}>FULL NAME</Text>
              <TextInput 
                style={styles.input} 
                value={user.name} 
                placeholder="Enter your legal name" 
                placeholderTextColor="#888888"
                onChangeText={(t) => setUser(prev => ({...prev, name: t}))} 
              />

              <Text style={styles.label}>GENDER</Text>
              <View style={styles.genderRow}>
                {['Male', 'Female', 'Other'].map(g => (
                  <TouchableOpacity key={g} style={[styles.gBtn, user.gender === g && styles.gActive]} onPress={()=>setUser(prev => ({...prev, gender:g}))}>
                    <Text style={[styles.gText, user.gender === g && {color:'#ffffff'}]}>{g}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>EMERGENCY FAMILY CONTACTS (UP TO 5)</Text>
              {user.familyNumbers.map((num, index) => (
                <View key={index} style={{flexDirection: 'row', alignItems: 'center'}}>
                  <TextInput 
                    style={[styles.input, {flex: 1, marginBottom: 10}]} 
                    value={num}
                    placeholder={index === 0 ? "Mandatory 10-digit number" : "Optional 10-digit number"} 
                    placeholderTextColor="#888888"
                    keyboardType="numeric" 
                    maxLength={10} 
                    onChangeText={(t) => handleFamilyNumChange(t, index)} 
                  />
                  {index > 0 && (
                    <TouchableOpacity onPress={() => removeFamilyNumber(index)} style={{padding: 15, marginLeft: 5}}>
                      <Text style={{color: '#e74c3c', fontWeight: 'bold', fontSize: 20}}>X</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}

              {user.familyNumbers.length < 5 && (
                <TouchableOpacity onPress={addFamilyNumber} style={{alignItems: 'flex-start', marginBottom: 15}}>
                  <Text style={{color: '#3498db', fontWeight: 'bold', fontSize: 13}}>+ ADD ANOTHER NUMBER</Text>
                </TouchableOpacity>
              )}
              
              <TouchableOpacity 
                style={[styles.btn, (!isPhoneVerified) && {backgroundColor: '#bdc3c7'}, {marginTop: 10, height: 60}]} 
                onPress={saveProfileAndLogin} 
                disabled={isSavingProfile || !isPhoneVerified}
              >
                {isSavingProfile ? (
                  <View style={{flexDirection: 'row', alignItems: 'center'}}>
                    <ActivityIndicator color="#ffffff" style={{marginRight: 10}} />
                    <Text style={styles.btnText}>ACTIVATING...</Text>
                  </View>
                ) : (
                  <Text style={styles.btnText}>🛡️ ACTIVATE SYSTEM</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {currentScreen === 'BatteryWarning' && (
            <View style={[styles.card, { borderColor: '#e74c3c', borderWidth: 2, backgroundColor: '#fff5f5', elevation: 10 }]}>
              <Text style={{ fontSize: 26, fontWeight: '900', color: '#e74c3c', textAlign: 'center', marginBottom: 10 }}>⚠️ CRITICAL SETUP</Text>
              <Text style={{ fontSize: 16, color: '#000', fontWeight: 'bold', marginBottom: 15, textAlign: 'center' }}>
                Android blocks background sirens and SOS alerts to save battery.
              </Text>
              <Text style={{ fontSize: 14, color: '#444', marginBottom: 20, lineHeight: 22, textAlign: 'center' }}>
                To save your life in an emergency, you <Text style={{fontWeight: 'bold', color: '#e74c3c'}}>MUST</Text> allow RESCUEN to run in the background.
              </Text>
              
              <View style={{ backgroundColor: '#ffffff', padding: 15, borderRadius: 10, marginBottom: 20, borderWidth: 1, borderColor: '#ccc' }}>
                <Text style={{ fontWeight: 'bold', color: '#e74c3c', marginBottom: 5 }}>STEP 1:</Text>
                <Text style={{ color: '#333', fontSize: 13, marginBottom: 15, fontWeight: 'bold' }}>Tap below → Go to "Battery" → Select "Unrestricted" (No Restrictions). Also turn ON "Auto-Start".</Text>
                <TouchableOpacity style={[styles.btn, { backgroundColor: '#000', elevation: 5 }]} onPress={() => Linking.openSettings()}>
                  <Text style={styles.btnText}>⚙️ OPEN SETTINGS</Text>
                </TouchableOpacity>
              </View>

              <View style={{ backgroundColor: '#ffffff', padding: 15, borderRadius: 10, borderWidth: 1, borderColor: '#ccc' }}>
                <Text style={{ fontWeight: 'bold', color: '#27ae60', marginBottom: 5 }}>STEP 2:</Text>
                <Text style={{ color: '#333', fontSize: 13, marginBottom: 15, fontWeight: 'bold' }}>Only click this AFTER you have changed the settings above.</Text>
                <TouchableOpacity style={[styles.btn, { backgroundColor: '#27ae60', elevation: 5 }]} onPress={async () => {
                  await AsyncStorage.setItem('battery_fixed', 'yes');
                  setCurrentScreen('Dashboard');
                  checkAndRequestLocation();
                }}>
                  <Text style={styles.btnText}>✅ I HAVE FIXED IT</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {currentScreen === 'Dashboard' && (
            <View style={styles.sosContainer}>
               
               {!hasAllTheTimePermission ? (
                 <View style={[styles.mapBox, { borderColor: '#e74c3c', borderWidth: 2, backgroundColor: '#fff5f5', flex: 1, padding: 15 }]}>
                    <Text style={{fontSize: 22, fontWeight: '900', color: '#e74c3c', textAlign: 'center', marginBottom: 10}}>🚨 ACTION REQUIRED</Text>
                    
                    <Text style={{fontSize: 13, color: '#333', fontWeight: 'bold', textAlign: 'center', marginBottom: 15, lineHeight: 20}}>
                      RESCUEN collects location data to enable live SOS tracking and 1KM radar alerts <Text style={{color: '#e74c3c', fontWeight: '900'}}>even when the app is closed or not in use.</Text>
                    </Text>

                    <TouchableOpacity style={[styles.btn, {width: '100%', backgroundColor: '#e74c3c', marginBottom: 15, height: 55}]} onPress={() => {
                        Linking.openSettings();
                        Alert.alert("Action Required", "Go to Permissions -> Location -> Select 'Allow all the time'.");
                    }}>
                      <Text style={styles.btnText}>⚙️ OPEN SETTINGS</Text>
                    </TouchableOpacity>

                    <ScrollView style={{width: '100%', backgroundColor: '#ffffff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#f5b7b1'}} showsVerticalScrollIndicator={true}>
                       <Text style={{fontSize: 14, color: '#c0392b', fontWeight: '900', marginBottom: 10, textAlign: 'center'}}>
                         🇮🇳 Choose "All the time" in Settings:
                       </Text>
                       
                       <Text style={{fontSize: 12, color: '#555', fontWeight: 'bold'}}>Hindi (हिंदी):</Text>
                       <Text style={{fontSize: 13, color: '#000', marginBottom: 12, fontWeight: 'bold'}}>जान बचाने के लिए, कृपया सेटिंग्स में जाकर लोकेशन को 'All the time' (हर समय) पर सेट करें।</Text>

                       <Text style={{fontSize: 12, color: '#555', fontWeight: 'bold'}}>Bengali (বাংলা):</Text>
                       <Text style={{fontSize: 13, color: '#000', marginBottom: 12, fontWeight: 'bold'}}>জীবন বাঁচাতে, অনুগ্রহ করে সেটিংসে গিয়ে লোকেশন 'All the time' (সবসময়) চালু করুন।</Text>

                       <Text style={{fontSize: 12, color: '#555', fontWeight: 'bold'}}>Marathi (मराठी):</Text>
                       <Text style={{fontSize: 13, color: '#000', marginBottom: 12, fontWeight: 'bold'}}>प्राण वाचवण्यासाठी, कृपया सेटिंग्जमध्ये लोकेशन 'All the time' (नेहमी) चालू करा.</Text>

                       <Text style={{fontSize: 12, color: '#555', fontWeight: 'bold'}}>Telugu (తెలుగు):</Text>
                       <Text style={{fontSize: 13, color: '#000', marginBottom: 12, fontWeight: 'bold'}}>ప్రాణాలను రక్షించడానికి, దయచేసి సెట్టింగ్స్‌లో లొకేషన్‌ను 'All the time' అనుమతించండి.</Text>

                       <Text style={{fontSize: 12, color: '#555', fontWeight: 'bold'}}>Tamil (தமிழ்):</Text>
                       <Text style={{fontSize: 13, color: '#000', marginBottom: 10, fontWeight: 'bold'}}>உயிர்களைக் காப்பாற்ற, அமைப்புகளில் இருப்பிடத்தை 'All the time' அனுமதிக்கவும்.</Text>
                    </ScrollView>
                 </View>
               ) : (
                 <>
                   <View style={styles.mapBox}>
                      <Text style={styles.mapText}>{currentLocationText}</Text>
                      <Text style={styles.locationSubText}>
                        {currentCoords ? `Lat: ${currentCoords.latitude.toFixed(4)} | Lng: ${currentCoords.longitude.toFixed(4)}` : "Connecting to Satellites..."}
                      </Text>
                      <View style={{width: '100%', height: 250, marginTop: 15, borderRadius: 10, overflow: 'hidden', backgroundColor: '#eeeeee', elevation: 2, justifyContent: 'center', alignItems: 'center'}}>
                        {currentCoords ? (
                          <MapView ref={mapRef} provider={PROVIDER_GOOGLE} style={{ flex: 1, width: '100%' }} initialRegion={{ latitude: currentCoords.latitude, longitude: currentCoords.longitude, latitudeDelta: 0.005, longitudeDelta: 0.005 }} showsCompass={true}>
                            <Marker coordinate={currentCoords} title="You are here" description="RESCUEN Safe Zone" pinColor="#004aad" />
                            <Circle center={currentCoords} radius={1000} fillColor="rgba(0, 74, 173, 0.15)" strokeColor="#004aad" strokeWidth={2} />
                          </MapView>
                        ) : (
                          <View style={{alignItems: 'center', justifyContent: 'center'}}>
                            <ActivityIndicator size="large" color="#004aad" />
                            <Text style={{marginTop: 12, color: '#555', fontWeight: 'bold', fontSize: 13}}>Locking Exact Location...</Text>
                          </View>
                        )}
                      </View>
                   </View>
                   
                   <TouchableOpacity style={[styles.followBtn, isFollowMe && styles.followBtnActive]} onPress={toggleFollowMe} activeOpacity={0.85}>
                     <Text style={[styles.followBtnText, isFollowMe && { color: '#fff' }]}>
                       {isFollowMe ? '🛡️  FOLLOW-ME: ON — tap to stop' : '🧭  START FOLLOW-ME (guard my journey)'}
                     </Text>
                   </TouchableOpacity>

                   {isFollowMe && (
                     <View style={styles.followStatus}>
                       <Text style={styles.followStatusText}>{followMeStationarySec > 0 ? '⏱️ Stopped for' : '🟢 Moving — all good'}</Text>
                       {followMeStationarySec > 0 && (
                         <Text style={styles.followTimer}>{formatCallTime(followMeStationarySec)} <Text style={{fontSize: 14, color: '#8a94a6'}}>/ 3:00</Text></Text>
                       )}
                       <Text style={styles.followStatusSub}>If you stay stopped for 3:00, RESCUEN will ask "Are you safe?" — no reply → auto SOS.</Text>
                     </View>
                   )}

                   <View style={styles.panicWrap}>
                     <Animated.View pointerEvents="none" style={[styles.panicPulse, {
                        opacity: sosPulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
                        transform: [{ scale: sosPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }],
                     }]} />
                     <TouchableOpacity style={styles.panicBtn} onLongPress={requestSOS} delayLongPress={2000} activeOpacity={0.85}>
                        <Text style={styles.panicText}>SOS</Text>
                        <Text style={styles.panicHint}>HOLD</Text>
                     </TouchableOpacity>
                   </View>
                   <Text style={styles.instruction}>HOLD BUTTON FOR 2 SECONDS IN DANGER</Text>
                 </>
               )}

            </View>
          )}

          {currentScreen === 'Wellness' && (
            <View>
              <Text style={styles.cardTitle}>💚 Wellness & Safety</Text>
              <Text style={{ color: dark ? '#9aa5b1' : '#666', marginBottom: 16, fontWeight: 'bold', lineHeight: 20 }}>Curated, always-fresh videos & guides to stay safe, strong and healthy — opens on YouTube.</Text>
              {WELLNESS.map(cat => (
                <TouchableOpacity key={cat.q} style={styles.wellCard} activeOpacity={0.75} onPress={() => Linking.openURL('https://www.youtube.com/results?search_query=' + encodeURIComponent(cat.q))}>
                  <Text style={{ fontSize: 30, marginRight: 14 }}>{cat.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.wellTitle}>{cat.title}</Text>
                    <Text style={styles.wellDesc}>{cat.desc}</Text>
                  </View>
                  <Text style={{ color: '#e74c3c', fontWeight: '900', fontSize: 20 }}>▶</Text>
                </TouchableOpacity>
              ))}
              <View style={{ height: 20 }} />
            </View>
          )}

          {currentScreen === 'AIHelp' && (
            <View style={{ flex: 1 }}>
              <View style={styles.chatHeader}>
                 <Text style={styles.chatHeaderTitle}>🤖 RESCUEN AI Assistant</Text>
                 <Text style={styles.chatHeaderSub}>Ask about local emergencies or app help</Text>
                 
                 {/* 🔥 THE PERMANENT REPORT BUTTON 🔥 */}
                 <TouchableOpacity 
                   style={{backgroundColor: '#e74c3c', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 20, marginTop: 15, elevation: 3, flexDirection: 'row', alignItems: 'center'}}
                   onPress={() => setShowReportForm(true)}
                 >
                   <Text style={{color: '#fff', fontWeight: '900', fontSize: 14}}>🚨 REPORT ISSUE / CONTACT SUPPORT</Text>
                 </TouchableOpacity>
              </View>

              {/* Emergency helplines — always one tap away */}
              <View style={styles.helplineRow}>
                {[
                  { label: '🚨 Emergency', num: '112' },
                  { label: '👩 Women', num: '1091' },
                  { label: '🚑 Ambulance', num: '108' },
                ].map(h => (
                  <TouchableOpacity key={h.num} style={styles.helplineBtn} onPress={() => Linking.openURL(`tel:${h.num}`)}>
                    <Text style={styles.helplineLabel}>{h.label}</Text>
                    <Text style={styles.helplineNum}>{h.num}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity style={styles.fakeCallBtn} onPress={() => setFakeCallState('incoming')} activeOpacity={0.85}>
                <Text style={styles.fakeCallBtnText}>📞  Fake Call — escape an unsafe moment</Text>
              </TouchableOpacity>

              {showAIChips && (
                <View style={styles.flipkartGridContainer}>
                  {['🚨 SOS History/Details', '📍 How it works?', '⚙️ App Security', '💬 Custom Chat...', '📧 Contact Support / Report'].map(opt => (
                    <TouchableOpacity key={opt} style={styles.flipkartGridBox} onPress={() => handleAIChipSelect(opt)}>
                      <Text style={styles.flipkartGridText}>{opt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={styles.chatContainer}>
                {chatMessages.map((msg, index) => (
                  <View key={index} style={[styles.chatBubble, msg.sender === 'user' ? styles.chatBubbleUser : styles.chatBubbleAI]}>
                    <Text style={[styles.chatText, msg.sender === 'user' ? {color: '#fff'} : {color: dark ? '#e6ebf1' : '#333'}]}>
                      {renderChatText(msg.text)}
                    </Text>
                  </View>
                ))}
                {isAITyping && (
                  <View style={{ alignSelf: 'flex-start', marginLeft: 10, marginBottom: 15, padding: 5 }}>
                    <CustomAILoader />
                  </View>
                )}
              </View>
            </View>
          )}

          {currentScreen === 'ProfileView' && (
            <>
              <View style={styles.profileHero}>
                <TouchableOpacity style={styles.profileAvatar} onPress={pickProfilePhoto} activeOpacity={0.8}>
                  {profileUploading ? <ActivityIndicator color="#004aad" /> : (user.photoURL ? <Image source={{ uri: user.photoURL }} style={{ width: 86, height: 86, borderRadius: 43 }} /> : <Text style={{ fontSize: 42 }}>{user.gender === 'Female' ? '👩' : user.gender === 'Male' ? '👨' : '🧑'}</Text>)}
                  <View style={styles.avatarCam}><Text style={{ fontSize: 12 }}>📷</Text></View>
                </TouchableOpacity>
                <Text style={styles.profileName}>{user.name || 'RESCUEN User'}</Text>
                <Text style={styles.profileEmail}>{user.email}</Text>
                <View style={styles.profileBadge}><Text style={styles.profileBadgeText}>🛡️ Protected by RESCUEN</Text></View>
              </View>
              <View style={styles.profileStatsRow}>
                <View style={styles.profileStat}><Text style={styles.profileStatNum}>{user.familyNumbers?.filter(n=>n&&n.length===10).length || 0}</Text><Text style={styles.profileStatLabel}>Guardians</Text></View>
                <View style={styles.profileStatDivider} />
                <View style={styles.profileStat}><Text style={styles.profileStatNum}>1 KM</Text><Text style={styles.profileStatLabel}>Radar</Text></View>
                <View style={styles.profileStatDivider} />
                <View style={styles.profileStat}><Text style={styles.profileStatNum}>24/7</Text><Text style={styles.profileStatLabel}>Guarded</Text></View>
              </View>
              <TouchableOpacity style={[styles.btn, {marginTop: 22}]} onPress={() => setCurrentScreen('Settings')}>
                <Text style={styles.btnText}>⚙️  SETTINGS & PRIVACY</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, {backgroundColor:'#27ae60', marginTop: 12}]} onPress={handleOpenEditModal}>
                <Text style={styles.btnText}>✏️  EDIT EMERGENCY CONTACTS</Text>
              </TouchableOpacity>
            </>
          )}

          {currentScreen === 'Settings' && (
            <View>
              <View style={styles.settingsHeader}>
                <TouchableOpacity onPress={() => setCurrentScreen('ProfileView')} style={{paddingVertical: 4, paddingRight: 10}}><Text style={styles.settingsBack}>‹ Back</Text></TouchableOpacity>
                <Text style={styles.settingsTitle}>Settings</Text>
                <View style={{width: 60}} />
              </View>

              {renderSetSection('PROFILE', <>
                {renderSetNav('👤', 'Name', () => {}, { value: user.name || '—' })}
                {renderSetNav('📧', 'Email', () => {}, { value: (user.email||'').length>16 ? (user.email.slice(0,14)+'…') : (user.email||'—') })}
                {renderSetNav('📱', 'My phone', () => {}, { value: '+91 '+(user.myPhone||'—') })}
                {renderSetNav('⚧', 'Gender', () => {}, { value: user.gender || '—' })}
                {renderSetNav('✏️', 'Edit emergency contacts', handleOpenEditModal)}
              </>)}

              {renderSetSection('EMERGENCY & SOS', <>
                {renderSetToggle('🚓', 'Auto-alert emergency (112)', 'autoAlertPolice')}
                {renderSetToggle('📢', 'Siren on SOS', 'sirenOnSos')}
                {renderSetToggle('📳', 'Vibration on SOS', 'sosVibration')}
                {renderSetNav('🔊', 'Volume-key triple-press SOS', () => Alert.alert('Volume-Key SOS', 'Always on — triple-press the volume key to trigger SOS, even from a locked screen.'), { value: 'On' })}
                {renderSetToggle('📍', 'Always share live location with family', 'shareLocationFamily')}
                {renderSetToggle('🎥', 'Record video + audio evidence on SOS', 'videoEvidence', 'Silently records video WITH sound (rear + front) to your private Evidence Vault during an SOS')}
                {renderSetNav('🧪', 'Test SOS (safe)', () => {
                  setCurrentScreen('Dashboard');
                  setSafeTest(true);
                  Alert.alert('Safe SOS test 🧪', settings.videoEvidence
                    ? 'Recording evidence now — rear then front camera, saving to your Evidence Vault. NO SMS or alert is sent to anyone. Let it run ~1 minute to capture both cameras, tap "END TEST" when done, then open the Evidence Vault to see the clips.'
                    : 'This is a safe test — no alert is sent. Turn on "Record video + audio evidence" to also test the camera.');
                }, { value: 'Run' })}
              </>)}

              {renderSetSection('SAFE JOURNEY (FOLLOW-ME)', <>
                <View style={styles.setRow}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={styles.setLabel}>🧭  Enable Follow-Me guarding</Text>
                    <Text style={styles.setDesc}>Guards your journey; auto-SOS if you stop unexpectedly</Text>
                  </View>
                  <Switch value={isFollowMe} onValueChange={() => toggleFollowMe()} trackColor={{ true: '#004aad', false: '#d0d5dd' }} thumbColor="#ffffff" />
                </View>
                {renderSetToggle('🗣️', 'Voice "Are you safe?" alerts', 'followMeVoice')}
                {renderSetToggle('🚨', 'Auto-SOS if no response', 'autoSosNoResponse')}
                {renderSetNav('⌛', 'Stationary timeout', () => Alert.alert('Stationary timeout', 'RESCUEN checks on you after 3 minutes of no movement.'), { value: '3 min' })}
              </>)}

              {renderSetSection('PRIVACY & SECURITY', <>
                {renderSetNav('🔐', 'Evidence Vault', () => setCurrentScreen('Vault'))}
                {renderSetToggle('🕶️', 'Hide my location when safe', 'hideLocationWhenSafe', "Only shares location during an active SOS")}
                {renderSetNav('🚫', 'Ignored / dismissed alerts', () => Alert.alert('Ignored alerts', ignoredEmergencies.length ? String(ignoredEmergencies.length)+' hidden' : 'None'))}
                {renderSetNav('📜', 'Privacy policy', () => Linking.openURL('https://sites.google.com/view/rescuen-app-policy/home'))}
                {renderSetNav('🧾', 'Terms & conditions', () => setCurrentScreen('ReadTC'))}
              </>)}

              {renderSetSection('NOTIFICATIONS', <>
                {renderSetToggle('📡', 'Nearby emergency alerts', 'nearbyAlerts')}
                {renderSetToggle('🌅', 'Daily safety tip', 'dailyTip')}
                {renderSetToggle('🔔', 'Notification sound', 'notifSound')}
                {renderSetToggle('📳', 'Notification vibration', 'notifVibration')}
                {renderSetToggle('⭐', 'Review reminder', 'reviewReminder')}
              </>)}

              {renderSetSection('LANGUAGE & REGION', <>
                {renderSetNav('🌐', 'App & voice language', () => setShowLangModal(true), { value: getLang(userLang).name })}
                {renderSetNav('🤖', 'AI assistant language', () => setShowLangModal(true), { value: getLang(userLang).name })}
              </>)}

              {renderSetSection('APPEARANCE', <>
                {renderSetToggle('🌙', 'Dark mode', 'darkMode', 'Switch the app to a dark theme')}
                {renderSetToggle('🎞️', 'Reduce motion', 'reduceMotion', 'Turn off animations like the SOS pulse')}
              </>)}

              {renderSetSection('HELP & ABOUT', <>
                {renderSetNav('🆘', 'Contact support', () => setShowReportForm(true))}
                {renderSetNav('⭐', 'Rate on Play Store', shareApp)}
                {renderSetNav('📤', 'Share RESCUEN', shareApp)}
                {renderSetNav('📸', 'Instagram', () => Linking.openURL('https://www.instagram.com/hello.officialrescuen'))}
                {renderSetNav('💬', 'WhatsApp channel', () => Linking.openURL('https://whatsapp.com/channel/0029Vb7ZOwYJ93wNB8znbq3M'))}
                {renderSetNav('ℹ️', 'About RESCUEN', () => Alert.alert('RESCUEN', 'The Ultimate Personal Safety Companion.\nMade with love in India. 🇮🇳'))}
                {renderSetNav('🏷️', 'App version', () => {}, { value: '2.26.35.85' })}
              </>)}

              {renderSetSection('ACCOUNT', <>
                {renderSetNav('🚪', 'Logout', handleLogout, { danger: true })}
                {renderSetNav('🗑️', 'Delete account', () => setShowDeleteModal(true), { danger: true })}
              </>)}

              <View style={{height: 30}} />
            </View>
          )}

          {currentScreen === 'Vault' && (
            <View>
              <View style={styles.settingsHeader}>
                <TouchableOpacity onPress={() => setCurrentScreen('Settings')} style={{paddingVertical: 4, paddingRight: 10}}><Text style={styles.settingsBack}>‹ Back</Text></TouchableOpacity>
                <Text style={styles.settingsTitle}>🔐 Evidence Vault</Text>
                <View style={{width: 60}} />
              </View>

              {vaultStep === 'loading' && (<View style={styles.centerContainer}><ActivityIndicator size="large" color="#004aad" /></View>)}

              {(vaultStep === 'setPin' || vaultStep === 'confirmPin') && (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>{vaultStep === 'setPin' ? 'Set Vault PIN' : 'Confirm PIN'}</Text>
                  <Text style={{color: dark ? '#9aa5b1' : '#555', marginBottom: 18, fontWeight: 'bold', lineHeight: 20}}>{vaultStep === 'setPin' ? 'Create a 4-digit PIN to lock your private evidence. Only you will ever see it.' : 'Re-enter your PIN to confirm.'}</Text>
                  <TextInput style={[styles.input, {textAlign: 'center', fontSize: 26, letterSpacing: 14}]} keyboardType="number-pad" secureTextEntry maxLength={4} value={vaultPin} onChangeText={(t) => setVaultPin(t.replace(/[^0-9]/g, ''))} placeholder="••••" placeholderTextColor="#ccc" />
                  {vaultError ? <Text style={{color: '#e74c3c', fontWeight: 'bold', marginBottom: 10}}>{vaultError}</Text> : null}
                  <TouchableOpacity style={styles.btn} onPress={vaultStep === 'setPin' ? submitSetPin : submitConfirmPin}><Text style={styles.btnText}>{vaultStep === 'setPin' ? 'NEXT' : 'CONFIRM'}</Text></TouchableOpacity>
                </View>
              )}

              {vaultStep === 'otp' && (
                <View style={styles.card}>
                  {vaultOtpSuccess ? (
                    <OtpSuccess text={"Verified & PIN saved\nsuccessfully!"} />
                  ) : (
                    <>
                      <Text style={styles.cardTitle}>Verify it's you</Text>
                      <Text style={{color: dark ? '#9aa5b1' : '#555', marginBottom: 18, fontWeight: 'bold', lineHeight: 20}}>OTP sent to +91 {user.myPhone} — it fills in automatically.</Text>
                      <OtpInput value={vaultOtp} onChange={setVaultOtp} onComplete={() => verifyVaultOtp()} />
                      {vaultError ? <Text style={{color: '#e74c3c', fontWeight: 'bold', marginBottom: 10, textAlign: 'center'}}>{vaultError}</Text> : null}
                      <TouchableOpacity style={styles.btn} onPress={verifyVaultOtp}><Text style={styles.btnText}>VERIFY & SAVE PIN</Text></TouchableOpacity>
                    </>
                  )}
                </View>
              )}

              {vaultStep === 'enterPin' && (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Enter Vault PIN</Text>
                  <Text style={{color: dark ? '#9aa5b1' : '#555', marginBottom: 18, fontWeight: 'bold'}}>Enter your 4-digit PIN to view your evidence.</Text>
                  <TextInput style={[styles.input, {textAlign: 'center', fontSize: 26, letterSpacing: 14}]} keyboardType="number-pad" secureTextEntry maxLength={4} value={vaultPin} onChangeText={(t) => setVaultPin(t.replace(/[^0-9]/g, ''))} placeholder="••••" placeholderTextColor="#ccc" onSubmitEditing={submitEnterPin} />
                  {vaultError ? <Text style={{color: '#e74c3c', fontWeight: 'bold', marginBottom: 10}}>{vaultError}</Text> : null}
                  <TouchableOpacity style={styles.btn} onPress={submitEnterPin}><Text style={styles.btnText}>🔓 UNLOCK</Text></TouchableOpacity>
                </View>
              )}

              {vaultStep === 'unlocked' && (
                <View>
                  <View style={[styles.card, {marginBottom: 15}]}>
                    <Text style={{fontWeight: '900', color: '#1e7e46', fontSize: 15}}>🔒 Private to you only</Text>
                    <Text style={{color: dark ? '#9aa5b1' : '#666', fontSize: 12.5, marginTop: 5, lineHeight: 18}}>Your SOS recordings & captured evidence. No other user — not even RESCUEN staff — can open these. Stored securely under your account.</Text>
                  </View>
                  {vaultLoading ? <ActivityIndicator size="large" color="#004aad" style={{marginTop: 20}} /> : (
                    vaultItems.length === 0 ? (
                      <View style={styles.card}><Text style={{textAlign: 'center', color: dark ? '#9aa5b1' : '#888', fontWeight: 'bold', lineHeight: 20}}>No evidence yet.{"\n"}It will appear here automatically after an SOS or Follow-Me alert.</Text></View>
                    ) : (
                      vaultItems.map((it, idx) => {
                        const meta = evidenceMeta(it.typeStr);
                        return (
                        <TouchableOpacity key={idx} style={styles.vaultItem} activeOpacity={0.75} onPress={async () => { try { const url = await it.ref.getDownloadURL(); Linking.openURL(url); } catch (e) { Alert.alert('Error', 'Could not open this file.'); } }}>
                          <View style={{width: 46, height: 46, borderRadius: 12, backgroundColor: meta.color + (dark ? '33' : '1A'), justifyContent: 'center', alignItems: 'center', marginRight: 13}}>
                            <Text style={{fontSize: 22}}>{meta.icon}</Text>
                          </View>
                          <View style={{flex: 1}}>
                            <View style={{flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap'}}>
                              <Text style={{fontWeight: '800', fontSize: 14.5, color: dark ? '#e6ebf1' : '#1a2233', marginRight: 8}}>{meta.label}</Text>
                              {meta.cam ? <View style={{backgroundColor: meta.color, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2}}><Text style={{color: '#fff', fontSize: 9.5, fontWeight: '800'}}>{meta.cam.toUpperCase()}</Text></View> : null}
                            </View>
                            <Text style={{fontSize: 12, color: dark ? '#9aa5b1' : '#7a8699', marginTop: 3, fontWeight: '600'}}>🕒 {fmtEvidenceTime(it.ts)}</Text>
                          </View>
                          <Text style={{color: '#004aad', fontWeight: '800', fontSize: 13}}>Open ›</Text>
                        </TouchableOpacity>
                        );
                      })
                    )
                  )}
                  <TouchableOpacity style={[styles.btn, {backgroundColor: '#34495e', marginTop: 15}]} onPress={loadEvidence}><Text style={styles.btnText}>🔄 REFRESH</Text></TouchableOpacity>
                  <View style={{height: 30}} />
                </View>
              )}
            </View>
          )}

        </ScrollView>
      )}

      {currentScreen === 'AIHelp' && !showAIChips && (
        <View style={styles.chatInputBox}>
          <TextInput 
            style={styles.chatInput} 
            placeholder="Type your message..." 
            placeholderTextColor="#888888"
            value={chatInput}
            onChangeText={setChatInput}
            onSubmitEditing={() => handleSendChatMessage(null, false)}
          />
          <TouchableOpacity style={styles.chatSendBtn} onPress={() => handleSendChatMessage(null, false)}>
            <Text style={{color: '#fff', fontWeight: 'bold'}}>SEND</Text>
          </TouchableOpacity>
        </View>
      )}

      {(currentScreen === 'Dashboard' || currentScreen === 'ProfileView' || currentScreen === 'AIHelp' || currentScreen === 'Settings' || currentScreen === 'Vault' || currentScreen === 'Wellness') && (
        <View style={styles.footer}>
          <TouchableOpacity style={[styles.tab, currentScreen==='Dashboard' && styles.tabActive]} onPress={() => setCurrentScreen('Dashboard')}>
            <Text numberOfLines={1} style={[styles.tabText, currentScreen==='Dashboard' && {color:'#004aad'}]}>🏠 HOME</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, currentScreen==='Wellness' && styles.tabActive]} onPress={() => setCurrentScreen('Wellness')}>
            <Text numberOfLines={1} style={[styles.tabText, currentScreen==='Wellness' && {color:'#004aad'}]}>💚 HEALTH</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, currentScreen==='AIHelp' && styles.tabActive]} onPress={() => setCurrentScreen('AIHelp')}>
            <Text numberOfLines={1} style={[styles.tabText, currentScreen==='AIHelp' && {color:'#004aad'}]}>🤖 AI HELP</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, (currentScreen==='ProfileView'||currentScreen==='Settings'||currentScreen==='Vault') && styles.tabActive]} onPress={() => setCurrentScreen('ProfileView')}>
            <Text numberOfLines={1} style={[styles.tabText, (currentScreen==='ProfileView'||currentScreen==='Settings'||currentScreen==='Vault') && {color:'#004aad'}]}>👤 PROFILE</Text>
          </TouchableOpacity>

          {/* 🔥 SECRET GOD MODE TAB (ONLY FOR ADMIN) 🔥 */}
          {user.email === 'rescuensupport@gmail.com' && (
            <TouchableOpacity style={styles.tab} onPress={() => Linking.openURL('https://console.firebase.google.com/')}>
              <Text style={[styles.tabText, {color:'#e67e22', fontWeight: '900'}]}>👑 ADMIN</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <Modal visible={isSOSActive || safeTest} transparent animationType="fade">
        <View style={[styles.modalBg, {backgroundColor: safeTest ? 'rgba(41, 128, 185, 0.96)' : 'rgba(231, 76, 60, 0.95)', paddingTop: insets.top, paddingBottom: insets.bottom}]}>
          <Text style={{fontSize: 28, fontWeight: '900', color: '#ffffff', marginBottom: 10, textAlign: 'center'}}>{safeTest ? '🧪 SAFE TEST' : '🚨 SOS ACTIVE 🚨'}</Text>
          {safeTest ? <Text style={{fontSize: 13, fontWeight: '800', color: '#fff', marginBottom: 12, textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.25)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20}}>No alert is sent to anyone — evidence recording only</Text> : null}

          <View style={{width: '95%', height: Dimensions.get('window').height * 0.40, borderRadius: 15, overflow: 'hidden', marginBottom: 15, borderWidth: 3, borderColor: '#fff'}}>
            {currentCoords ? (
               <MapView provider={PROVIDER_GOOGLE} style={{flex: 1}} initialRegion={{latitude: currentCoords.latitude, longitude: currentCoords.longitude, latitudeDelta: 0.015, longitudeDelta: 0.015}}>
                  <Marker coordinate={currentCoords} title="You" description="Your live location" pinColor="blue" />
                  <Circle center={currentCoords} radius={1000} fillColor="rgba(231, 76, 60, 0.2)" strokeColor="#fff" />
                  {victimMapHelpers.map((helper, idx) => (
                     <Marker key={idx} coordinate={helper.lastKnownLocation} title={helper.name} description={`${(helper.dist/1000).toFixed(2)} km away`} pinColor="green" />
                  ))}
               </MapView>
            ) : (
              <View style={{flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#333'}}>
                <ActivityIndicator size="large" color="#fff" />
                <Text style={{color: '#fff', marginTop: 10, fontWeight: 'bold'}}>Loading Radar...</Text>
              </View>
            )}
          </View>

          <View style={{flexDirection: 'row', justifyContent: 'space-between', width: '95%', marginBottom: 10}}>
              <View style={{backgroundColor: '#fff', padding: 10, borderRadius: 10, width: '48%', alignItems: 'center'}}>
                  <Text style={{fontSize: 10, color: '#555', fontWeight: 'bold'}}>NEARBY USERS ALERTED</Text>
                  <Text style={{fontSize: 22, color: '#e74c3c', fontWeight: '900'}}>{broadcastMetrics.totalNotified}</Text>
              </View>
              <View style={{backgroundColor: '#fff', padding: 10, borderRadius: 10, width: '48%', alignItems: 'center'}}>
                  <Text style={{fontSize: 10, color: '#555', fontWeight: 'bold'}}>HELPERS COMING</Text>
                  <Text style={{fontSize: 22, color: '#2ecc71', fontWeight: '900'}}>{broadcastMetrics.helpers}</Text>
              </View>
          </View>

          <View style={{backgroundColor: '#ffffff', padding: 15, borderRadius: 15, width: '95%', marginBottom: 20, elevation: 10}}>
            <Text style={{fontSize: 16, fontWeight: '900', color: safeTest ? '#2980b9' : '#e74c3c', textAlign: 'center', marginBottom: 10}}>{safeTest ? '🧪 TEST STATUS' : '📡 BROADCAST STATUS'}</Text>
            {safeTest ? (
              <>
                <Text style={styles.statusText}>{settings.videoEvidence ? '✅ Recording audio + video (rear ↔ front)' : '⚠️ Video evidence is OFF'}</Text>
                <Text style={styles.statusText}>🔒 Saving to your private Evidence Vault</Text>
                <Text style={styles.statusText}>🚫 No SMS / broadcast sent</Text>
              </>
            ) : (
              <>
                <Text style={styles.statusText}>✅ 1 KM radar scanning live</Text>
                <Text style={styles.statusText}>✅ Family SMS sent silently</Text>
                {settings.autoAlertPolice ? <Text style={styles.statusText}>✅ Emergency SMS sent (112)</Text> : null}
                <Text style={styles.statusText}>{settings.videoEvidence ? '✅ Recording audio + video evidence' : '✅ Recording audio evidence'}</Text>
              </>
            )}
          </View>

          <TouchableOpacity style={[styles.deactivateBtn, safeTest && {backgroundColor: '#2980b9', borderColor: '#fff'}]} onPress={() => { if (safeTest) { setSafeTest(false); } else { deactivateSOS(); } }}>
            <Text style={{color: '#ffffff', fontSize: 18, fontWeight: '900', letterSpacing: 1}}>{safeTest ? '✅ END TEST' : '🛑 DEACTIVATE ALARM'}</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal visible={showHeroModal && !isSOSActive} transparent animationType="slide" onRequestClose={() => {}}>
        <View style={[styles.modalBg, {backgroundColor: 'rgba(0, 0, 0, 0.95)', paddingTop: insets.top, paddingBottom: insets.bottom}]}>
          
          <View style={{width: '100%', backgroundColor: '#ffffff', padding: 15, borderRadius: 15, marginBottom: 15, elevation: 5}}>
            <Text style={{fontSize: 22, fontWeight: '900', color: '#e74c3c', textAlign: 'center', marginBottom: 5}}>🚨 EMERGENCY NEARBY</Text>
            
            <View style={{flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: 1, borderColor: '#eee', paddingTop: 10}}>
              <View style={{alignItems: 'center'}}>
                <Text style={{fontSize: 12, color: '#666', fontWeight: 'bold'}}>DISTANCE</Text>
                <Text style={{fontSize: 18, fontWeight: 'bold', color: '#000'}}>
                  {nearbyEmergency && currentCoords ? (getDistance(currentCoords, nearbyEmergency.location) / 1000).toFixed(2) : '0.00'} km
                </Text>
              </View>
              
              <View style={{alignItems: 'center'}}>
                <Text style={{fontSize: 12, color: '#666', fontWeight: 'bold'}}>ETA</Text>
                <Text style={{fontSize: 18, fontWeight: 'bold', color: '#2ecc71'}}>
                  {nearbyEmergency && currentCoords ? Math.ceil((getDistance(currentCoords, nearbyEmergency.location) / 1000) / 0.5) : '--'} min
                </Text>
              </View>

              <View style={{alignItems: 'center'}}>
                <Text style={{fontSize: 12, color: '#666', fontWeight: 'bold'}}>YOUR SPEED</Text>
                <Text style={{fontSize: 18, fontWeight: 'bold', color: '#3498db'}}>
                  {currentCoords?.speed ? (currentCoords.speed * 3.6).toFixed(0) : '0'} km/h
                </Text>
              </View>
            </View>
          </View>

          <View style={{width: '100%', flex: 1, borderRadius: 20, overflow: 'hidden', borderWidth: 2, borderColor: '#ffffff', marginBottom: 15}}>
            {nearbyEmergency && nearbyEmergency.location && currentCoords ? (
              <MapView 
                provider={PROVIDER_GOOGLE} 
                style={{ flex: 1 }} 
                initialRegion={{
                  latitude: (currentCoords.latitude + nearbyEmergency.location.latitude) / 2,
                  longitude: (currentCoords.longitude + nearbyEmergency.location.longitude) / 2,
                  latitudeDelta: Math.abs(currentCoords.latitude - nearbyEmergency.location.latitude) * 2.5 || 0.01,
                  longitudeDelta: Math.abs(currentCoords.longitude - nearbyEmergency.location.longitude) * 2.5 || 0.01,
                }}
              >
                <Marker coordinate={nearbyEmergency.location} title="Victim" pinColor="red" />
                <Marker coordinate={currentCoords} title="You (Rescuer)" pinColor="blue" />
                
                <Polyline
                  coordinates={[currentCoords, nearbyEmergency.location]}
                  strokeColor="#3498db" 
                  strokeWidth={4}
                  lineDashPattern={[10, 10]}
                />
              </MapView>
            ) : (
              <View style={{flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#eeeeee'}}>
                 <ActivityIndicator size="large" color="#e74c3c" />
              </View>
            )}
          </View>

          <TouchableOpacity 
            style={[styles.btn, {backgroundColor: isHelperRegistered ? '#e74c3c' : '#4285F4', width: '100%', marginBottom: 10, height: 60, flexDirection: 'row', justifyContent: 'center', alignItems: 'center'}]}
            disabled={isHelperRegistered}
            onPress={() => {
              if (nearbyEmergency?.user?.email) {
                if (isHelperRegistered) {
                  try {
                    firestore().collection('active_emergencies').doc(nearbyEmergency.user.email)
                       .update({ activeHelpers: firestore.FieldValue.arrayRemove(user.email) }).catch(()=>{});
                  } catch(e){}
                  setIsHelperRegistered(false);
                  Alert.alert("Mission Aborted", "You have cancelled your help request. Another nearby user will be notified.");
                } else {
                  try {
                    firestore().collection('active_emergencies').doc(nearbyEmergency.user.email)
                       .update({ activeHelpers: firestore.FieldValue.arrayUnion(user.email) }).catch(()=>{});
                  } catch(e){}
                  setIsHelperRegistered(true);
                  Alert.alert("Hero Mode", "Your live location is now prioritized for the victim. Please reach quickly.");
                }
              }
            }}
          >
            <Text style={[styles.btnText, {fontSize: 16}]}>
              {isHelperRegistered ? "✅ YOU ARE REGISTERED AS A HELPER" : "🦸‍♂️ I AM GOING TO HELP THIS PERSON"}
            </Text>
          </TouchableOpacity>

          <View style={{backgroundColor: '#ffffff', padding: 12, borderRadius: 12, width: '100%', marginBottom: 15}}>
            <TouchableOpacity style={{flexDirection: 'row', alignItems: 'center'}} onPress={() => setIsAcknowledged(!isAcknowledged)}>
              <View style={{width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: isAcknowledged ? '#e74c3c' : '#ccc', backgroundColor: isAcknowledged ? '#e74c3c' : 'transparent', justifyContent: 'center', alignItems: 'center', marginRight: 10}}>
                {isAcknowledged && <Text style={{color: '#fff', fontWeight: 'bold'}}>✓</Text>}
              </View>
              <Text style={{fontSize: 13, color: '#333', fontWeight: 'bold', flex: 1}}>I acknowledge this emergency and take responsibility.</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity 
            style={{backgroundColor: isAcknowledged ? '#e74c3c' : '#555', padding: 15, borderRadius: 12, width: '100%', alignItems: 'center', opacity: isAcknowledged ? 1 : 0.5}} 
            disabled={!isAcknowledged} 
            onPress={() => { 
              try {
                if (nearbyEmergency) { 
                   setIgnoredEmergencies([...ignoredEmergencies, nearbyEmergency.user.email]);
                   firestore().collection('active_emergencies').doc(nearbyEmergency.user.email)
                      .update({ 
                         notifiedUsers: firestore.FieldValue.arrayRemove(user.email),
                         activeHelpers: firestore.FieldValue.arrayRemove(user.email)
                      }).catch(()=>{});
                } 
                setShowHeroModal(false); 
                setIsAcknowledged(false);
                setIsHelperRegistered(false); 
                if(sirenSound.current) { try{sirenSound.current.stop();}catch(e){} } 
              } catch(e){}
            }}
          >
            <Text style={styles.btnText}>DISMISS ALERT</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal visible={showDeleteModal} transparent animationType="fade">
        <View style={[styles.modalBg, {paddingTop: insets.top, paddingBottom: insets.bottom}]}>
          <View style={[styles.card, {width: '90%'}]}>
            <Text style={[styles.cardTitle, {color: '#e74c3c'}]}>Delete Account?</Text>
            <Text style={{fontSize: 14, color: dark ? '#c3ccd6' : '#444', marginBottom: 20, lineHeight: 22}}>Your account will be suspended and scheduled for permanent deletion after 30 days. To cancel this request later, simply log back in within 30 days.{"\n\n"}Type <Text style={{fontWeight: 'bold', color: '#e74c3c'}}>DELETE</Text> below to confirm.</Text>
            <TextInput style={[styles.input, {borderColor: '#e74c3c', borderWidth: 2}]} placeholder="Type DELETE here" placeholderTextColor="#888888" value={deleteInputText} onChangeText={setDeleteInputText} autoCapitalize="characters" />
            <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 20}}>
              <TouchableOpacity style={[styles.btn, {flex: 0.45, backgroundColor: '#888', marginTop: 0}]} onPress={() => { setShowDeleteModal(false); setDeleteInputText(''); }}><Text style={styles.btnText}>CANCEL</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.btn, {flex: 0.45, backgroundColor: '#e74c3c', marginTop: 0, opacity: deleteInputText === 'DELETE' ? 1 : 0.5}]} onPress={handleConfirmDelete} disabled={deleteInputText !== 'DELETE' || isLoading}>{isLoading ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.btnText}>CONFIRM</Text>}</TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showEditModal} transparent animationType="fade">
        <View style={[styles.modalBg, {paddingTop: insets.top, paddingBottom: insets.bottom}]}>
          <View style={[styles.card, {width: '90%'}]}>
            {editOtpStep === 'otp' ? (
              <>
                <Text style={styles.cardTitle}>Verify New Number</Text>
                <Text style={{color: dark ? '#9aa5b1' : '#555', marginBottom: 16, fontWeight: 'bold', lineHeight: 20}}>OTP sent to +91 {editData.myPhone} — it fills in automatically.</Text>
                <OtpInput value={editOtp} onChange={setEditOtp} onComplete={() => verifyEditOtp()} />
                {editError ? <Text style={{color: '#e74c3c', fontWeight: 'bold', marginBottom: 10, textAlign: 'center'}}>{editError}</Text> : null}
                <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 6}}>
                  <TouchableOpacity style={[styles.btn, {flex: 0.45, backgroundColor: '#888', marginTop: 0}]} onPress={() => { setEditOtpStep('form'); setEditError(''); }}><Text style={styles.btnText}>BACK</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.btn, {flex: 0.45, backgroundColor: '#2ecc71', marginTop: 0}]} onPress={verifyEditOtp} disabled={isLoading}>{isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>VERIFY</Text>}</TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.cardTitle}>Edit Emergency Contacts</Text>
                <Text style={{fontSize: 12.5, color: '#e74c3c', marginBottom: 14, fontWeight: 'bold', lineHeight: 18}}>Family numbers: add / edit / remove anytime. Your OWN number: OTP-verified & changeable once every 60 days.</Text>

                <Text style={styles.label}>MY PHONE (verified)</Text>
                <TextInput style={styles.input} value={editData.myPhone} placeholder="10-digit number" placeholderTextColor="#888888" keyboardType="numeric" maxLength={10} onChangeText={(t) => setEditData({...editData, myPhone: t.replace(/[^0-9]/g, '').slice(0, 10)})} />

                <ScrollView style={{maxHeight: 210}}>
                  <Text style={styles.label}>FAMILY CONTACTS (1 required, up to 5)</Text>
                  {editData.familyNumbers.map((num, index) => (
                    <View key={index} style={{flexDirection: 'row', alignItems: 'center'}}>
                      <TextInput
                        style={[styles.input, {flex: 1, marginBottom: 10}]}
                        value={num}
                        placeholder={index === 0 ? "Mandatory 10-digit number" : "Optional 10-digit number"}
                        placeholderTextColor="#888888"
                        keyboardType="numeric"
                        maxLength={10}
                        onChangeText={(t) => handleEditFamilyNumChange(t, index)}
                      />
                      {index > 0 && (
                        <TouchableOpacity onPress={() => removeEditFamilyNumber(index)} style={{padding: 12, marginLeft: 4}}>
                          <Text style={{color: '#e74c3c', fontWeight: 'bold', fontSize: 20}}>✕</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                  {editData.familyNumbers.length < 5 && (
                    <TouchableOpacity onPress={addEditFamilyNumber} style={{alignItems: 'flex-start', marginBottom: 8}}>
                      <Text style={{color: '#3498db', fontWeight: 'bold', fontSize: 13}}>+ ADD ANOTHER NUMBER</Text>
                    </TouchableOpacity>
                  )}
                </ScrollView>

                <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 10}}>
                  <TouchableOpacity style={[styles.btn, {flex: 0.45, backgroundColor: '#888', marginTop: 0}]} onPress={() => setShowEditModal(false)}>
                    <Text style={styles.btnText}>CANCEL</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.btn, {flex: 0.45, backgroundColor: '#2ecc71', marginTop: 0}]} onPress={saveEditedNumbers} disabled={isLoading}>
                    {isLoading ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.btnText}>SAVE</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Follow-Me "Are you safe?" prompt — always lets the user cancel the auto-SOS */}
      <Modal visible={showSafeCheck && !isSOSActive} transparent animationType="fade">
        <View style={[styles.modalBg, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={[styles.card, { width: '90%', borderColor: '#e74c3c', borderWidth: 2 }]}>
            <Text style={{ fontSize: 24, fontWeight: '900', color: '#e74c3c', textAlign: 'center', marginBottom: 12 }}>⚠️ ARE YOU SAFE?</Text>
            <View style={{ alignSelf: 'center', width: 96, height: 96, borderRadius: 48, borderWidth: 5, borderColor: safeCheckCountdown <= 10 ? '#e74c3c' : '#f39c12', justifyContent: 'center', alignItems: 'center', marginBottom: 14 }}>
              <Text style={{ fontSize: 40, fontWeight: '900', color: safeCheckCountdown <= 10 ? '#e74c3c' : '#f39c12' }}>{safeCheckCountdown}</Text>
            </View>
            <Text style={{ fontSize: 15, color: dark ? '#e6ebf1' : '#333', textAlign: 'center', marginBottom: 20, lineHeight: 22, fontWeight: 'bold' }}>
              You've been stopped for a while. SOS auto-activates in {safeCheckCountdown}s. Tap "I'M SAFE" to cancel.
            </Text>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: '#2ecc71', height: 60 }]}
              onPress={() => { try { SafeJourneyEngine.dismissWarning(); } catch (e) {} setShowSafeCheck(false); setFollowMeStationarySec(0); followMeRefPos.current = lastCoordsRef.current; followMeMoveCount.current = 0; }}
            >
              <Text style={styles.btnText}>✅ I'M SAFE</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: '#e74c3c', marginTop: 12 }]}
              onPress={() => { try { SafeJourneyEngine.dismissWarning(); } catch (e) {} setShowSafeCheck(false); triggerSOS(); }}
            >
              <Text style={styles.btnText}>🚨 I NEED HELP NOW</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Language picker */}
      <Modal visible={showLangModal} transparent animationType="fade" onRequestClose={() => setShowLangModal(false)}>
        <View style={[styles.modalBg, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={[styles.card, { width: '88%' }]}>
            <Text style={styles.cardTitle}>Choose Language</Text>
            <Text style={{ color: dark ? '#9aa5b1' : '#666', marginBottom: 12, fontWeight: 'bold', lineHeight: 19 }}>The app, AI assistant and the safety voice will use this language.</Text>
            {LANGS.map(l => (
              <TouchableOpacity key={l.code} style={[styles.langRow, userLang === l.code && styles.langRowActive]} onPress={() => updateLang(l.code)}>
                <Text style={[styles.langName, userLang === l.code && { color: '#004aad', fontWeight: '900' }]}>{l.name}</Text>
                {userLang === l.code ? <Text style={{ color: '#004aad', fontWeight: '900', fontSize: 16 }}>✓</Text> : null}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[styles.btn, { backgroundColor: '#888', marginTop: 14 }]} onPress={() => setShowLangModal(false)}><Text style={styles.btnText}>CLOSE</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Fake Call — a decoy incoming call to exit an unsafe situation */}
      <Modal visible={fakeCallState !== 'none'} animationType="slide" onRequestClose={() => setFakeCallState('none')}>
        <View style={styles.callScreen}>
          <View style={{ alignItems: 'center', marginTop: 80 }}>
            <View style={styles.callAvatar}><Text style={{ fontSize: 52 }}>👩</Text></View>
            <Text style={styles.callName}>Mom</Text>
            <Text style={styles.callStatus}>
              {fakeCallState === 'incoming' ? 'Incoming call…' : `Ongoing   ${formatCallTime(fakeCallSecs)}`}
            </Text>
          </View>
          <View style={styles.callActions}>
            {fakeCallState === 'incoming' ? (
              <>
                <TouchableOpacity style={[styles.callCircle, { backgroundColor: '#e74c3c' }]} onPress={() => setFakeCallState('none')}>
                  <Text style={styles.callCircleIcon}>✕</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.callCircle, { backgroundColor: '#2ecc71' }]} onPress={() => setFakeCallState('active')}>
                  <Text style={styles.callCircleIcon}>📞</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={[styles.callCircle, { backgroundColor: '#e74c3c' }]} onPress={() => setFakeCallState('none')}>
                <Text style={styles.callCircleIcon}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* 🔥 THE PREMIUM REPORT FORM MODAL 🔥 */}
      <Modal visible={showReportForm} transparent animationType="slide">
        <View style={[styles.modalBg, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={[styles.card, { width: '90%' }]}>
            <Text style={[styles.cardTitle, { color: '#004aad', marginBottom: 15 }]}>Contact Support</Text>
            
            <Text style={styles.label}>FULL NAME *</Text>
            <TextInput 
              style={styles.input} 
              placeholder="Enter your name" 
              placeholderTextColor="#888"
              value={reportData.name}
              onChangeText={(t) => setReportData({ ...reportData, name: t })}
            />

            <Text style={styles.label}>EMAIL ADDRESS *</Text>
            <TextInput 
              style={styles.input} 
              placeholder="Enter your email" 
              placeholderTextColor="#888"
              keyboardType="email-address"
              autoCapitalize="none"
              value={reportData.email}
              onChangeText={(t) => setReportData({ ...reportData, email: t })}
            />

            <Text style={styles.label}>PHONE NUMBER *</Text>
            <TextInput 
              style={styles.input} 
              placeholder="10-digit number" 
              placeholderTextColor="#888"
              keyboardType="numeric"
              maxLength={10}
              value={reportData.phone}
              onChangeText={(t) => setReportData({ ...reportData, phone: t.replace(/[^0-9]/g, '') })}
            />

            <Text style={styles.label}>YOUR MESSAGE *</Text>
            <TextInput 
              style={[styles.input, { height: 100, textAlignVertical: 'top', paddingTop: 15 }]} 
              placeholder="Describe your issue or report..." 
              placeholderTextColor="#888"
              multiline={true}
              value={reportData.message}
              onChangeText={(t) => setReportData({ ...reportData, message: t })}
            />

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
              <TouchableOpacity 
                style={[styles.btn, { flex: 0.45, backgroundColor: '#888', marginTop: 0 }]} 
                onPress={() => {
                  setShowReportForm(false);
                  setReportData({ name: '', email: '', phone: '', message: '' }); 
                }}
              >
                <Text style={styles.btnText}>CANCEL</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.btn, { flex: 0.45, backgroundColor: '#004aad', marginTop: 0 }]} 
                disabled={isSendingReport}
                onPress={async () => {
                  // Only the essentials — don't strictly validate the number/email.
                  if (!reportData.name.trim() || !reportData.email.trim() || !reportData.message.trim()) {
                    return Alert.alert("Required Fields", "Please enter your name, email and message.");
                  }

                  setIsSendingReport(true);
                  try {
                    const sendReportEmail = functions().httpsCallable('sendSupportEmail');
                    const response = await sendReportEmail(reportData);

                    if (response.data && response.data.success) {
                      Alert.alert("Message Sent ✅", "Thank you! Our team has received your message and will get back to you within 1–2 working days. A confirmation has been emailed to you.");
                      setShowReportForm(false);
                      setReportData({ name: '', email: '', phone: '', message: '' });
                    } else {
                      Alert.alert("Couldn't Send", (response.data && response.data.error) === 'Email support is not configured yet.' ? "Support email isn't set up yet. Please try again later." : "Could not send the message. Please try again.");
                    }
                  } catch (error) {
                    Alert.alert("Network Error", "Please check your internet connection.");
                  } finally {
                    setIsSendingReport(false);
                  }
                }}
              >
                {isSendingReport ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.btnText}>SEND MESSAGE</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
};

const makeStyles = (dark) => {
  // Color tokens. Light values are IDENTICAL to the original design so light
  // mode looks exactly as before; dark values are the night-mode equivalents.
  const C = dark ? {
    screen: '#0b1016', content: '#0b1016', card: '#161d26', card2: '#1e2732',
    border: '#2a3542', divider: '#243040', text: '#e6ebf1', title: '#f5f8fc', sub: '#9aa5b1',
    input: '#1a222c', inputBorder: '#33404e', header: '#12181f', footer: '#12181f',
    tabActive: '#1c2a3f', chip: '#1a222c', tcBg: '#12181f', tcBorder: '#2a3542',
  } : {
    screen: '#ffffff', content: '#f4f7f6', card: '#ffffff', card2: '#f9f9f9',
    border: '#eef1f5', divider: '#eef1f5', text: '#1a2233', title: '#0a2540', sub: '#8a94a6',
    input: '#ffffff', inputBorder: '#cccccc', header: '#ffffff', footer: '#ffffff',
    tabActive: '#eef3ff', chip: '#ffffff', tcBg: '#f9f9f9', tcBorder: '#eeeeee',
  };
  return StyleSheet.create({
  main: { flex: 1, backgroundColor: C.screen },
  header: { height: 72, backgroundColor: C.header, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, elevation: 6, zIndex: 10, width: '100%', shadowColor: '#0a2540', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.10, shadowRadius: 10, borderBottomWidth: 0.5, borderBottomColor: C.divider },
  logo: { width: 40, height: 40, marginRight: 15, borderRadius: 5 },
  headerTitle: { fontSize: 24, fontWeight: '900', color: '#004aad', letterSpacing: 1 },
  headerIconsContainer: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  socialIcon: { width: 28, height: 28, marginLeft: 20 },
  scrollContent: { padding: 20, flexGrow: 1, justifyContent: 'flex-start', backgroundColor: C.content },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 100 }, 
  warningBox: { width: '100%', backgroundColor: '#ffeaa7', padding: 15, borderRadius: 10, borderWidth: 1, borderColor: '#f1c40f', marginBottom: 20, alignItems: 'center' },
  warningText: { color: '#d35400', fontWeight: 'bold', textAlign: 'center', fontSize: 13, lineHeight: 20 },
  card: { backgroundColor: C.card, padding: 25, borderRadius: 22, elevation: 5, shadowColor: '#0a2540', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 18 },
  cardTitle: { fontSize: 26, fontWeight: '800', marginBottom: 5, color: C.title },
  label: { fontSize: 12, color: C.sub, marginBottom: 8, fontWeight: 'bold', marginTop: 10 },
  input: { backgroundColor: C.input, height: 55, borderRadius: 12, paddingHorizontal: 20, borderWidth: 1, borderColor: C.inputBorder, marginBottom: 15, fontSize: 15, color: C.text, fontWeight: 'bold' },
  genderRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 25 },
  gBtn: { flex: 1, padding: 15, borderWidth: 1, borderColor: C.inputBorder, borderRadius: 12, alignItems: 'center', marginHorizontal: 4, backgroundColor: C.input },
  gActive: { backgroundColor: '#004aad', borderColor: '#004aad' },
  gText: { fontWeight: 'bold', color: C.text },
  btn: { backgroundColor: '#004aad', padding: 18, borderRadius: 14, alignItems: 'center', elevation: 3, marginTop: 10, shadowColor: '#004aad', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.28, shadowRadius: 10 },
  btnText: { color: '#ffffff', fontSize: 16, fontWeight: '800', letterSpacing: 1 },
  tcBox: { height: 180, backgroundColor: C.tcBg, padding: 15, borderRadius: 12, marginBottom: 20, borderWidth: 1.5, borderColor: C.tcBorder },
  tcText: { fontSize: 13, color: C.text, lineHeight: 22 },
  checkRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 25, alignSelf: 'center', marginTop: 15 },
  checkbox: { width: 22, height: 22, borderWidth: 2, borderColor: '#004aad', borderRadius: 6, marginRight: 12, backgroundColor: C.input },
  checked: { backgroundColor: '#004aad' },
  checkLabel: { fontSize: 13, fontWeight: 'bold', color: '#004aad' },
  sosContainer: { alignItems: 'center', marginTop: 20, backgroundColor: C.content, flex: 1 },
  mapBox: { width: '100%', padding: 20, backgroundColor: C.card, borderRadius: 18, marginBottom: 26, alignItems: 'center', elevation: 4, borderWidth: 1, borderColor: C.border, shadowColor: '#0a2540', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 14 },
  mapText: { fontSize: 18, fontWeight: 'bold', color: '#2ecc71' },
  locationSubText: { fontSize: 13, color: C.text, marginTop: 8, fontWeight: 'bold', textAlign: 'center' },
  panicWrap: { justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  panicPulse: { position: 'absolute', width: 240, height: 240, borderRadius: 120, backgroundColor: '#e74c3c' },
  panicBtn: { backgroundColor: '#e74c3c', width: 240, height: 240, borderRadius: 120, justifyContent: 'center', alignItems: 'center', elevation: 20, borderWidth: 10, borderColor: 'rgba(231, 76, 60, 0.25)', shadowColor: '#e74c3c', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.5, shadowRadius: 24 },
  panicText: { color: '#ffffff', fontSize: 60, fontWeight: '900', letterSpacing: 2 },
  panicHint: { color: 'rgba(255,255,255,0.9)', fontSize: 14, fontWeight: '800', letterSpacing: 3, marginTop: 2 },
  followBtn: { width: '100%', backgroundColor: C.card, borderWidth: 1.5, borderColor: '#004aad', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginBottom: 24, elevation: 2 },
  followBtnActive: { backgroundColor: '#2ecc71', borderColor: '#27ae60' },
  followBtnText: { color: '#004aad', fontWeight: '800', fontSize: 14, letterSpacing: 0.5 },
  followStatus: { width: '100%', backgroundColor: C.card, borderRadius: 14, padding: 16, marginBottom: 20, alignItems: 'center', borderWidth: 1.5, borderColor: C.border, elevation: 2 },
  followStatusText: { fontSize: 14, fontWeight: '800', color: C.text },
  followTimer: { fontSize: 34, fontWeight: '900', color: '#004aad', marginVertical: 4 },
  followStatusSub: { fontSize: 11.5, color: C.sub, textAlign: 'center', marginTop: 2, lineHeight: 16 },
  fakeCallBtn: { backgroundColor: '#2c3e50', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 18, marginHorizontal: 5, elevation: 2 },
  fakeCallBtnText: { color: '#ffffff', fontWeight: 'bold', fontSize: 14 },
  callScreen: { flex: 1, backgroundColor: '#111417', justifyContent: 'space-between', paddingVertical: 60 },
  callAvatar: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#2c3e50', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  callName: { color: '#ffffff', fontSize: 32, fontWeight: '800' },
  callStatus: { color: '#bdc3c7', fontSize: 16, marginTop: 8 },
  callActions: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center', marginBottom: 40 },
  callCircle: { width: 74, height: 74, borderRadius: 37, justifyContent: 'center', alignItems: 'center', elevation: 6 },
  callCircleIcon: { color: '#ffffff', fontSize: 30 },
  profileHero: { alignItems: 'center', backgroundColor: C.card, borderRadius: 22, paddingVertical: 28, paddingHorizontal: 20, elevation: 5, shadowColor: '#0a2540', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 18 },
  profileAvatar: { width: 92, height: 92, borderRadius: 46, backgroundColor: '#eef3ff', justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: '#004aad', marginBottom: 12, overflow: 'hidden' },
  avatarCam: { position: 'absolute', bottom: 0, right: 0, backgroundColor: '#004aad', width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#fff' },
  profileName: { fontSize: 22, fontWeight: '900', color: C.title },
  profileEmail: { fontSize: 13, color: C.sub, marginTop: 3 },
  profileBadge: { marginTop: 12, backgroundColor: '#e8f8f0', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: '#b7e4c7' },
  profileBadgeText: { color: '#1e7e46', fontWeight: 'bold', fontSize: 12 },
  profileStatsRow: { flexDirection: 'row', backgroundColor: C.card, borderRadius: 18, paddingVertical: 16, marginTop: 14, elevation: 3, shadowColor: '#0a2540', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 10, alignItems: 'center' },
  profileStat: { flex: 1, alignItems: 'center' },
  profileStatNum: { fontSize: 18, fontWeight: '900', color: '#004aad' },
  profileStatLabel: { fontSize: 11, color: C.sub, marginTop: 2, fontWeight: 'bold' },
  profileStatDivider: { width: 1, height: 30, backgroundColor: C.divider },
  settingsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  settingsBack: { color: '#004aad', fontWeight: 'bold', fontSize: 16 },
  settingsTitle: { fontSize: 22, fontWeight: '900', color: C.title },
  setSection: { marginBottom: 18 },
  setSectionTitle: { fontSize: 12, fontWeight: '900', color: C.sub, letterSpacing: 1, marginBottom: 8, marginLeft: 6 },
  setSectionCard: { backgroundColor: C.card, borderRadius: 16, elevation: 2, shadowColor: '#0a2540', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10 },
  setRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 14, borderBottomWidth: 0.5, borderBottomColor: C.divider },
  setLabel: { fontSize: 14.5, color: C.text, fontWeight: '600' },
  setDesc: { fontSize: 11.5, color: C.sub, marginTop: 3 },
  setArrow: { fontSize: 15, color: C.sub, fontWeight: 'bold' },
  vaultItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 14, padding: 16, marginBottom: 10, elevation: 2, shadowColor: '#0a2540', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 8 },
  langRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, marginBottom: 8 },
  langRowActive: { borderColor: '#004aad', backgroundColor: dark ? '#1c2a3f' : '#eef3ff' },
  langName: { fontSize: 16, color: C.text, fontWeight: '600' },
  langChip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1.5, borderColor: C.inputBorder, marginRight: 8, marginBottom: 8, backgroundColor: C.chip },
  langChipActive: { backgroundColor: '#004aad', borderColor: '#004aad' },
  langChipText: { color: C.text, fontWeight: 'bold', fontSize: 13 },
  otpBox: { width: 46, height: 56, borderRadius: 12, borderWidth: 2, borderColor: '#d0d5dd', backgroundColor: '#f8fafc', justifyContent: 'center', alignItems: 'center' },
  otpBoxFilled: { borderColor: '#004aad', backgroundColor: '#eef3ff' },
  otpBoxActive: { borderColor: '#004aad' },
  otpDigit: { fontSize: 24, fontWeight: '900', color: '#004aad' },
  instruction: { marginTop: 30, color: C.sub, fontWeight: 'bold', letterSpacing: 1, textAlign: 'center' },
  footer: { height: 72, backgroundColor: C.footer, flexDirection: 'row', borderTopWidth: 0.5, borderColor: C.divider, elevation: 12, shadowColor: '#0a2540', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.06, shadowRadius: 10 },
  tab: { flex: 1, justifyContent: 'center', alignItems: 'center', borderTopWidth: 3, borderTopColor: 'transparent' },
  tabActive: { backgroundColor: C.tabActive, borderTopColor: '#004aad' },
  tabText: { fontSize: 11.5, fontWeight: 'bold', color: C.sub },
  wellCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 16, padding: 16, marginBottom: 11, elevation: 3, shadowColor: '#0a2540', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 10 },
  wellTitle: { fontSize: 15.5, fontWeight: '800', color: C.text },
  wellDesc: { fontSize: 12, color: C.sub, marginTop: 3 },
  profileRow: { borderBottomWidth: 1, borderColor: C.divider, paddingVertical: 15, flexDirection: 'row', justifyContent: 'space-between' },
  profileLabel: { color: C.sub, fontWeight: 'bold', fontSize: 13 },
  profileValue: { color: C.text, fontWeight: 'bold', fontSize: 15 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  statusText: { fontSize: 14, color: C.text, textAlign: 'center', marginBottom: 5, fontWeight: 'bold' },
  deactivateBtn: { backgroundColor: '#000000', padding: 15, borderRadius: 15, width: '100%', alignItems: 'center', borderWidth: 2, borderColor: '#ffffff', elevation: 10 },
  chatHeader: { marginBottom: 20, alignItems: 'center' },
  chatHeaderTitle: { fontSize: 22, fontWeight: 'bold', color: '#004aad' },
  chatHeaderSub: { fontSize: 12, color: C.sub, marginTop: 5 },
  chatContainer: { flex: 1, paddingBottom: 20 },
  chatBubble: { maxWidth: '80%', padding: 15, borderRadius: 15, marginBottom: 15, elevation: 1 },
  chatBubbleUser: { backgroundColor: '#004aad', alignSelf: 'flex-end', borderBottomRightRadius: 0 },
  chatBubbleAI: { backgroundColor: C.card, alignSelf: 'flex-start', borderBottomLeftRadius: 0, borderWidth: 1, borderColor: C.border },
  chatText: { fontSize: 14, lineHeight: 22, fontWeight: '600' },
  chatInputBox: { flexDirection: 'row', padding: 15, backgroundColor: C.card, borderTopWidth: 1, borderColor: C.divider },
  chatInput: { flex: 1, backgroundColor: C.input, borderRadius: 25, paddingHorizontal: 20, height: 50, color: C.text, fontWeight: 'bold' },
  chatSendBtn: { backgroundColor: '#004aad', borderRadius: 25, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20, marginLeft: 10 },
  flipkartGridContainer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 20, paddingHorizontal: 5 },
  flipkartGridBox: { width: '48%', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingVertical: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 10, elevation: 2, shadowColor: '#0a2540', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 8 },
  flipkartGridText: { color: '#004aad', fontWeight: 'bold', fontSize: 14, textAlign: 'center' },
  helplineRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18, paddingHorizontal: 5 },
  helplineBtn: { flex: 1, backgroundColor: '#fff5f5', borderWidth: 1.5, borderColor: '#e74c3c', borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginHorizontal: 4, elevation: 2 },
  helplineLabel: { color: '#c0392b', fontWeight: 'bold', fontSize: 12 },
  helplineNum: { color: '#e74c3c', fontWeight: '900', fontSize: 18, marginTop: 3 },
  loginBgContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', width: '100%' },
  loginTextCenter: { flex: 1, justifyContent: 'center', alignItems: 'center', flexDirection: 'row' },
  loginDynamicText: { fontSize: 34, fontWeight: 'bold', textAlign: 'center' },
  loginBottomArea: { position: 'absolute', bottom: 50, width: '100%', paddingHorizontal: 30 },
  googleLoginBtn: { backgroundColor: '#ffffff', height: 60, borderRadius: 30, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5 },
  googleBtnText: { color: '#000000', fontSize: 18, fontWeight: 'bold' }
  });
};
// Light stylesheet for the pre-auth OtpInput/OtpSuccess components (always light).
const styles = makeStyles(false);

const App = () => { return (<SafeAreaProvider><MainApp /></SafeAreaProvider>); };

export default App;