package com.steadytv.app

import android.annotation.SuppressLint
import android.content.Context
import android.os.Bundle
import android.speech.tts.TextToSpeech
import java.util.Locale
import java.net.HttpURLConnection
import java.net.URL
import android.view.View
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity

/**
 * Gives the web page Android's own text-to-speech (a WebView has no speech engine of its own).
 * The page sees it as window.SteadyNative.
 */
class SpeechBridge(context: Context) : TextToSpeech.OnInitListener {
    private val tts = TextToSpeech(context.applicationContext, this)
    @Volatile private var ready = false

    override fun onInit(status: Int) {
        ready = status == TextToSpeech.SUCCESS
        if (ready) tts.setSpeechRate(0.9f)
    }

    private fun localeFor(lang: String) = if (lang == "hi") Locale("hi", "IN") else Locale.US

    @JavascriptInterface
    fun hasLang(lang: String): Boolean =
        ready && tts.isLanguageAvailable(localeFor(lang)) >= TextToSpeech.LANG_AVAILABLE

    @JavascriptInterface
    fun speak(text: String, lang: String) {
        if (!ready) return
        val result = tts.setLanguage(localeFor(lang))
        if (result < TextToSpeech.LANG_AVAILABLE) return // voice not installed: the page still shows captions
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "steadytv")
    }

    @JavascriptInterface
    fun stop() { if (ready) tts.stop() }

    fun shutdown() { tts.stop(); tts.shutdown() }
}

/**
 * Minimal Fire OS / Android TV shell: it just shows the SteadyTV web UI full screen.
 * It first tries the home hub (server.js) on this network: 10.0.2.2 is the Android emulator's
 * alias for "the computer the emulator runs on". If no hub answers, it opens the hosted web
 * version instead, so the app also works on a Fire TV with no computer around (demo mode).
 *
 * The remote's Back button is passed to the web page first (so it goes back one screen);
 * only when the page has nothing to go back to does the app close.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var speech: SpeechBridge
    private val hubUrl = "http://10.0.2.2:3000/tv/"
    // Change this to your own GitHub Pages address after you publish (see README).
    private val hostedUrl = "https://guptamanaswi123-arch.github.io/steadytv/tv/"
    private var usingHosted = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        web = WebView(this)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_NO_CACHE
        }
        web.webViewClient = object : WebViewClient() {
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                // The hub is not running (or not reachable): fall back to the hosted version once.
                if (request.isForMainFrame && !usingHosted) {
                    usingHosted = true
                    view.loadUrl(hostedUrl)
                }
            }
        }
        web.webChromeClient = WebChromeClient()
        web.setBackgroundColor(0xFF0F2624.toInt())
        web.isFocusable = true
        web.requestFocus()
        speech = SpeechBridge(this)
        web.addJavascriptInterface(speech, "SteadyNative")
        // Quick check (1.5 s) so a Fire TV without a hub does not wait for a long network timeout.
        Thread {
            val hubUp = try {
                val c = URL(hubUrl.replace("/tv/", "/api/health")).openConnection() as HttpURLConnection
                c.connectTimeout = 1500; c.readTimeout = 1500
                val ok = c.responseCode == 200
                c.disconnect(); ok
            } catch (e: Exception) { false }
            runOnUiThread {
                usingHosted = !hubUp
                web.loadUrl(if (hubUp) hubUrl else hostedUrl)
            }
        }.start()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val js = "(function(){var e=new KeyboardEvent('keydown',{key:'GoBack',cancelable:true});" +
                    "document.dispatchEvent(e);return e.defaultPrevented;})()"
                web.evaluateJavascript(js) { handled ->
                    if (handled != "true") {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                    }
                }
            }
        })
    }

    override fun onDestroy() {
        speech.shutdown()
        super.onDestroy()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)
        }
    }
}
