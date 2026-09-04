# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# 🔥 RESCUEN Firebase & Firestore Security Rules 🔥
-keep class com.google.firebase.** { *; }
-keep class io.grpc.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn io.grpc.**
-dontwarn com.google.android.gms.**

# 🔥 Google Maps Security Rules 🔥
-keep class com.google.android.gms.maps.** { *; }
-keep interface com.google.android.gms.maps.** { *; }
-keep class com.airbnb.android.react.maps.** { *; }


# =========================================================
# 🚨 NAYE CRITICAL RULES (SOS AUR BACKGROUND SERVICE KE LIYE) 🚨
# =========================================================

# 1. Notifee (Background Alarm aur Foreground Service bachane ke liye)
-keep class app.notifee.** { *; }
-dontwarn app.notifee.**

# 2. React Native Sound (Siren ko bachane ke liye)
-keep class com.zmxv.RNSound.** { *; }
-dontwarn com.zmxv.RNSound.**

# 3. Tera Custom DirectSms Module (SOS SMS bachane ke liye)
-keepclassmembers class * extends com.facebook.react.bridge.ReactContextBaseJavaModule {
    @com.facebook.react.bridge.ReactMethod *;
}
-keep class * implements com.facebook.react.bridge.ReactPackage {
    *;
}

# 4. Geolocation / Location Manager (GPS bachane ke liye)
-keep class com.agontuk.RNFusedLocation.** { *; }
-dontwarn com.agontuk.RNFusedLocation.**

# 5. Core React Native Engine (Zaroori)
-keep class com.facebook.react.** { *; }
-keep class com.facebook.yoga.** { *; }
-dontwarn com.facebook.react.**

# 6. Hermes VM Engine ko bachane ke liye (Startup crash fix)
-keep class com.facebook.hermes.reactexecutor.** { *; }
-keep class com.facebook.react.runtime.hermes.** { *; }