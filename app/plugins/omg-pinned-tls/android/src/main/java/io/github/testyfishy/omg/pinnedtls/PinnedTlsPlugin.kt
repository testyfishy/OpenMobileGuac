package io.github.testyfishy.omg.pinnedtls

import android.util.Base64
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

/**
 * `PinnedTls` (SRV-8, docs/tls.md): HTTPS requests and WebSockets that accept exactly one
 * user-pinned certificate. JS side: `app/src/core/tls/plugin.ts`. Used only for servers the
 * user pinned; every other connection stays on the WebView / CapacitorHttp.
 */
@CapacitorPlugin(name = "PinnedTls")
class PinnedTlsPlugin : Plugin(), SocketEvents {
    private val io: ExecutorService = Executors.newCachedThreadPool()
    private val sockets = ConcurrentHashMap<String, PinnedSocket>()

    private fun pinsOf(call: PluginCall): Set<String>? {
        val list = try {
            call.getArray("pins")?.toList<Any>()?.map { it.toString() }
        } catch (_: Exception) {
            null
        } ?: return null
        val pins = list.toSet()
        return if (pins.isNotEmpty() && pins.all { Pins.isFingerprint(it) }) pins else null
    }

    private fun timeoutOf(call: PluginCall, default: Int): Long =
        (call.getInt("timeoutMs") ?: default).coerceIn(1000, 120_000).toLong()

    private fun reject(call: PluginCall, t: Throwable) {
        val (code, der) = Failure.classify(t)
        val data = JSObject()
        if (der != null) data.put("der", Base64.encodeToString(der, Base64.NO_WRAP))
        call.reject(t.message ?: code, code, null, data)
    }

    @PluginMethod
    fun inspect(call: PluginCall) {
        val endpoint = Endpoint.of(call.getString("url"))
        if (endpoint == null) {
            call.reject("An https URL is required", Failure.BAD_REQUEST)
            return
        }
        val timeout = timeoutOf(call, 10_000).toInt()
        io.execute {
            try {
                val der = Inspector.leafCertificate(endpoint, timeout)
                call.resolve(JSObject().put("der", Base64.encodeToString(der, Base64.NO_WRAP)))
            } catch (t: Throwable) {
                // Inspection never reports PIN_MISMATCH; a failed connect is unreachable/timeout.
                val (code, _) = Failure.classify(t)
                call.reject(t.message ?: code, if (code == Failure.PIN_MISMATCH) Failure.TLS else code)
            }
        }
    }

    @PluginMethod
    fun request(call: PluginCall) {
        val url = call.getString("url")
        val endpoint = Endpoint.of(url)
        val pins = pinsOf(call)
        if (url == null || endpoint == null || pins == null || url.startsWith("wss:", true)) {
            call.reject("An https URL and pins are required", Failure.BAD_REQUEST)
            return
        }
        val method = (call.getString("method") ?: "GET").uppercase()
        val timeout = timeoutOf(call, 15_000)
        val headers = call.getObject("headers") ?: JSObject()
        val contentType = headers.keys().asSequence()
            .firstOrNull { it.equals("Content-Type", ignoreCase = true) }
            ?.let { headers.getString(it) }
        val data = call.getString("data")
        val request = try {
            val builder = Request.Builder().url(url)
            for (key in headers.keys()) headers.getString(key)?.let { builder.header(key, it) }
            val body = when {
                method == "GET" || method == "HEAD" -> null
                data != null -> data.toByteArray(Charsets.UTF_8).toRequestBody(contentType?.toMediaTypeOrNull())
                method == "DELETE" -> null
                else -> ByteArray(0).toRequestBody(null)
            }
            builder.method(method, body).build()
        } catch (e: IllegalArgumentException) {
            call.reject(e.message ?: "Invalid request", Failure.BAD_REQUEST)
            return
        }
        val client = PinnedClients.forEndpoint(endpoint, pins).newBuilder()
            .connectTimeout(timeout, TimeUnit.MILLISECONDS)
            .readTimeout(timeout, TimeUnit.MILLISECONDS)
            .writeTimeout(timeout, TimeUnit.MILLISECONDS)
            .callTimeout(timeout, TimeUnit.MILLISECONDS)
            .build()
        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(c: Call, e: IOException) = reject(call, e)

            override fun onResponse(c: Call, response: Response) {
                response.use {
                    try {
                        val out = JSObject()
                        for ((name, values) in it.headers.toMultimap()) {
                            out.put(name, values.joinToString(", "))
                        }
                        val text = it.body?.string() ?: ""
                        call.resolve(JSObject().put("status", it.code).put("headers", out).put("data", text))
                    } catch (e: IOException) {
                        reject(call, e)
                    }
                }
            }
        })
    }

    @PluginMethod
    fun openSocket(call: PluginCall) {
        val id = call.getString("id")
        val url = call.getString("url")
        val endpoint = Endpoint.of(url)
        val pins = pinsOf(call)
        if (id.isNullOrEmpty() || url == null || endpoint == null || pins == null || sockets.containsKey(id)) {
            call.reject("An id, a wss URL and pins are required", Failure.BAD_REQUEST)
            return
        }
        val protocols = try {
            call.getArray("protocols")?.toList<Any>()?.map { it.toString() } ?: emptyList()
        } catch (_: Exception) {
            emptyList()
        }
        val timeout = timeoutOf(call, 15_000)
        val socket = PinnedSocket(id, this)
        try {
            val builder = Request.Builder().url(url)
            if (protocols.isNotEmpty()) builder.header("Sec-WebSocket-Protocol", protocols.joinToString(", "))
            val client = PinnedClients.forEndpoint(endpoint, pins).newBuilder()
                .connectTimeout(timeout, TimeUnit.MILLISECONDS)
                .readTimeout(timeout, TimeUnit.MILLISECONDS) // handshake only; OkHttp clears it after
                .build()
            sockets[id] = socket
            socket.webSocket = client.newWebSocket(builder.build(), socket)
            call.resolve()
        } catch (e: IllegalArgumentException) {
            sockets.remove(id)
            call.reject(e.message ?: "Invalid URL", Failure.BAD_REQUEST)
        }
    }

    @PluginMethod
    fun send(call: PluginCall) {
        val id = call.getString("id") ?: ""
        val ws = sockets[id]?.webSocket
        if (ws == null) {
            call.reject("Socket is closed", Failure.UNREACHABLE)
            return
        }
        val messages = try {
            call.getArray("messages")?.toList<Any>()?.map { it.toString() } ?: emptyList()
        } catch (_: Exception) {
            emptyList()
        }
        for (m in messages) {
            if (!ws.send(m)) {
                call.reject("Socket is closing or its send queue is full", Failure.UNREACHABLE)
                return
            }
        }
        // Outbound backpressure: resolve once OkHttp's queue is short again, so JS (which has
        // one send in flight) waits instead of piling frames up.
        if (ws.queueSize() <= SEND_LOW_WATER) {
            call.resolve()
            return
        }
        io.execute {
            while (ws.queueSize() > SEND_LOW_WATER && sockets.containsKey(id)) Thread.sleep(10)
            call.resolve()
        }
    }

    @PluginMethod
    fun ack(call: PluginCall) {
        sockets[call.getString("id") ?: ""]?.ack()
        call.resolve()
    }

    @PluginMethod
    fun closeSocket(call: PluginCall) {
        val socket = sockets[call.getString("id") ?: ""]
        if (socket != null) {
            socket.discard()
            val ws = socket.webSocket
            val code = call.getInt("code") ?: 1000
            val reason = call.getString("reason")?.takeIf { it.isNotEmpty() }
            val closing = try {
                ws?.close(if (code == 1000 || code in 3000..4999) code else 1000, reason) ?: false
            } catch (_: IllegalArgumentException) {
                false
            }
            if (!closing) ws?.cancel()
        }
        call.resolve()
    }

    override fun handleOnDestroy() {
        for (s in sockets.values) {
            s.discard()
            s.webSocket?.cancel()
        }
        sockets.clear()
        io.shutdownNow()
    }

    // ---- SocketEvents -------------------------------------------------------------------

    override fun onSocketOpen(id: String, protocol: String?) {
        val e = JSObject().put("id", id).put("type", "open")
        if (protocol != null) e.put("protocol", protocol)
        notifyListeners("socket", e)
    }

    override fun onSocketMessages(id: String, messages: List<String>) {
        notifyListeners(
            "socket",
            JSObject().put("id", id).put("type", "messages").put("messages", JSArray(messages)),
        )
    }

    override fun onSocketClose(id: String, code: Int, reason: String, error: String?, der: ByteArray?) {
        sockets.remove(id)
        val e = JSObject().put("id", id).put("type", "close").put("code", code).put("reason", reason)
        if (error != null) e.put("error", error)
        if (der != null) e.put("der", Base64.encodeToString(der, Base64.NO_WRAP))
        notifyListeners("socket", e)
    }

    private companion object {
        const val SEND_LOW_WATER = 1L * 1024 * 1024
    }
}
