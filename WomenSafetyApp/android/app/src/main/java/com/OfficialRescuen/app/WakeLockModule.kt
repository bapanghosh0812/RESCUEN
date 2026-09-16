package com.officialrescuen.app

import android.content.Context
import android.os.PowerManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * RESCUEN safety wake lock.
 *
 * While an SOS or Follow-Me session is active the phone may be in a pocket with
 * the screen off. Android would normally let the CPU sleep (Doze), which stops
 * the JS timers that drive the "Are you safe?" voice and the auto-SOS countdown.
 * A PARTIAL_WAKE_LOCK keeps the CPU awake so that safety-critical logic keeps
 * running in the background. It is acquired when a session starts and explicitly
 * released the moment both SOS and Follow-Me are off, so battery use is bounded
 * to the emergency window only.
 */
class WakeLockModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private var wakeLock: PowerManager.WakeLock? = null

    override fun getName(): String = "RescuenWakeLock"

    @ReactMethod
    fun acquire() {
        try {
            if (wakeLock == null) {
                val pm = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RESCUEN:SafetyWakeLock")
                wakeLock?.setReferenceCounted(false)
            }
            if (wakeLock?.isHeld == false) {
                wakeLock?.acquire()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    @ReactMethod
    fun release() {
        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // Present so a JS NativeEventEmitter wrapper never crashes (no events emitted).
    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}
}
