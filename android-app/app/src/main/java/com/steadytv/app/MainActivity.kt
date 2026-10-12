package com.steadytv.app

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity

/**
 * Minimal Fire OS / Android TV shell: it just shows the SteadyTV web UI full screen.
 * 10.0.2.2 is the Android emulator's alias for "the computer the emulator runs on".
 * Change serverUrl if you host the server somewhere else.
 *
 * The remote's Back button is passed to the web page first (so it goes back one screen);
 * only when the page has nothing to go back to does the app close.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private val serverUrl = "http://10.0.2.2:3000/tv"

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
        web.webViewClient = WebViewClient()
        web.webChromeClient = WebChromeClient()
        web.setBackgroundColor(0xFF0B1020.toInt())
        web.isFocusable = true
        web.requestFocus()
        web.loadUrl(serverUrl)

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