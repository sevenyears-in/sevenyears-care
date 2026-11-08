# Keep the bridge the website uses inside the app (window.SevenYearsApp).
-keepclassmembers class com.sevenyears.care.AppBridge {
    @android.webkit.JavascriptInterface <methods>;
}
