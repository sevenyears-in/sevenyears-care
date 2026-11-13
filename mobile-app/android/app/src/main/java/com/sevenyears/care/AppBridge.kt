package com.sevenyears.care

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.webkit.JavascriptInterface

/** window.SevenYearsApp on care.sevenyears.in (the app only ever loads that site). */
class AppBridge(private val context: Context) {
    @JavascriptInterface
    fun pushToken(): String =
        context.getSharedPreferences("app", Context.MODE_PRIVATE).getString("push_token", "") ?: ""

    @JavascriptInterface
    fun platform(): String = "android"

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
