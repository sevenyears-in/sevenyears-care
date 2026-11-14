package com.sevenyears.care

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.webkit.JavascriptInterface

/** window.SevenYearsApp on care.sevenyears.in (the app only ever loads that site). */
class AppBridge(private val context: Context) {
    @JavascriptInterface
    fun pushToken(): String =
        context.getSharedPreferences("app", Context.MODE_PRIVATE).getString("push_token", "") ?: ""

    @JavascriptInterface
    fun platform(): String = "android"

    /** Walk-in counter screen open / closed: volume buttons count walk-ins and the screen stays on. */
    @JavascriptInterface
    fun setWalkinCounter(on: Boolean) {
        (context as? MainActivity)?.setWalkinCounter(on)
    }

    /** Short buzz so the CRE feels each counted walk-in. */
    @JavascriptInterface
    fun vibrate(ms: Int) {
        try {
            val v: Vibrator = if (Build.VERSION.SDK_INT >= 31) {
                context.getSystemService(VibratorManager::class.java).defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }
            val length = ms.coerceIn(10, 500).toLong()
            if (Build.VERSION.SDK_INT >= 26) {
                v.vibrate(VibrationEffect.createOneShot(length, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                v.vibrate(length)
            }
        } catch (e: Exception) {
            // No vibrator — counting still works.
        }
    }

    /** Opens the phone's own settings for staff alerts, where the person picks the sound (any ringtone on the phone). */
    @JavascriptInterface
    fun openNotificationSound() {
        PushService.createChannel(context)
        val intent = when {
            Build.VERSION.SDK_INT >= 26 -> Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).apply {
                putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                putExtra(Settings.EXTRA_CHANNEL_ID, PushService.CHANNEL_ALERTS)
            }
            else -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.packageName))
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
        } catch (e: Exception) {
            // Older phones: open the app's settings page instead.
            context.startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
    }
}
