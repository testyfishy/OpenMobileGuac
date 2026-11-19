# Self-signed and private-CA servers (SRV-8)

## What works today

| Path | Trust used | Custom CA on the device | Self-signed, not installed |
|---|---|---|---|
| REST API (`api/tokens`, tree) — native HTTP (`CapacitorHttp`) | OS trust store | Android: only if the app trusts user CAs (see below). iOS: yes, once the profile is installed **and** enabled in Settings › General › About › Certificate Trust Settings | Fails (reported as a certificate error) |
| Session tunnel — WebSocket from the WebView | WebView/OS trust store | Same as above | Fails; the WebView gives the page no way to accept it |

The app **never** offers "ignore TLS errors", globally or per server.

When a certificate is not trusted the app says so specifically (error code `tls`) and lists the
options:

1. **Install your CA** on the device as a trusted root (best for a home or company CA).
2. **Use a publicly trusted certificate.** Tailscale users can enable HTTPS certificates for
   `*.ts.net` names (`tailscale cert`) and reach Guacamole at `https://<machine>.<tailnet>.ts.net`.
   A reverse proxy with Let's Encrypt (DNS challenge works for private hosts) also works.
3. **Use plain `http://` on a private network** you trust (Tailscale/WireGuard already encrypt
   the traffic). The app warns before sending a password over http.

The connection test (Edit server › Test connection) shows when the API answers but the
WebSocket does not, which on HTTPS usually means the WebView does not trust the certificate.

### Android and user-installed CAs

Since Android 7, apps ignore user-installed CAs unless their network security config opts in.
`app/android/app/src/main/res/xml/network_security_config.xml` is owned by the release work; to
support home CAs it needs `<certificates src="user" />` inside `<trust-anchors>` of the base
config. That trusts every user-installed CA for this app only, which is the documented,
OS-level way to do it (unlike disabling validation). Not changed here; listed as a follow-up.

## Follow-up: a native tunnel bridge for per-server pinning

SPEC SRV-8 asks for "trust this server's certificate after showing its fingerprint". That is
only possible if the app, not the WebView, owns the TLS connections:

- **Native WebSocket plugin** (Android: OkHttp `WebSocket`; iOS: `URLSessionWebSocketTask`)
  exposing `open(url, protocols, pin)`, `send(text)`, `close()` and events
  `open/message/error/close` to JavaScript.
- **Pinning**: on first failure, fetch the leaf certificate natively, show its SHA-256
  fingerprint, subject and validity, and on user approval store `{host, port, spkiSha256}` per
  profile (in `SecureStore` or Preferences). A changed certificate prompts again. Validation
  then accepts exactly that pin for that host (OkHttp `CertificatePinner` + custom
  `X509TrustManager`; iOS `URLSessionDelegate` `didReceive challenge`).
- **Tunnel adapter**: a `TunnelLike` implementation in `core/transport/` that speaks the
  Guacamole WebSocket protocol over the plugin (it is only text frames), selected by
  `SessionTransport` when a pin exists. The same pin feeds the native HTTP client for REST.
- **Throughput**: messages cross the Capacitor bridge as strings; measure frame rates on a
  mid-range phone before shipping, batching small messages if needed.
- Store review: pinning user-approved certificates is acceptable; blanket trust is not.
