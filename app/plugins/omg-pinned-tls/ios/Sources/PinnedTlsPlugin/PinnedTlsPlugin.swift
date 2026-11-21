import Foundation
import Capacitor
import CryptoKit
import Security

// PinnedTls (SRV-8, docs/tls.md): HTTPS requests and WebSockets that accept exactly one
// user-pinned certificate. JS side: app/src/core/tls/plugin.ts. Used only for servers the
// user pinned; every other connection stays on the WebView / CapacitorHttp.
//
// Only the plugin class may carry an Objective-C name annotation with a parenthesised name:
// `npx cap sync` registers the first such annotation of every Swift file in this package as
// a plugin class (Capacitor CLI util/iosplugin.js).

@objc(PinnedTlsPlugin)
public class PinnedTlsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PinnedTlsPlugin"
    public let jsName = "PinnedTls"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "inspect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSocket", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ack", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "closeSocket", returnType: CAPPluginReturnPromise)
    ]

    /// All socket state lives on this serial queue (also every URLSession's delegate queue).
    let queue = DispatchQueue(label: "io.github.testyfishy.omg.pinnedtls")
    private var sockets: [String: PinnedSocket] = [:]

    // MARK: - inspect

    @objc func inspect(_ call: CAPPluginCall) {
        guard let url = call.getString("url").flatMap({ URL(string: $0) }),
              let endpoint = Endpoint(url: url),
              let probeUrl = URL(string: "https://\(endpoint.urlHost):\(endpoint.port)/") else {
            call.reject("An https URL is required", Failure.badRequest)
            return
        }
        let timeout = PinnedTlsPlugin.timeout(call, 10_000)
        let delegate = PinDelegate(endpoint: endpoint, pins: [], inspectOnly: true)
        let session = makeSession(delegate: delegate, timeout: timeout)
        var request = URLRequest(url: probeUrl, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = "HEAD"
        // The delegate cancels the challenge, so this request is never sent: only the TLS
        // handshake runs, far enough to read the leaf certificate.
        let task = session.dataTask(with: request) { _, _, error in
            session.finishTasksAndInvalidate()
            if let der = delegate.presentedDer {
                call.resolve(["der": der.base64EncodedString()])
            } else {
                let code = Failure.classify(error, delegate: delegate)
                call.reject(error?.localizedDescription ?? "No certificate", code == Failure.pinMismatch ? Failure.tls : code)
            }
        }
        task.resume()
    }

    // MARK: - request

    @objc func request(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"),
              let url = URL(string: urlString),
              url.scheme?.lowercased() == "https",
              let endpoint = Endpoint(url: url),
              let pins = PinnedTlsPlugin.pins(call) else {
            call.reject("An https URL and pins are required", Failure.badRequest)
            return
        }
        let timeout = PinnedTlsPlugin.timeout(call, 15_000)
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = (call.getString("method") ?? "GET").uppercased()
        if let headers = call.getObject("headers") {
            for (key, value) in headers {
                if let text = value as? String { request.setValue(text, forHTTPHeaderField: key) }
            }
        }
        if let data = call.getString("data"), request.httpMethod != "GET", request.httpMethod != "HEAD" {
            request.httpBody = Data(data.utf8)
        }
        let delegate = PinDelegate(endpoint: endpoint, pins: pins, inspectOnly: false)
        let session = makeSession(delegate: delegate, timeout: timeout)
        let task = session.dataTask(with: request) { data, response, error in
            session.finishTasksAndInvalidate()
            guard error == nil, let http = response as? HTTPURLResponse else {
                PinnedTlsPlugin.reject(call, error: error, delegate: delegate)
                return
            }
            var headers: [String: String] = [:]
            for (key, value) in http.allHeaderFields {
                if let k = key as? String { headers[k] = "\(value)" }
            }
            let text = data.map { String(decoding: $0, as: UTF8.self) } ?? ""
            call.resolve(["status": http.statusCode, "headers": headers, "data": text])
        }
        task.resume()
    }

    // MARK: - sockets

    @objc func openSocket(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.isEmpty,
              let url = call.getString("url").flatMap({ URL(string: $0) }),
              url.scheme?.lowercased() == "wss",
              let endpoint = Endpoint(url: url),
              let pins = PinnedTlsPlugin.pins(call) else {
            call.reject("An id, a wss URL and pins are required", Failure.badRequest)
            return
        }
        let protocols = call.getArray("protocols", String.self) ?? []
        let timeout = PinnedTlsPlugin.timeout(call, 15_000)
        queue.async {
            if self.sockets[id] != nil {
                call.reject("Duplicate socket id", Failure.badRequest)
                return
            }
            let delegate = PinDelegate(endpoint: endpoint, pins: pins, inspectOnly: false)
            let session = self.makeSession(delegate: delegate, timeout: timeout)
            let task = session.webSocketTask(with: url, protocols: protocols)
            task.maximumMessageSize = 16 * 1024 * 1024
            let socket = PinnedSocket(id: id, plugin: self, session: session, task: task, delegate: delegate)
            delegate.socket = socket
            self.sockets[id] = socket
            task.resume()
            socket.receiveNext()
            call.resolve()
        }
    }

    @objc func send(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
        let messages = call.getArray("messages", String.self) ?? []
        queue.async {
            guard let socket = self.sockets[id] else {
                call.reject("Socket is closed", Failure.unreachable)
                return
            }
            socket.send(messages) { ok in
                if ok { call.resolve() } else { call.reject("Send failed", Failure.unreachable) }
            }
        }
    }

    @objc func ack(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
        queue.async {
            self.sockets[id]?.ack()
            call.resolve()
        }
    }

    @objc func closeSocket(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
        let code = call.getInt("code") ?? 1000
        let reason = call.getString("reason") ?? ""
        queue.async {
            self.sockets[id]?.close(code: code, reason: reason)
            call.resolve()
        }
    }

    // Called on `queue` by PinnedSocket.
    func emit(_ event: [String: Any]) {
        notifyListeners("socket", data: event)
    }

    func forget(_ id: String) {
        sockets.removeValue(forKey: id)
    }

    // MARK: - helpers

    private func makeSession(delegate: PinDelegate, timeout: TimeInterval) -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = timeout
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.httpShouldSetCookies = false
        let delegateQueue = OperationQueue()
        delegateQueue.underlyingQueue = queue
        delegateQueue.maxConcurrentOperationCount = 1
        return URLSession(configuration: config, delegate: delegate, delegateQueue: delegateQueue)
    }

    static func timeout(_ call: CAPPluginCall, _ defaultMs: Int) -> TimeInterval {
        let ms = min(max(call.getInt("timeoutMs") ?? defaultMs, 1_000), 120_000)
        return TimeInterval(ms) / 1000
    }

    static func pins(_ call: CAPPluginCall) -> Set<String>? {
        let list = call.getArray("pins", String.self) ?? []
        let pins = Set(list)
        guard !pins.isEmpty, pins.allSatisfy(Pins.isFingerprint) else { return nil }
        return pins
    }

    static func reject(_ call: CAPPluginCall, error: Error?, delegate: PinDelegate) {
        let code = Failure.classify(error, delegate: delegate)
        var data: [String: Any] = [:]
        if code == Failure.pinMismatch, let der = delegate.presentedDer {
            data["der"] = der.base64EncodedString()
        }
        call.reject(error?.localizedDescription ?? code, code, error, data)
    }
}

// MARK: - pin logic

enum Pins {
    static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    static func isFingerprint(_ value: String) -> Bool {
        value.count == 64 && value.allSatisfy { $0.isASCII && $0.isHexDigit && !$0.isUppercase }
    }

    static func leafDer(_ trust: SecTrust) -> Data? {
        guard let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
              let leaf = chain.first else { return nil }
        return SecCertificateCopyData(leaf) as Data
    }
}

/// The one host and port a set of pins is for (https and wss only).
struct Endpoint {
    let host: String
    let port: Int

    init?(url: URL) {
        guard let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "wss",
              let rawHost = url.host, !rawHost.isEmpty else { return nil }
        host = Endpoint.normalize(rawHost)
        port = url.port ?? 443
    }

    /// Host as written in a URL (IPv6 in brackets).
    var urlHost: String { host.contains(":") ? "[\(host)]" : host }

    func matches(host other: String, port otherPort: Int) -> Bool {
        Endpoint.normalize(other) == host && (otherPort == port || (otherPort == 0 && port == 443))
    }

    static func normalize(_ host: String) -> String {
        host.trimmingCharacters(in: CharacterSet(charactersIn: "[]")).lowercased()
    }
}

enum Failure {
    static let pinMismatch = "PIN_MISMATCH"
    static let tls = "TLS"
    static let timeout = "TIMEOUT"
    static let unreachable = "UNREACHABLE"
    static let badRequest = "BAD_REQUEST"

    static func classify(_ error: Error?, delegate: PinDelegate) -> String {
        if delegate.mismatch { return pinMismatch }
        guard let urlError = error as? URLError else { return unreachable }
        switch urlError.code {
        case .timedOut:
            return timeout
        case .secureConnectionFailed, .serverCertificateHasBadDate, .serverCertificateUntrusted,
             .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid,
             .clientCertificateRejected, .clientCertificateRequired:
            return tls
        default:
            return unreachable
        }
    }
}

/// Session delegate: the pin check, no redirects, and the WebSocket lifecycle.
final class PinDelegate: NSObject, URLSessionDelegate, URLSessionTaskDelegate, URLSessionWebSocketDelegate {
    let endpoint: Endpoint
    let pins: Set<String>
    let inspectOnly: Bool
    /// The leaf certificate the server presented (last handshake).
    private(set) var presentedDer: Data?
    /// The server presented a certificate that is not pinned.
    private(set) var mismatch = false
    weak var socket: PinnedSocket?

    init(endpoint: Endpoint, pins: Set<String>, inspectOnly: Bool) {
        self.endpoint = endpoint
        self.pins = pins
        self.inspectOnly = inspectOnly
    }

    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        let space = challenge.protectionSpace
        guard space.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = space.serverTrust else {
            // No client certificates or HTTP auth on this path.
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        // The pin only ever applies to its own host and port.
        guard endpoint.matches(host: space.host, port: space.port), let der = Pins.leafDer(trust) else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        presentedDer = der
        if !inspectOnly && pins.contains(Pins.sha256Hex(der)) {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            if !inspectOnly { mismatch = true }
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        socket?.opened(protocol: `protocol`)
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        let text = reason.map { String(decoding: $0, as: UTF8.self) } ?? ""
        socket?.finish(code: closeCode.rawValue, reason: text, error: nil)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let socket = socket else { return }
        if let error = error {
            socket.finish(code: 1006, reason: "", error: Failure.classify(error, delegate: self))
        } else if let ws = task as? URLSessionWebSocketTask, ws.closeCode != .invalid {
            // Normally `didCloseWith` came first and this is ignored; just in case it did not.
            let reason = ws.closeReason.map { String(decoding: $0, as: UTF8.self) } ?? ""
            socket.finish(code: ws.closeCode.rawValue, reason: reason, error: nil)
        } else {
            socket.finish(code: 1006, reason: "", error: Failure.unreachable)
        }
    }
}

/// One pinned WebSocket. Everything runs on the plugin's serial queue.
/// Received frames go to JS in batches; the next batch waits for `ack`. While too much is
/// waiting, `receive()` is not called again (backpressure). The close event is always last.
final class PinnedSocket {
    let id: String
    private weak var plugin: PinnedTlsPlugin?
    private let session: URLSession
    private let task: URLSessionWebSocketTask
    private let delegate: PinDelegate
    private var pending: [String] = []
    private var pendingChars = 0
    private var inFlight = false
    private var readPaused = false
    private var finished = false
    private var discarded = false
    private var closeDelivered = false
    private var closeEvent: [String: Any]?
    private let highWaterChars = 4 * 1024 * 1024

    init(id: String, plugin: PinnedTlsPlugin, session: URLSession, task: URLSessionWebSocketTask, delegate: PinDelegate) {
        self.id = id
        self.plugin = plugin
        self.session = session
        self.task = task
        self.delegate = delegate
    }

    func receiveNext() {
        task.receive { [weak self] result in
            guard let self = self, let queue = self.plugin?.queue else { return }
            queue.async {
                switch result {
                case .success(.string(let text)):
                    self.enqueue(text)
                case .success(.data(let data)):
                    self.enqueue(String(decoding: data, as: UTF8.self))
                case .success:
                    self.continueReading()
                case .failure:
                    // The delegate reports how the connection ended.
                    break
                }
            }
        }
    }

    private func continueReading() {
        if finished || discarded { return }
        if pendingChars > highWaterChars { readPaused = true } else { receiveNext() }
    }

    private func enqueue(_ text: String) {
        if finished || discarded { return }
        pending.append(text)
        pendingChars += text.utf16.count
        if !inFlight { deliver() }
        continueReading()
    }

    private func deliver() {
        guard !pending.isEmpty else { return }
        let batch = pending
        pending = []
        pendingChars = 0
        inFlight = true
        plugin?.emit(["id": id, "type": "messages", "messages": batch])
        if readPaused && !finished && !discarded {
            readPaused = false
            receiveNext()
        }
    }

    func opened(protocol proto: String?) {
        var event: [String: Any] = ["id": id, "type": "open"]
        if let proto = proto, !proto.isEmpty { event["protocol"] = proto }
        plugin?.emit(event)
    }

    func ack() {
        inFlight = false
        if !pending.isEmpty { deliver() } else { deliverCloseIfReady() }
    }

    func send(_ messages: [String], completion: @escaping (Bool) -> Void) {
        guard let queue = plugin?.queue, !finished else {
            completion(false)
            return
        }
        if messages.isEmpty {
            completion(true)
            return
        }
        var remaining = messages.count
        var ok = true
        // Resolves after the last frame was handed to the network, so JS (one send call in
        // flight) waits instead of piling frames up: outbound backpressure.
        for message in messages {
            task.send(.string(message)) { error in
                queue.async {
                    if error != nil { ok = false }
                    remaining -= 1
                    if remaining == 0 { completion(ok) }
                }
            }
        }
    }

    func close(code: Int, reason: String) {
        discarded = true
        pending = []
        pendingChars = 0
        inFlight = false
        let closeCode = URLSessionWebSocketTask.CloseCode(rawValue: code) ?? .normalClosure
        task.cancel(with: closeCode, reason: reason.isEmpty ? nil : Data(reason.utf8))
        deliverCloseIfReady()
    }

    func finish(code: Int, reason: String, error: String?) {
        if finished { return }
        finished = true
        // A failure is never reported as a clean 1000 close.
        let safeCode = (error != nil && code == 1000) ? 1006 : code
        var event: [String: Any] = ["id": id, "type": "close", "code": safeCode, "reason": reason]
        if let error = error {
            event["error"] = error
            if error == Failure.pinMismatch, let der = delegate.presentedDer {
                event["der"] = der.base64EncodedString()
            }
        }
        closeEvent = event
        if !inFlight && !pending.isEmpty { deliver() } else { deliverCloseIfReady() }
    }

    private func deliverCloseIfReady() {
        guard finished, !closeDelivered, !inFlight, pending.isEmpty, let event = closeEvent else { return }
        closeDelivered = true
        plugin?.emit(event)
        plugin?.forget(id)
        session.invalidateAndCancel()
    }
}
