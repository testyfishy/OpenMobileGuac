package io.github.testyfishy.omg.pinnedtls

// Plain JVM + OkHttp: no android.* or Capacitor imports, so this file can be unit-tested on
// a JVM. The Capacitor glue is PinnedTlsPlugin.kt. Design: docs/tls.md (SRV-8).

import java.io.IOException
import java.io.InterruptedIOException
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.SNIHostName
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLException
import javax.net.ssl.SSLSession
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager
import kotlin.concurrent.withLock
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString

object Pins {
    private val HEX64 = Regex("^[0-9a-f]{64}$")

    fun sha256Hex(der: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(der).joinToString("") { "%02x".format(it) }

    fun isFingerprint(value: String): Boolean = HEX64.matches(value)
}

/** The one scheme/host/port a set of pins is for. Only https and wss URLs qualify. */
data class Endpoint(val host: String, val port: Int) {
    val isIpLiteral: Boolean
        get() = host.contains(':') || IPV4.matches(host)

    fun matches(otherHost: String, otherPort: Int): Boolean =
        normalizeHost(otherHost) == host && otherPort == port

    companion object {
        private val IPV4 = Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")

        fun normalizeHost(host: String): String = host.trim().removePrefix("[").removeSuffix("]").lowercase()

        fun of(url: String?): Endpoint? {
            if (url == null) return null
            val uri = try { URI(url) } catch (_: Exception) { return null }
            val scheme = uri.scheme?.lowercase() ?: return null
            if (scheme != "https" && scheme != "wss") return null
            val host = uri.host?.let { normalizeHost(it) }?.takeIf { it.isNotEmpty() } ?: return null
            val port = if (uri.port == -1) 443 else uri.port
            if (port !in 1..65535) return null
            return Endpoint(host, port)
        }
    }
}

/** The server presented a certificate that is not pinned. Carries it for the UI. */
class PinMismatchException(val der: ByteArray) :
    CertificateException("The server's certificate does not match the trusted one")

/**
 * Accepts a server chain only when the leaf certificate's SHA-256 is one of [pins]. Chain,
 * expiry and host name are deliberately not checked: the user trusted this exact
 * certificate for this exact host and port (bound in JS and by [Endpoint]).
 */
class PinTrustManager(private val pins: Set<String>) : X509TrustManager {
    init {
        require(pins.isNotEmpty() && pins.all { Pins.isFingerprint(it) }) { "invalid pins" }
    }

    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        throw CertificateException("Client certificates are not checked here")
    }

    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        val leaf = chain?.firstOrNull() ?: throw CertificateException("No server certificate")
        val der = leaf.encoded
        if (Pins.sha256Hex(der) !in pins) throw PinMismatchException(der)
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

/** Records the leaf certificate, then always refuses: used to read a certificate only. */
class CapturingTrustManager : X509TrustManager {
    @Volatile
    var leaf: ByteArray? = null
        private set

    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        throw CertificateException("Client certificates are not checked here")
    }

    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        leaf = chain?.firstOrNull()?.encoded
        throw CertificateException("Inspection only: the handshake is always aborted")
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

object Inspector {
    /**
     * Opens a TCP connection, starts a TLS handshake with SNI, captures the server's leaf
     * certificate and aborts. No application data (no HTTP request) is ever sent.
     */
    fun leafCertificate(endpoint: Endpoint, timeoutMs: Int): ByteArray {
        val capture = CapturingTrustManager()
        val context = SSLContext.getInstance("TLS")
        context.init(null, arrayOf<TrustManager>(capture), null)
        Socket().use { raw ->
            raw.connect(InetSocketAddress(endpoint.host, endpoint.port), timeoutMs)
            raw.soTimeout = timeoutMs
            val ssl = context.socketFactory.createSocket(raw, endpoint.host, endpoint.port, true) as SSLSocket
            ssl.use {
                if (!endpoint.isIpLiteral) {
                    try {
                        val params = it.sslParameters
                        params.serverNames = listOf(SNIHostName(endpoint.host))
                        it.sslParameters = params
                    } catch (_: IllegalArgumentException) {
                        // Not a valid SNI name: connect without it.
                    }
                }
                try {
                    it.startHandshake()
                } catch (_: IOException) {
                    // Expected: CapturingTrustManager refuses every certificate.
                }
            }
        }
        return capture.leaf ?: throw SSLException("The server sent no certificate")
    }
}

/** One OkHttp client per endpoint + pin set (never shared with unpinned traffic). */
object PinnedClients {
    private val cache = ConcurrentHashMap<String, OkHttpClient>()

    fun forEndpoint(endpoint: Endpoint, pins: Set<String>): OkHttpClient {
        val key = "${endpoint.host}|${endpoint.port}|${pins.sorted().joinToString(",")}"
        cache[key]?.let { return it }
        if (cache.size > 16) cache.clear()
        val trust = PinTrustManager(pins)
        val context = SSLContext.getInstance("TLS")
        context.init(null, arrayOf<TrustManager>(trust), null)
        // The host-name check is replaced by the pin, re-checked here on the session.
        val verifier = HostnameVerifier { host: String, session: SSLSession ->
            val leaf = try { session.peerCertificates.firstOrNull() } catch (_: Exception) { null }
            endpoint.matches(host, session.peerPort.takeIf { it > 0 } ?: endpoint.port) &&
                leaf != null && Pins.sha256Hex(leaf.encoded) in pins
        }
        // Defence in depth: this client only ever talks to its own endpoint.
        val sameEndpoint = Interceptor { chain ->
            val url = chain.request().url
            if (!endpoint.matches(url.host, url.port)) throw IOException("Host is not pinned")
            chain.proceed(chain.request())
        }
        val client = OkHttpClient.Builder()
            .sslSocketFactory(context.socketFactory, trust)
            .hostnameVerifier(verifier)
            .followRedirects(false)
            .followSslRedirects(false)
            .addInterceptor(sameEndpoint)
            .pingInterval(0, TimeUnit.MILLISECONDS)
            .build()
        cache[key] = client
        return client
    }
}

/** Machine-readable failure codes shared with JS (`core/tls/plugin.ts`). */
object Failure {
    const val PIN_MISMATCH = "PIN_MISMATCH"
    const val TLS = "TLS"
    const val TIMEOUT = "TIMEOUT"
    const val UNREACHABLE = "UNREACHABLE"
    const val BAD_REQUEST = "BAD_REQUEST"

    /** (code, presented certificate for PIN_MISMATCH). */
    fun classify(t: Throwable): Pair<String, ByteArray?> {
        var cause: Throwable? = t
        var tls = false
        var timeout = false
        var depth = 0
        while (cause != null && depth < 16) {
            if (cause is PinMismatchException) return PIN_MISMATCH to cause.der
            if (cause is SSLException || cause is CertificateException) tls = true
            // SocketTimeoutException, and OkHttp's call timeout (a plain InterruptedIOException).
            if (cause is InterruptedIOException) timeout = true
            cause = cause.cause
            depth++
        }
        return when {
            tls -> TLS to null
            timeout -> TIMEOUT to null
            else -> UNREACHABLE to null
        }
    }
}

/** Where a socket's events go (the plugin turns them into `socket` listener events). */
interface SocketEvents {
    fun onSocketOpen(id: String, protocol: String?)
    fun onSocketMessages(id: String, messages: List<String>)
    fun onSocketClose(id: String, code: Int, reason: String, error: String?, der: ByteArray?)
}

/**
 * One pinned WebSocket. Received frames are delivered in batches; the next batch waits for
 * [ack] from JS. While more than [highWaterChars] wait, OkHttp's reader thread is blocked in
 * [onMessage], which stops reading from the network (TCP backpressure). The close event is
 * always last, after every delivered batch.
 */
class PinnedSocket(
    val id: String,
    private val events: SocketEvents,
    private val highWaterChars: Long = 4L * 1024 * 1024,
) : WebSocketListener() {
    private val lock = ReentrantLock()
    private val drained = lock.newCondition()
    private val pending = ArrayList<String>()
    private var pendingChars = 0L
    private var inFlight = false
    private var finished = false
    private var discarded = false
    private var closeDelivered = false
    private var closeEvent: (() -> Unit)? = null

    @Volatile
    var webSocket: WebSocket? = null

    override fun onOpen(webSocket: WebSocket, response: Response) {
        events.onSocketOpen(id, response.header("Sec-WebSocket-Protocol"))
    }

    override fun onMessage(webSocket: WebSocket, text: String) = enqueue(text)

    override fun onMessage(webSocket: WebSocket, bytes: ByteString) = enqueue(bytes.utf8())

    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
        // Echo a code OkHttp accepts: the peer's may be reserved (1005 for an empty Close frame),
        // and close() throws on those. onClosed still reports the peer's own code.
        webSocket.close(1000, null)
    }

    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        finish(code, reason, null, null)
    }

    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        val (code, der) = Failure.classify(t)
        finish(1006, "", code, der)
    }

    private fun enqueue(text: String) {
        var batch: List<String>? = null
        lock.withLock {
            if (discarded || finished) return
            pending.add(text)
            pendingChars += text.length
            if (!inFlight) batch = takeLocked()
        }
        batch?.let { events.onSocketMessages(id, it) }
        lock.withLock {
            while (pendingChars > highWaterChars && !discarded && !finished) {
                drained.await(1, TimeUnit.SECONDS)
            }
        }
    }

    /** JS processed the last batch. */
    fun ack() {
        var batch: List<String>? = null
        var close: (() -> Unit)? = null
        lock.withLock {
            inFlight = false
            if (pending.isNotEmpty()) batch = takeLocked()
            else close = takeCloseLocked()
            drained.signalAll()
        }
        batch?.let { events.onSocketMessages(id, it) }
        close?.invoke()
    }

    /** JS closed the tunnel: deliver nothing more except the final close event. */
    fun discard() {
        var close: (() -> Unit)? = null
        lock.withLock {
            discarded = true
            pending.clear()
            pendingChars = 0
            inFlight = false
            close = takeCloseLocked()
            drained.signalAll()
        }
        close?.invoke()
    }

    private fun finish(code: Int, reason: String, error: String?, der: ByteArray?) {
        var close: (() -> Unit)? = null
        var batch: List<String>? = null
        lock.withLock {
            if (finished) return
            finished = true
            // A failure is never reported as a clean 1000 close.
            val safeCode = if (error != null && code == 1000) 1006 else code
            closeEvent = { events.onSocketClose(id, safeCode, reason, error, der) }
            if (!inFlight && pending.isEmpty()) close = takeCloseLocked()
            else if (!inFlight) batch = takeLocked()
            drained.signalAll()
        }
        batch?.let { events.onSocketMessages(id, it) }
        close?.invoke()
    }

    private fun takeLocked(): List<String> {
        val batch = ArrayList(pending)
        pending.clear()
        pendingChars = 0
        inFlight = true
        drained.signalAll()
        return batch
    }

    private fun takeCloseLocked(): (() -> Unit)? {
        if (!finished || closeDelivered || inFlight || pending.isNotEmpty()) return null
        closeDelivered = true
        return closeEvent
    }
}
