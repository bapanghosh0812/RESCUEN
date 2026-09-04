import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, StatusBar, Image, ScrollView, TextInput, Vibration, Modal, ActivityIndicator, PermissionsAndroid, Linking, LogBox, Platform, NativeModules, Dimensions, Animated, AppState, DeviceEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Geolocation from 'react-native-geolocation-service';
import Sound from 'react-native-sound';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import functions from '@react-native-firebase/functions'; 
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
        console.log("SOS Triggered internally from", eventData?.source);
        triggerSOS();
    });
    return () => subscription.remove();
  }, [currentCoords, user]); 

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
          
          // 🔥 START PREMIUM NOTIFICATIONS
          if (NotificationManager) {
              NotificationManager.scheduleDailyMorningAlert();
              NotificationManager.scheduleReviewPush();
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
        const loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, speed: pos.coords.speed };
        setCurrentCoords(loc);
        if (pos.coords.accuracy <= 10) { setCurrentLocationText('🟢 Exact Pin-Point Locked'); } 
        else { setCurrentLocationText('🟡 Refining Accuracy...'); }
      },
      (error) => {}, { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );

    Geolocation.watchPosition(
      (pos) => {
        const loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, speed: pos.coords.speed };
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
    if (currentCoords && user && user.email) {
       const hash = encodeGeohash(currentCoords.latitude, currentCoords.longitude);
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
          const loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, speed: pos.coords.speed };
          setCurrentCoords(loc); 
          const hash = encodeGeohash(loc.latitude, loc.longitude);
          firestore().collection('active_emergencies').doc(user.email).set({
            location: loc, 
            l: new firestore.GeoPoint(loc.latitude, loc.longitude),
            h: hash, user: user, timestamp: firestore.FieldValue.serverTimestamp()
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
                   totalNotified: data?.notifiedUsers?.length || 0,
                   helpers: data?.activeHelpers?.length || 0
                });
             }
           } catch(err) {}
        });

      if (queryPrefix) {
        victimMapListener = firestore().collection('users')
          .orderBy('h').startAt(queryPrefix).endAt(queryPrefix + '\uf8ff')
          .onSnapshot(snap => {
            try {
              let usersList = [];
              snap.forEach(doc => {
                const data = doc.data();
                if (data.email !== user.email && data.lastKnownLocation) {
                   const dist = getDistance(currentCoords, data.lastKnownLocation);
                   usersList.push({ ...data, dist });
                }
              });
              usersList.sort((a,b) => a.dist - b.dist);
              setVictimMapHelpers(usersList.slice(0, 10)); 
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
    
    if (validEmergency) {
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

  const sendOTP = async () => {
    if (user.myPhone.length !== 10) return Alert.alert("Validation", "Enter a valid 10-digit number.");
    if (isSendingOtp || isOtpSent) return; 
    setIsSendingOtp(true);
    try {
      const confirmation = await auth().signInWithPhoneNumber('+91' + user.myPhone);
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
      const confirmation = await auth().signInWithPhoneNumber('+91' + user.myPhone);
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
    const lastUpdate = user.lastNumberUpdate || 0;
    const now = Date.now();
    const daysPassed = (now - lastUpdate) / (1000 * 60 * 60 * 24);

    if (lastUpdate !== 0 && daysPassed < 60) {
      const daysLeft = Math.ceil(60 - daysPassed);
      return Alert.alert("Limit Reached", `You can only update your numbers once every 60 days.\n\nPlease try again in ${daysLeft} days.`);
    }
    setEditData({ myPhone: user.myPhone, familyNumbers: [...(user.familyNumbers || [''])] });
    setShowEditModal(true);
  };

  const handleEditFamilyNumChange = (text, index) => {
    const newNumbers = [...editData.familyNumbers];
    newNumbers[index] = text.replace(/[^0-9]/g, '').slice(0, 10);
    setEditData({...editData, familyNumbers: newNumbers});
  };

  const saveEditedNumbers = async () => {
    const validFamilyNums = editData.familyNumbers.filter(n => n && n.length === 10);
    if (editData.myPhone.length !== 10 || validFamilyNums.length === 0) return Alert.alert("Invalid Input", "Please enter valid 10-digit phone numbers.");
    
    setIsLoading(true);
    try {
      const now = Date.now();
      const updatedUser = { ...user, myPhone: editData.myPhone, familyNumbers: validFamilyNums, familyNum: validFamilyNums[0], lastNumberUpdate: now };

      await firestore().collection('users').doc(user.email).update({
        myPhone: editData.myPhone, familyNumbers: validFamilyNums, familyNum: validFamilyNums[0], lastNumberUpdate: now
      });

      await AsyncStorage.setItem('userSession', JSON.stringify(updatedUser));
      setUser(updatedUser); setShowEditModal(false);
      Alert.alert("Success", "Your numbers have been updated safely!");
    } catch (error) { Alert.alert("Update Error", String(error.message || error)); } 
    finally { setIsLoading(false); }
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
      if (sirenSound.current) { try { sirenSound.current.setVolume(1.0); sirenSound.current.play(); } catch(e) {} }
      try { Vibration.vibrate([0, 1000, 500, 1000, 500, 1000, 500, 1000], true); } catch (e) {}

      try { await startForegroundService(); } catch(e) {}
      
      // 🔥 START SECURE VAULT RECORDING (PHASE 3)
      if (SecureVaultManager) SecureVaultManager.startAudioEvidence(user.email);

      if (currentCoords && user && user.email) {
        const hash = encodeGeohash(currentCoords.latitude, currentCoords.longitude);
        firestore().collection('active_emergencies').doc(user.email).set({
          location: currentCoords, l: new firestore.GeoPoint(currentCoords.latitude, currentCoords.longitude),
          h: hash, user: user, timestamp: firestore.FieldValue.serverTimestamp(), notifiedUsers: [], activeHelpers: []
        }, { merge: true }).catch(()=>{});
      }

      const lat = currentCoords ? currentCoords.latitude : 0;
      const lng = currentCoords ? currentCoords.longitude : 0;
      const mapLink = currentCoords ? `http://maps.google.com/?q=${lat},${lng}` : 'Location Unavailable';
      const smsBody = `URGENT EMERGENCY: I am ${user.name}. I am in severe danger. Track me: ${mapLink}`;

      try {
        const hasPermission = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.SEND_SMS);
        const validNumbers = (user.familyNumbers || []).filter(n => n && n.length === 10);

        if (hasPermission && typeof DirectSms !== 'undefined') {
          validNumbers.forEach(num => { try { DirectSms.sendDirectSms(num, smsBody); } catch(e){} });
          try { DirectSms.sendDirectSms('100', smsBody); } catch(e){}
        } else {
          const separator = Platform.OS === 'ios' ? ',' : ';';
          const joinedNums = ['100', ...validNumbers].join(separator);
          const url = `sms:${joinedNums}?body=${encodeURIComponent(smsBody)}`;
          Linking.openURL(url).catch(err => {});
        }
      } catch(e){}

    } catch (error) { console.log(error); } 
    finally { isTriggering.current = false; setTimeout(() => { actionLock.current = false; }, 2000); }
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
    const lastSosData = await AsyncStorage.getItem('last_sos_received');
    if (lastSosData) contextData.lastReceivedSOS = JSON.parse(lastSosData);
    if (nearbyEmergenciesList.length > 0) contextData.activeNearbyEmergencies = nearbyEmergenciesList;

    // 🔥 PHASE 4: TERA ASLI PURE AI BRAIN FIRE HO RAHA HAI YAHAN
    const aiResponse = await RescuenBrain.processCommand(userMessage, contextData);
    
    setChatMessages(prev => [...prev, { sender: 'ai', text: aiResponse.text }]);
    setIsAITyping(false);
  };

  return (
    <View style={[styles.main, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent={true} />
      
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
                <Text style={{ color: '#333', fontSize: 13, marginBottom: 15, fontWeight: 'bold' }}>Tap below -> Go to "Battery" -> Select "Unrestricted" (No Restrictions). Also turn ON "Auto-Start".</Text>
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
                   
                   <TouchableOpacity style={styles.panicBtn} onLongPress={triggerSOS} delayLongPress={2000}>
                      <Text style={styles.panicText}>SOS</Text>
                   </TouchableOpacity>
                   <Text style={styles.instruction}>HOLD BUTTON FOR 2 SECONDS IN DANGER</Text>
                 </>
               )}

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
                    <Text style={[styles.chatText, msg.sender === 'user' ? {color: '#fff'} : {color: '#333'}]}>
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
            <View style={styles.card}>
              <Text style={styles.cardTitle}>User Dashboard</Text>
              <View style={styles.profileRow}><Text style={styles.profileLabel}>NAME</Text><Text style={styles.profileValue}>{user.name}</Text></View>
              <View style={styles.profileRow}><Text style={styles.profileLabel}>EMAIL</Text><Text style={styles.profileValue}>{user.email}</Text></View>
              <View style={styles.profileRow}><Text style={styles.profileLabel}>MY PHONE</Text><Text style={styles.profileValue}>+91 {user.myPhone}</Text></View>
              <View style={[styles.profileRow, {borderBottomWidth: 0}]}>
                  <Text style={styles.profileLabel}>FAMILY ({user.familyNumbers?.filter(n=>n.length===10).length || 0})</Text>
                  <Text style={styles.profileValue}>
                    +91 {user.familyNumbers && user.familyNumbers[0]} {user.familyNumbers?.length > 1 ? `(+${user.familyNumbers.length - 1} more)` : ''}
                  </Text>
              </View>
              
              <TouchableOpacity style={[styles.btn, {backgroundColor: '#27ae60', marginTop: 30}]} onPress={handleOpenEditModal}>
                <Text style={styles.btnText}>EDIT NUMBERS</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.btn, {backgroundColor: '#34495e', marginTop: 15}]} onPress={handleLogout}>
                <Text style={styles.btnText}>LOGOUT</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.btn, {backgroundColor: '#e74c3c', marginTop: 15}]} onPress={() => setShowDeleteModal(true)}>
                <Text style={styles.btnText}>DELETE ACCOUNT</Text>
              </TouchableOpacity>

              <TouchableOpacity style={{marginTop: 25, alignItems: 'center'}} onPress={() => setCurrentScreen('ReadTC')}>
                <Text style={{color: '#3498db', fontWeight: 'bold', fontSize: 13, textDecorationLine: 'underline'}}>
                  📜 READ TERMS & PRIVACY POLICY
                </Text>
              </TouchableOpacity>

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

      {(currentScreen === 'Dashboard' || currentScreen === 'ProfileView' || currentScreen === 'AIHelp') && (
        <View style={styles.footer}>
          <TouchableOpacity style={styles.tab} onPress={() => setCurrentScreen('Dashboard')}>
            <Text style={[styles.tabText, currentScreen==='Dashboard' && {color:'#004aad'}]}>🏠 HOME</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tab} onPress={() => setCurrentScreen('AIHelp')}>
            <Text style={[styles.tabText, currentScreen==='AIHelp' && {color:'#004aad'}]}>🤖 AI HELP</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tab} onPress={() => setCurrentScreen('ProfileView')}>
            <Text style={[styles.tabText, currentScreen==='ProfileView' && {color:'#004aad'}]}>👤 PROFILE</Text>
          </TouchableOpacity>

          {/* 🔥 SECRET GOD MODE TAB (ONLY FOR ADMIN) 🔥 */}
          {user.email === 'rescuensupport@gmail.com' && (
            <TouchableOpacity style={styles.tab} onPress={() => Linking.openURL('https://console.firebase.google.com/')}>
              <Text style={[styles.tabText, {color:'#e67e22', fontWeight: '900'}]}>👑 ADMIN</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <Modal visible={isSOSActive} transparent animationType="fade">
        <View style={[styles.modalBg, {backgroundColor: 'rgba(231, 76, 60, 0.95)', paddingTop: insets.top, paddingBottom: insets.bottom}]}>
          <Text style={{fontSize: 28, fontWeight: '900', color: '#ffffff', marginBottom: 10, textAlign: 'center'}}>🚨 SOS ACTIVE 🚨</Text>
          
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
            <Text style={{fontSize: 16, fontWeight: '900', color: '#e74c3c', textAlign: 'center', marginBottom: 10}}>📡 BROADCAST STATUS</Text>
            <Text style={styles.statusText}>✅ 1 KM radar scanning live</Text>
            <Text style={styles.statusText}>✅ Family SMS sent silently</Text>
            <Text style={styles.statusText}>✅ Police (100) alerted</Text>
          </View>

          <TouchableOpacity style={styles.deactivateBtn} onPress={deactivateSOS}>
            <Text style={{color: '#ffffff', fontSize: 18, fontWeight: '900', letterSpacing: 1}}>🛑 DEACTIVATE ALARM</Text>
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
            <Text style={{fontSize: 14, color: '#444', marginBottom: 20, lineHeight: 22}}>Your account will be suspended and scheduled for permanent deletion after 30 days. To cancel this request later, simply log back in within 30 days.{"\n\n"}Type <Text style={{fontWeight: 'bold', color: '#e74c3c'}}>DELETE</Text> below to confirm.</Text>
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
            <Text style={styles.cardTitle}>Edit Numbers</Text>
            <Text style={{fontSize: 13, color: '#e74c3c', marginBottom: 15, fontWeight: 'bold'}}>Note: Numbers can only be changed once every 60 days.</Text>
            
            <Text style={styles.label}>MY PHONE</Text>
            <TextInput style={styles.input} value={editData.myPhone} placeholder="10-digit number" placeholderTextColor="#888888" keyboardType="numeric" maxLength={10} onChangeText={(t) => setEditData({...editData, myPhone: t})} />

            <ScrollView style={{maxHeight: 180}}>
              <Text style={styles.label}>FAMILY CONTACTS</Text>
              {editData.familyNumbers.map((num, index) => (
                <TextInput 
                  key={index}
                  style={styles.input} 
                  value={num} 
                  placeholder={index === 0 ? "Mandatory 10-digit number" : "Optional 10-digit number"} 
                  placeholderTextColor="#888888" 
                  keyboardType="numeric" 
                  maxLength={10} 
                  onChangeText={(t) => handleEditFamilyNumChange(t, index)} 
                />
              ))}
            </ScrollView>
            
            <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 10}}>
              <TouchableOpacity style={[styles.btn, {flex: 0.45, backgroundColor: '#888', marginTop: 0}]} onPress={() => setShowEditModal(false)}>
                <Text style={styles.btnText}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, {flex: 0.45, backgroundColor: '#2ecc71', marginTop: 0}]} onPress={saveEditedNumbers} disabled={isLoading}>
                {isLoading ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.btnText}>SAVE</Text>}
              </TouchableOpacity>
            </View>
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
                  if (!reportData.name.trim() || !reportData.email.trim() || !reportData.phone.trim() || !reportData.message.trim()) {
                    return Alert.alert("Required Fields", "Please fill all the boxes to send a report.");
                  }
                  if (reportData.phone.length !== 10) {
                    return Alert.alert("Invalid Phone", "Please enter a valid 10-digit phone number.");
                  }

                  setIsSendingReport(true);
                  try {
                    const sendReportEmail = functions().httpsCallable('sendSupportEmail');
                    const response = await sendReportEmail(reportData);
                    
                    if (response.data && response.data.success) {
                      Alert.alert("Sent Successfully", "Your message has been sent to our team. We will get back to you soon.");
                      setShowReportForm(false);
                      setReportData({ name: '', email: '', phone: '', message: '' });
                    } else {
                      Alert.alert("Error", "Could not send the message. Please try again.");
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

const styles = StyleSheet.create({
  main: { flex: 1, backgroundColor: '#ffffff' }, 
  header: { height: 70, backgroundColor: '#ffffff', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, elevation: 5, zIndex: 10, width: '100%' },
  logo: { width: 40, height: 40, marginRight: 15, borderRadius: 5 },
  headerTitle: { fontSize: 24, fontWeight: '900', color: '#004aad', letterSpacing: 1 },
  headerIconsContainer: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  socialIcon: { width: 28, height: 28, marginLeft: 20 },
  scrollContent: { padding: 20, flexGrow: 1, justifyContent: 'flex-start', backgroundColor: '#f4f7f6' }, 
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 100 }, 
  warningBox: { width: '100%', backgroundColor: '#ffeaa7', padding: 15, borderRadius: 10, borderWidth: 1, borderColor: '#f1c40f', marginBottom: 20, alignItems: 'center' },
  warningText: { color: '#d35400', fontWeight: 'bold', textAlign: 'center', fontSize: 13, lineHeight: 20 },
  card: { backgroundColor: '#ffffff', padding: 25, borderRadius: 20, elevation: 4 },
  cardTitle: { fontSize: 26, fontWeight: '800', marginBottom: 5, color: '#000000' },
  label: { fontSize: 12, color: '#555555', marginBottom: 8, fontWeight: 'bold', marginTop: 10 }, 
  input: { backgroundColor: '#ffffff', height: 55, borderRadius: 12, paddingHorizontal: 20, borderWidth: 1, borderColor: '#cccccc', marginBottom: 15, fontSize: 15, color: '#000000', fontWeight: 'bold' },
  genderRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 25 },
  gBtn: { flex: 1, padding: 15, borderWidth: 1, borderColor: '#cccccc', borderRadius: 12, alignItems: 'center', marginHorizontal: 4, backgroundColor: '#ffffff' },
  gActive: { backgroundColor: '#004aad', borderColor: '#004aad' },
  gText: { fontWeight: 'bold', color: '#333333' }, 
  btn: { backgroundColor: '#004aad', padding: 18, borderRadius: 12, alignItems: 'center', elevation: 2, marginTop: 10 },
  btnText: { color: '#ffffff', fontSize: 16, fontWeight: '800', letterSpacing: 1 },
  tcBox: { height: 180, backgroundColor: '#f9f9f9', padding: 15, borderRadius: 12, marginBottom: 20, borderWidth: 1.5, borderColor: '#eeeeee' },
  tcText: { fontSize: 13, color: '#333333', lineHeight: 22 },
  checkRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 25, alignSelf: 'center', marginTop: 15 },
  checkbox: { width: 22, height: 22, borderWidth: 2, borderColor: '#004aad', borderRadius: 6, marginRight: 12, backgroundColor: '#ffffff' },
  checked: { backgroundColor: '#004aad' },
  checkLabel: { fontSize: 13, fontWeight: 'bold', color: '#004aad' },
  sosContainer: { alignItems: 'center', marginTop: 20, backgroundColor: '#f4f7f6', flex: 1 },
  mapBox: { width: '100%', padding: 20, backgroundColor: '#ffffff', borderRadius: 15, marginBottom: 30, alignItems: 'center', elevation: 3, borderWidth: 1, borderColor: '#e1e5eb' },
  mapText: { fontSize: 18, fontWeight: 'bold', color: '#2ecc71' },
  locationSubText: { fontSize: 13, color: '#000000', marginTop: 8, fontWeight: 'bold', textAlign: 'center' },
  panicBtn: { backgroundColor: '#e74c3c', width: 240, height: 240, borderRadius: 120, justifyContent: 'center', alignItems: 'center', elevation: 20, borderWidth: 10, borderColor: 'rgba(231, 76, 60, 0.2)' },
  panicText: { color: '#ffffff', fontSize: 60, fontWeight: '900', letterSpacing: 2 },
  instruction: { marginTop: 30, color: '#444444', fontWeight: 'bold', letterSpacing: 1, textAlign: 'center' },
  footer: { height: 70, backgroundColor: '#ffffff', flexDirection: 'row', borderTopWidth: 1, borderColor: '#eeeeee' },
  tab: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  tabText: { fontSize: 13, fontWeight: 'bold', color: '#888888' },
  profileRow: { borderBottomWidth: 1, borderColor: '#eeeeee', paddingVertical: 15, flexDirection: 'row', justifyContent: 'space-between' },
  profileLabel: { color: '#888888', fontWeight: 'bold', fontSize: 13 },
  profileValue: { color: '#000000', fontWeight: 'bold', fontSize: 15 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  statusText: { fontSize: 14, color: '#333333', textAlign: 'center', marginBottom: 5, fontWeight: 'bold' },
  deactivateBtn: { backgroundColor: '#000000', padding: 15, borderRadius: 15, width: '100%', alignItems: 'center', borderWidth: 2, borderColor: '#ffffff', elevation: 10 },
  chatHeader: { marginBottom: 20, alignItems: 'center' },
  chatHeaderTitle: { fontSize: 22, fontWeight: 'bold', color: '#004aad' },
  chatHeaderSub: { fontSize: 12, color: '#666', marginTop: 5 },
  chatContainer: { flex: 1, paddingBottom: 20 },
  chatBubble: { maxWidth: '80%', padding: 15, borderRadius: 15, marginBottom: 15, elevation: 1 },
  chatBubbleUser: { backgroundColor: '#004aad', alignSelf: 'flex-end', borderBottomRightRadius: 0 },
  chatBubbleAI: { backgroundColor: '#ffffff', alignSelf: 'flex-start', borderBottomLeftRadius: 0, borderWidth: 1, borderColor: '#e1e5eb' },
  chatText: { fontSize: 14, lineHeight: 22, fontWeight: '600' },
  chatInputBox: { flexDirection: 'row', padding: 15, backgroundColor: '#ffffff', borderTopWidth: 1, borderColor: '#eee' },
  chatInput: { flex: 1, backgroundColor: '#f4f7f6', borderRadius: 25, paddingHorizontal: 20, height: 50, color: '#000', fontWeight: 'bold' },
  chatSendBtn: { backgroundColor: '#004aad', borderRadius: 25, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20, marginLeft: 10 },
  flipkartGridContainer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 20, paddingHorizontal: 5 },
  flipkartGridBox: { width: '48%', backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#004aad', borderRadius: 12, paddingVertical: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 10, elevation: 2 },
  flipkartGridText: { color: '#004aad', fontWeight: 'bold', fontSize: 14, textAlign: 'center' },
  loginBgContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', width: '100%' },
  loginTextCenter: { flex: 1, justifyContent: 'center', alignItems: 'center', flexDirection: 'row' },
  loginDynamicText: { fontSize: 34, fontWeight: 'bold', textAlign: 'center' },
  loginBottomArea: { position: 'absolute', bottom: 50, width: '100%', paddingHorizontal: 30 },
  googleLoginBtn: { backgroundColor: '#ffffff', height: 60, borderRadius: 30, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5 },
  googleBtnText: { color: '#000000', fontSize: 18, fontWeight: 'bold' }
});

const App = () => { return (<SafeAreaProvider><MainApp /></SafeAreaProvider>); };

export default App;