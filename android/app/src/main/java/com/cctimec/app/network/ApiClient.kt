package com.cctimec.app.network

import com.google.gson.Gson
import com.google.gson.JsonObject
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiClient(private var baseUrl: String) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()
    private val gson = Gson()
    private val JSON_TYPE = "application/json".toMediaType()
    private var ws: WebSocket? = null
    var onStateUpdate: ((JsonObject) -> Unit)? = null

    fun setServer(url: String) {
        baseUrl = url.trimEnd('/')
        reconnectWS()
    }

    fun getServerUrl() = baseUrl

    fun get(path: String, callback: (JsonObject?) -> Unit) {
        val req = Request.Builder().url("$baseUrl/api$path").build()
        client.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { callback(null) }
            override fun onResponse(call: Call, response: Response) {
                response.use {
                    val body = it.body?.string() ?: return callback(null)
                    callback(gson.fromJson(body, JsonObject::class.java))
                }
            }
        })
    }

    fun post(path: String, data: Any? = null, callback: ((JsonObject?) -> Unit)? = null) {
        val json = if (data != null) gson.toJson(data) else "{}"
        val req = Request.Builder().url("$baseUrl/api$path")
            .post(json.toRequestBody(JSON_TYPE)).build()
        client.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { callback?.invoke(null) }
            override fun onResponse(call: Call, response: Response) {
                response.use {
                    val body = it.body?.string() ?: return callback?.invoke(null)!!
                    callback?.invoke(gson.fromJson(body, JsonObject::class.java))
                }
            }
        })
    }

    fun delete(path: String, callback: ((JsonObject?) -> Unit)? = null) {
        val req = Request.Builder().url("$baseUrl/api$path").delete().build()
        client.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { callback?.invoke(null) }
            override fun onResponse(call: Call, response: Response) {
                response.use {
                    val body = it.body?.string() ?: return callback?.invoke(null)!!
                    callback?.invoke(gson.fromJson(body, JsonObject::class.java))
                }
            }
        })
    }

    fun connectWS() {
        val wsUrl = baseUrl.replace("http://", "ws://").replace("https://", "wss://") + "/"
        val req = Request.Builder().url(wsUrl).build()
        ws = client.newWebSocket(req, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val json = gson.fromJson(text, JsonObject::class.java)
                    onStateUpdate?.invoke(json)
                } catch (_: Exception) {}
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({ reconnectWS() }, 3000)
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({ reconnectWS() }, 3000)
            }
        })
    }

    fun reconnectWS() {
        ws?.close(1000, "reconnect")
        connectWS()
    }

    fun close() {
        ws?.close(1000, "closing")
    }
}
