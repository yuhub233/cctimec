package com.cctimec.app.service

import android.app.*
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import com.cctimec.app.network.ApiClient
import com.cctimec.app.ui.MainActivity

class AppMonitorService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private var apiClient: ApiClient? = null
    private val CHANNEL_ID = "cctimec_monitor"
    private val NOTIF_ID = 2
    private val CHECK_INTERVAL = 5000L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIF_ID, buildNotification())
        val prefs = getSharedPreferences("cctimec", Context.MODE_PRIVATE)
        val server = prefs.getString("server_url", "http://192.168.1.100:3001") ?: "http://192.168.1.100:3001"
        apiClient = ApiClient(server)
        startMonitoring()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "\u5e94\u7528\u76d1\u63a7", NotificationManager.IMPORTANCE_MIN)
            channel.setShowBadge(false)
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val pi = PendingIntent.getActivity(this, 0,
            Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("CCTimeC \u76d1\u63a7")
            .setContentText("\u6b63\u5728\u76d1\u63a7\u524d\u53f0\u5e94\u7528")
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentIntent(pi)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    private fun startMonitoring() {
        handler.postDelayed(object : Runnable {
            override fun run() {
                checkForegroundApp()
                handler.postDelayed(this, CHECK_INTERVAL)
            }
        }, CHECK_INTERVAL)
    }

    private fun checkForegroundApp() {
        val usm = getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return
        val now = System.currentTimeMillis()
        val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, now - 10000, now)
        if (stats.isNullOrEmpty()) return
        val recent = stats.maxByOrNull { it.lastTimeUsed } ?: return
        val pkg = recent.packageName
        if (pkg == packageName) return
        val deviceId = Build.MODEL + "_" + Build.SERIAL
        val data = mapOf("packageName" to pkg, "deviceId" to deviceId)
        apiClient?.post("/foreground", data)
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        apiClient?.close()
        super.onDestroy()
    }
}
