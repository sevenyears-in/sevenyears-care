package com.sevenyears.care

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** Shows offers / updates that arrive while the app is open, and keeps the phone's token fresh. */
class PushService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        getSharedPreferences("app", MODE_PRIVATE).edit().putString("push_token", token).apply()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val title = message.notification?.title ?: message.data["title"] ?: return
        val body = message.notification?.body ?: message.data["body"] ?: ""
        show(this, title, body, message.data["url"], message.data["channel"])
    }

    companion object {
        const val CHANNEL = "offers"
        /** Staff alerts (sales updates, closing reports, stock alerts, tickets) — own sound, chosen on the phone. */
        const val CHANNEL_ALERTS = "staff_alerts"
        /** One quiet notification that keeps the unread number on the app icon (like Gmail). */
        const val CHANNEL_UNREAD = "unread_count"
        const val UNREAD_ID = 7000

        fun createChannel(context: Context) {
            if (Build.VERSION.SDK_INT < 26) return
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, context.getString(R.string.channel_offers), NotificationManager.IMPORTANCE_HIGH)
            )
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ALERTS, context.getString(R.string.channel_alerts), NotificationManager.IMPORTANCE_HIGH).apply {
                    description = context.getString(R.string.channel_alerts_description)
                }
            )
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_UNREAD, context.getString(R.string.channel_unread), NotificationManager.IMPORTANCE_LOW).apply {
                    description = context.getString(R.string.channel_unread_description)
                    setShowBadge(true)
                    setSound(null, null)
                    enableVibration(false)
                }
            )
        }

        /**
         * Keeps the number on the app icon equal to the unread alerts in the app, even after the
         * alert notifications were opened or swiped away. Android shows an icon number only for
         * notifications, so one quiet "N unread alerts" notification carries whatever the alert
         * notifications still in the tray don't already count. 0 unread → everything is cleared.
         */
        fun setUnread(context: Context, unread: Int) {
            val nm = NotificationManagerCompat.from(context)
            try {
                if (unread <= 0) {
                    nm.cancelAll()
                    return
                }
                createChannel(context)
                val inTray = if (Build.VERSION.SDK_INT >= 23) {
                    context.getSystemService(NotificationManager::class.java).activeNotifications
                        .count { it.id != UNREAD_ID && it.packageName == context.packageName }
                } else 0
                val extra = unread - inTray
                if (extra <= 0) {
                    nm.cancel(UNREAD_ID)
                    return
                }
                val open = Intent(context, MainActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                    putExtra("url", "https://care.sevenyears.in/staff/alerts")
                }
                val pending = PendingIntent.getActivity(
                    context, UNREAD_ID, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                val title = if (unread == 1) "1 unread alert" else "$unread unread alerts"
                val n = NotificationCompat.Builder(context, CHANNEL_UNREAD)
                    .setSmallIcon(R.drawable.ic_stat_notify)
                    .setColor(context.getColor(R.color.brand_purple))
                    .setContentTitle(title)
                    .setContentText("Tap to open Alerts")
                    .setNumber(extra)
                    .setBadgeIconType(NotificationCompat.BADGE_ICON_SMALL)
                    .setOnlyAlertOnce(true)
                    .setSilent(true)
                    .setShowWhen(false)
                    .setContentIntent(pending)
                    .setPriority(NotificationCompat.PRIORITY_LOW)
                    .build()
                nm.notify(UNREAD_ID, n)
            } catch (e: SecurityException) {
                // Notifications not allowed on this phone.
            } catch (e: Exception) {
                // Never break the app over the icon number.
            }
        }

        fun show(context: Context, title: String, body: String, url: String?, channel: String? = null) {
            createChannel(context)
            val open = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                if (!url.isNullOrBlank()) putExtra("url", url)
            }
            val pending = PendingIntent.getActivity(
                context, System.currentTimeMillis().toInt(), open,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val n = NotificationCompat.Builder(context, if (channel == CHANNEL_ALERTS) CHANNEL_ALERTS else CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setColor(context.getColor(R.color.brand_purple))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setContentIntent(pending)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .build()
            try {
                NotificationManagerCompat.from(context).notify(System.currentTimeMillis().toInt(), n)
            } catch (e: SecurityException) {
                // Notifications not allowed on this phone.
            }
        }
    }
}
