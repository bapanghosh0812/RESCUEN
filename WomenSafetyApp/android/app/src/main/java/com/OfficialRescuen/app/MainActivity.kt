package com.officialrescuen.app

import android.content.Context
import android.os.Bundle
import android.os.SystemClock
import android.view.KeyEvent
import android.view.WindowManager
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.modules.core.DeviceEventManagerModule

class MainActivity : ReactActivity() {

    private var volumePressCount = 0
    private var lastVolumePressTime: Long = 0
    private val VOLUME_PRESS_TIMEOUT: Long = 2000 // 2 seconds ke andar 3 press

    override fun getMainComponentName(): String = "WomenSafetyApp"

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

    override fun onCreate(savedInstanceState: Bundle?) {
        // 🔥 Screen Wake Up Logic (Lock screen bypass)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as android.app.KeyguardManager
            keyguardManager.requestDismissKeyguard(this, null)
        } else {
            window.addFlags(
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }
        super.onCreate(savedInstanceState)
    }

    // 🔥 THE BULLETPROOF BUTTON RADAR (Works for UP & DOWN)
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val action = event.action
        val keyCode = event.keyCode

        // Jab button dabaya jaye (ACTION_DOWN)
        if (action == KeyEvent.ACTION_DOWN) {
            if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN || keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
                // repeatCount == 0 ensure karta hai ki button hold karne par lagatar fire na ho
                if (event.repeatCount == 0) {
                    handleVolumePress()
                }
                return true // OS ko bolo humne aawaz track kar li, default volume bar mat dikhao
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun handleVolumePress() {
        val currentTime = SystemClock.elapsedRealtime()
        
        // Agar 2 second se zyada time le liya, toh ginti wapas 0 se shuru
        if (currentTime - lastVolumePressTime > VOLUME_PRESS_TIMEOUT) {
            volumePressCount = 0
        }
        
        volumePressCount++
        lastVolumePressTime = currentTime

        // 3 baar dabne par SOS trigger karo
        if (volumePressCount >= 3) {
            volumePressCount = 0 // Counter reset
            triggerEmergencySOS()
        }
    }

    private fun triggerEmergencySOS() {
        // 1. App ko force karke saamne laao (agar minimize hai ya screen locked hai)
        val intent = intent
        intent.flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP
        startActivity(intent)

        // 2. React Native (App.tsx) ko Trigger bhej do
        try {
            reactInstanceManager.currentReactContext
                ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit("TriggerRescueSOS", "Emergency_Button_Pressed")
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
}