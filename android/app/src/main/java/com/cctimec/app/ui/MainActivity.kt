package com.cctimec.app.ui

import android.annotation.SuppressLint
import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.provider.Settings
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.cctimec.app.R
import com.cctimec.app.network.ApiClient
import com.cctimec.app.service.AppMonitorService
import com.cctimec.app.service.TimeOverlayService
import com.google.android.material.tabs.TabLayout
import com.google.gson.JsonObject
import java.net.InetAddress
import java.net.NetworkInterface

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var apiClient: ApiClient
    private var serverUrl = ""

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        serverUrl = getPrefs().getString("server_url", "") ?: ""
        if (serverUrl.isEmpty()) {
            serverUrl = detectServer()
            getPrefs().edit().putString("server_url", serverUrl).apply()
        }

        apiClient = ApiClient(serverUrl)
        setupWebView()
        setupTabs()
        requestPermissions()
        startServices()
        connectAndSync()
    }

    private fun getPrefs() = getSharedPreferences("cctimec", Context.MODE_PRIVATE)

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView = findViewById(R.id.webView)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
            allowContentAccess = true
        }
        webView.webViewClient = WebViewClient()
        webView.webChromeClient = WebChromeClient()
        webView.setBackgroundColor(0xFF0A0A0F.toInt())
        webView.loadUrl(serverUrl)
    }

    private fun setupTabs() {
        val tabLayout = findViewById<TabLayout>(R.id.tabLayout)
        val tabs = listOf("\u65f6\u95f4", "\u756a\u8304\u949f", "\u8bb0\u5f55", "AI\u603b\u7ed3", "\u8bbe\u7f6e")
        val pages = listOf("time", "pomodoro", "records", "summaries", "settings")
        tabs.forEach { tabLayout.addTab(tabLayout.newTab().setText(it)) }
        tabLayout.addOnTabSelectedListener(object : TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: TabLayout.Tab) {
                val page = pages.getOrElse(tab.position) { "time" }
                webView.evaluateJavascript(
                    "document.querySelectorAll('nav button').forEach((b,i)=>{if(i===${tab.position}){b.click()}})", null)
            }
            override fun onTabUnselected(tab: TabLayout.Tab) {}
            override fun onTabReselected(tab: TabLayout.Tab) {}
        })
    }

    private fun requestPermissions() {
        if (!Settings.canDrawOverlays(this)) {
            val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))
            startActivity(intent)
            Toast.makeText(this, "\u8bf7\u6388\u4e88\u60ac\u6d6e\u7a97\u6743\u9650", Toast.LENGTH_LONG).show()
        }
        if (!hasUsageStatsPermission()) {
            startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
            Toast.makeText(this, "\u8bf7\u6388\u4e88\u4f7f\u7528\u60c5\u51b5\u8bbf\u95ee\u6743\u9650", Toast.LENGTH_LONG).show()
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 100)
        }
    }

    private fun hasUsageStatsPermission(): Boolean {
        val appOps = getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), packageName)
        return mode == AppOpsManager.MODE_ALLOWED
    }

    private fun startServices() {
        if (Settings.canDrawOverlays(this)) {
            val overlayIntent = Intent(this, TimeOverlayService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(overlayIntent)
            else startService(overlayIntent)
        }
        val monitorIntent = Intent(this, AppMonitorService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(monitorIntent)
        else startService(monitorIntent)
    }

    private fun connectAndSync() {
        apiClient.onStateUpdate = { state -> runOnUiThread { updateOverlayService(state) } }
        apiClient.connectWS()
    }

    private fun updateOverlayService(state: JsonObject) {
        if (Settings.canDrawOverlays(this)) {
            val intent = Intent(this, TimeOverlayService::class.java)
            intent.putExtra("state", state.toString())
            startService(intent)
        }
    }

    private fun detectServer(): String {
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val ni = interfaces.nextElement()
                val addrs = ni.inetAddresses
                while (addrs.hasMoreElements()) {
                    val addr = addrs.nextElement()
                    if (!addr.isLoopbackAddress && addr is java.net.Inet4Address) {
                        val ip = addr.hostAddress ?: continue
                        if (ip.startsWith("192.168.") || ip.startsWith("10.") || ip.startsWith("172.")) {
                            val parts = ip.split(".")
                            val lanBase = "${parts[0]}.${parts[1]}.${parts[2]}"
                            for (lastOctet in listOf(1, 100, 2, 200)) {
                                try {
                                    val testAddr = InetAddress.getByName("$lanBase.$lastOctet")
                                    if (testAddr.isReachable(500)) {
                                        return "http://$lanBase.$lastOctet:3000"
                                    }
                                } catch (_: Exception) {}
                            }
                        }
                    }
                }
            }
        } catch (_: Exception) {}
        return "http://192.168.1.100:3000"
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }

    override fun onDestroy() {
        apiClient.close()
        super.onDestroy()
    }
}
