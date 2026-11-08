package com.sevenyears.care

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.view.View
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File

/**
 * Seven Years Care — one app for customers and staff.
 * It shows care.sevenyears.in/app, which sends each person to the right place after login
 * (customers → My Warranties, staff → Staff dashboard).
 */
class MainActivity : ComponentActivity() {

    companion object {
        private const val HOST = "care.sevenyears.in"
        private const val START_URL = "https://$HOST/app"
        private const val APP_TAG = "SevenYearsCareApp"
    }

    private lateinit var web: WebView
    private lateinit var progress: ProgressBar
    private lateinit var offline: LinearLayout

    private var firstPageLoaded = false
    private var pageFailed = false

    // Photo picking for <input type="file"> (service request photos)
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var cameraPhoto: Uri? = null

    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    /** Android 13+: ask once to allow notifications. */
    private fun askForNotifications() {
        if (Build.VERSION.SDK_INT < 33) return
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    // Location for the website's "use my current location" button
    private var geoOrigin: String? = null
    private var geoCallback: GeolocationPermissions.Callback? = null
    private val askLocation = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val granted = result.values.any { it }
        geoCallback?.invoke(geoOrigin, granted, false)
        geoCallback = null
        geoOrigin = null
    }

    private fun hasLocation() =
        checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = fileCallback ?: return@registerForActivityResult
        fileCallback = null
        var uris: Array<Uri>? = null
        if (result.resultCode == RESULT_OK) {
            val data = result.data
            val clip = data?.clipData
            uris = when {
                clip != null && clip.itemCount > 0 -> Array(clip.itemCount) { clip.getItemAt(it).uri }
                data?.data != null -> arrayOf(data.data!!)
                else -> cameraPhoto?.takeIf { photoWasSaved() }?.let { arrayOf(it) }
            }
        }
        cameraPhoto = null
        callback.onReceiveValue(uris)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        splash.setKeepOnScreenCondition { !firstPageLoaded }
        // Never keep the splash longer than 4 seconds, even on a slow connection.
        window.decorView.postDelayed({ firstPageLoaded = true }, 4000)

        enableEdgeToEdge()
        setContentView(R.layout.activity_main)
        val root = findViewById<View>(R.id.root)
        web = findViewById(R.id.web)
        progress = findViewById(R.id.progress)
        offline = findViewById(R.id.offline)

        // Keep the page clear of the status bar, navigation bar and keyboard.
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        WindowCompat.getInsetsController(window, root).apply {
            isAppearanceLightStatusBars = true
            isAppearanceLightNavigationBars = true
        }

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = false
            displayZoomControls = false
            allowFileAccess = false
            mediaPlaybackRequiresUserGesture = true
            setGeolocationEnabled(true)
            // Lets the website know it is running inside the app.
            userAgentString = "$userAgentString $APP_TAG/${BuildConfigInfo.versionName(this@MainActivity)}"
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, true)
        }

        web.webViewClient = AppWebViewClient()
        web.webChromeClient = AppChromeClient()
        web.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            download(url, userAgent, contentDisposition, mimeType)
        }

        findViewById<Button>(R.id.retry).setOnClickListener { retry() }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    offline.visibility == View.VISIBLE && web.canGoBack() -> {
                        offline.visibility = View.GONE
                        web.goBack()
                    }
                    web.canGoBack() -> web.goBack()
                    else -> finish()
                }
            }
        })

        if (savedInstanceState == null) window.decorView.postDelayed({ askForNotifications() }, 1500)

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState)
        } else {
            web.loadUrl(linkFrom(intent) ?: START_URL)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        linkFrom(intent)?.let { web.loadUrl(it) }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush() // stay logged in
    }

    /** A care.sevenyears.in link the app was opened with (e.g. tapped in WhatsApp). */
    private fun linkFrom(intent: Intent?): String? {
        val uri = intent?.data ?: return null
        return if (uri.scheme == "https" && uri.host == HOST) uri.toString() else null
    }

    private fun retry() {
        pageFailed = false
        offline.visibility = View.GONE
        val current = web.url
        if (current.isNullOrBlank() || current.startsWith("about:")) web.loadUrl(START_URL) else web.reload()
    }

    private fun isOurSite(uri: Uri) = (uri.scheme == "https" || uri.scheme == "http") && uri.host == HOST

    /** Anything that is not our website (WhatsApp, phone, maps, Google…) opens in its own app. */
    private fun openOutside(uri: Uri) {
        try {
            val intent = if (uri.scheme == "intent") {
                Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME).apply {
                    addCategory(Intent.CATEGORY_BROWSABLE)
                    component = null
                    selector = null
                }
            } else {
                Intent(Intent.ACTION_VIEW, uri)
            }
            startActivity(intent)
        } catch (e: Exception) {
            Toast.makeText(this, R.string.no_app, Toast.LENGTH_SHORT).show()
        }
    }

    private fun download(url: String, userAgent: String, contentDisposition: String?, mimeType: String?) {
        val uri = Uri.parse(url)
        if (uri.scheme != "https" || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            openOutside(uri) // older phones: let the browser download it
            return
        }
        try {
            val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
            val request = DownloadManager.Request(uri)
                .setMimeType(mimeType)
                .addRequestHeader("User-Agent", userAgent)
                .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url) ?: "")
                .setTitle(name)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
            (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
            Toast.makeText(this, R.string.downloading, Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            openOutside(uri)
        }
    }

    private fun photoWasSaved(): Boolean {
        val uri = cameraPhoto ?: return false
        return try {
            contentResolver.openFileDescriptor(uri, "r")?.use { it.statSize > 0 } ?: false
        } catch (e: Exception) {
            false
        }
    }

    private fun newCameraPhoto(): Uri? = try {
        val dir = File(cacheDir, "photos").apply { mkdirs() }
        // Old photos are uploaded already; clear them so the app doesn't grow.
        dir.listFiles()?.forEach { if (System.currentTimeMillis() - it.lastModified() > 86_400_000) it.delete() }
        val file = File.createTempFile("photo_", ".jpg", dir)
        FileProvider.getUriForFile(this, "$packageName.files", file)
    } catch (e: Exception) {
        null
    }

    private inner class AppWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            if (isOurSite(uri)) return false
            openOutside(uri)
            return true
        }

        override fun onPageFinished(view: WebView, url: String?) {
            firstPageLoaded = true
            progress.visibility = View.GONE
            if (!pageFailed) offline.visibility = View.GONE
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            pageFailed = true
            firstPageLoaded = true
            offline.visibility = View.VISIBLE
        }
    }

    private inner class AppChromeClient : WebChromeClient() {
        override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback?) {
            if (callback == null) return
            val ours = origin?.let { Uri.parse(it).host == HOST } == true
            when {
                !ours -> callback.invoke(origin, false, false)
                hasLocation() -> callback.invoke(origin, true, false)
                else -> {
                    geoOrigin = origin
                    geoCallback = callback
                    askLocation.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                }
            }
        }

        override fun onProgressChanged(view: WebView, newProgress: Int) {
            progress.progress = newProgress
            progress.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
        }

        override fun onShowFileChooser(
            webView: WebView,
            filePathCallback: ValueCallback<Array<Uri>>,
            params: FileChooserParams,
        ): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = filePathCallback

            val gallery = params.createIntent().apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            }
            val wantsImages = params.acceptTypes.any { it.isBlank() || it.startsWith("image") }
            cameraPhoto = if (wantsImages) newCameraPhoto() else null
            val camera = cameraPhoto?.let {
                Intent(MediaStore.ACTION_IMAGE_CAPTURE)
                    .putExtra(MediaStore.EXTRA_OUTPUT, it)
                    .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            val chooser = when {
                camera != null && params.isCaptureEnabled -> camera
                camera != null -> Intent.createChooser(gallery, getString(R.string.choose_photo))
                    .putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(camera))
                else -> gallery
            }
            return try {
                pickFiles.launch(chooser)
                true
            } catch (e: ActivityNotFoundException) {
                fileCallback = null
                cameraPhoto = null
                false
            }
        }
    }
}

/** App version for the browser tag, without needing the BuildConfig feature. */
private object BuildConfigInfo {
    fun versionName(activity: ComponentActivity): String = try {
        activity.packageManager.getPackageInfo(activity.packageName, 0).versionName ?: "1.0"
    } catch (e: Exception) {
        "1.0"
    }
}
