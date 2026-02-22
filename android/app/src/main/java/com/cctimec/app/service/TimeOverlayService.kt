package com.cctimec.app.service

import android.app.*
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.WindowManager
import android.widget.TextView
import androidx.core.app.NotificationCompat
import com.cctimec.app.ui.MainActivity
import com.google.gson.JsonObject

class TimeOverlayService : Service() {
    private var overlayView: TextView? = null
    private var windowManager: WindowManager? = null
    private var currentState: JsonObject? = null
    private val CHANNEL_ID = "cctimec_overlay"
    private val NOTIF_ID = 1

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIF_ID, buildNotification("CCTimeC \u8fd0\u884c\u4e2d"))
        createOverlay()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        intent?.getStringExtra("state")?.let {
            try {
                currentState = com.google.gson.Gson().fromJson(it, JsonObject::class.java)
                updateOverlay()
                updateNotification()
            } catch (_: Exception) {}
        }
        return START_STICKY
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "\u65f6\u95f4\u60ac\u6d6e\u7a97", NotificationManager.IMPORTANCE_LOW)
            channel.setShowBadge(false)
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        val pi = PendingIntent.getActivity(this, 0,
            Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("CCTimeC")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_recent_history)
            .setContentIntent(pi)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    private fun updateNotification() {
        val time = currentState?.getAsJsonObject("time")
        val displayTime = time?.get("displayTime")?.asString ?: "--:--"
        val speed = time?.get("speed")?.asFloat ?: 0f
        val status = time?.get("status")?.asString ?: "unknown"
        val statusText = when(status) {
            "sleeping" -> "\u7761\u7720\u4e2d"
            "idle" -> "\u7a7a\u95f2"
            "entertainment" -> "\u5a31\u4e50\u4e2d"
            "studying" -> "\u5b66\u4e60\u4e2d"
            else -> status
        }
        val notif = buildNotification("$displayTime | \u00d7${String.format("%.2f", speed)} | $statusText")
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIF_ID, notif)
    }

    private fun createOverlay() {
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        val prefs = getSharedPreferences("cctimec", Context.MODE_PRIVATE)
        val size = prefs.getInt("overlay_size", 16)
        val bgColor = prefs.getString("overlay_bg_color", "#000000") ?: "#000000"
        val textColor = prefs.getString("overlay_text_color", "#00FF00") ?: "#00FF00"

        overlayView = TextView(this).apply {
            text = "--:--"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, size.toFloat())
            setTextColor(Color.parseColor(textColor))
            setBackgroundColor(Color.parseColor(bgColor))
            setPadding(12, 4, 12, 4)
        }

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 0; y = 0
        }

        var initX = 0; var initY = 0; var initTouchX = 0f; var initTouchY = 0f
        overlayView?.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initX = params.x; initY = params.y
                    initTouchX = event.rawX; initTouchY = event.rawY
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    params.x = initX + (event.rawX - initTouchX).toInt()
                    params.y = initY + (event.rawY - initTouchY).toInt()
                    windowManager?.updateViewLayout(overlayView, params)
                    true
                }
                else -> false
            }
        }

        windowManager?.addView(overlayView, params)
    }

    private fun updateOverlay() {
        val time = currentState?.getAsJsonObject("time")
        val displayTime = time?.get("displayTime")?.asString ?: "--:--"
        val speed = time?.get("speed")?.asFloat ?: 0f
        overlayView?.post {
            overlayView?.text = "$displayTime \u00d7${String.format("%.1f", speed)}"
            val ent = currentState?.getAsJsonObject("entertainment")
            val warning = ent?.get("warning")?.asBoolean ?: false
            if (warning) {
                overlayView?.setBackgroundColor(Color.parseColor("#FF0000"))
            } else {
                val prefs = getSharedPreferences("cctimec", Context.MODE_PRIVATE)
                val bgColor = prefs.getString("overlay_bg_color", "#000000") ?: "#000000"
                overlayView?.setBackgroundColor(Color.parseColor(bgColor))
            }
        }
    }

    override fun onDestroy() {
        overlayView?.let { windowManager?.removeView(it) }
        super.onDestroy()
    }
}
