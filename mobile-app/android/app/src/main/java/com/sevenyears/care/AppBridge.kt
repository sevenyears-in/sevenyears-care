package com.sevenyears.care

import android.content.Context
import android.webkit.JavascriptInterface

/** window.SevenYearsApp on care.sevenyears.in (the app only ever loads that site). */
class AppBridge(private val context: Context) {
    @JavascriptInterface
    fun pushToken(): String =
        context.getSharedPreferences("app", Context.MODE_PRIVATE).getString("push_token", "") ?: ""

    @JavascriptInterface
    fun platform(): String = "android"
}
