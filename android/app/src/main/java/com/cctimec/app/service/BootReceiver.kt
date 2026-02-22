package com.cctimec.app.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            val overlayIntent = Intent(context, TimeOverlayService::class.java)
            val monitorIntent = Intent(context, AppMonitorService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(overlayIntent)
                context.startForegroundService(monitorIntent)
            } else {
                context.startService(overlayIntent)
                context.startService(monitorIntent)
            }
        }
    }
}
