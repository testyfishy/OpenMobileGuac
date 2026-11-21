# Self-signed and private-CA servers (SRV-8)

## Summary

| Server certificate | REST API | Session tunnel | What the user does |
|---|---|---|---|
| Publicly trusted, or a CA installed on the device | System path: `CapacitorHttp` (OS trust store) | WebView `WebSocket` | Nothing. Unchanged by SRV-8. |
| Self-signed or private CA, not installed, **pinned** by the user | Native `PinnedTls` plugin | Native `PinnedTls` WebSocket (`NativeBridgeTunnel`) | Once: compare the fingerprint and tap "Trust this certificate for this server". |
| Self-signed, not pinned | Fails with a certificate error | Fails | Shown the certificate and offered to pin it (native builds only). |
| Web / dev build | Browser `fetch` | Browser `WebSocket` | Pinning is hidden; the browser decides. |

The app **never** offers "ignore TLS errors", globally or per server, never trusts a host by
name alone, and never applies a pin to another scheme, host or port.

## Design

### What is pinned

The pin is the **SHA-256 of the leaf certificate's DER encoding**, the same value that
`openssl x509 -noout -fingerprint -sha256 -in cert.pem` prints and browsers show as the
"SHA-256 fingerprint", so the user can compare it on the server.

Why the certificate and not its public key (SPKI):

- Identical one-liners on both platforms (`SecCertificateCopyData` / `X509Certificate.encoded`
  → SHA-256). Hashing the SPKI on iOS needs per-key-type ASN.1 headers around
  `SecKeyCopyExternalRepresentation`, which could not be tested without a Mac.
- It is the value users can find and compare.
- Cost: a renewed certificate is a *changed* certificate even when the key is kept, so the
  app asks again after every renewal (old vs new is shown). For self-signed home servers,
  which are renewed rarely and usually with a new key, that is acceptable.

When a pin matches, chain, expiry and host-name checks are replaced by that exact match (the
user trusted this exact certificate for this exact host and port). An expired pinned leaf is
therefore still accepted; the app shows "This certificate has expired" in the details.

### Where it is stored

`ServerProfile.tlsPin` (`core/tls/TlsPin.ts`):
`{ origin, sha256, subject, issuer, notBefore, notAfter, pinnedAt }`, where `origin` is
`https://<host>:<port>` with the port always written (`pinOrigin`; a `wss:` tunnel URL maps to
the same origin). It is not a secret, so it lives in the profile (Preferences), not in the
Keychain/Keystore.

Binding rules, all enforced in core and unit-tested (`tlsPinStorage.test.ts`):

- Every read goes through `pinForBaseUrl`: a pin whose `origin` is not the profile's own
  scheme/host/port is dropped. A misplaced pin is inert, whatever wrote it.
- `ProfileStore.update`: a path change on the same origin keeps the pin; any host, port or
  scheme change drops it (moving back does not restore it). A patch cannot set a pin.
- Pins are per address: `setTlsPinForOrigin` updates every saved profile at that origin, so
  two profiles for one server never disagree. "Forget" removes it from all of them.
- A certificate trusted while *adding* a server (no profile yet) is held in memory as
  "pending" for that origin (15 minutes), used by the probe, and saved with the profile.

### Backups (AUDIT §6 item 1 applied to pins)

- The pin travels in the plain part of a backup (it is not secret).
- Parsing drops a pin that does not match the server's own `baseUrl` (an edited address
  cannot carry trust to another host).
- A **merge** never adds or replaces the pin of a saved server; the device's own pin (if
  still bound) is kept. Only a server *added* by the restore takes the backup's pin.
- When saved passwords/TOTP seeds are exported, the pin's fingerprint is also sealed inside
  the encrypted part (next to `baseUrl`). On restore, a server's secrets are restored only if
  the sealed fingerprint equals the plain pin; an edited plain pin (for example an
  attacker's certificate) means the secrets are skipped, so a saved password can never be
  sent to a certificate the user did not trust for it.

### Native transport (`app/plugins/omg-pinned-tls`)

A local Capacitor plugin, `PinnedTls`, installed as a `file:` dependency
(`"omg-pinned-tls": "file:plugins/omg-pinned-tls"`) so `npx cap sync` registers it like any
other plugin: it writes `.package(name: "OmgPinnedTls", …)` into
`ios/App/CapApp-SPM/Package.swift`, the `:omg-pinned-tls` project into
`android/capacitor.settings.gradle` / `app/capacitor.build.gradle`, and the class into the
generated `capacitor.plugins.json` / `packageClassList`. The iOS project uses SPM, so the
package has a root `Package.swift` whose package and library name equal the CLI's
`fixName("omg-pinned-tls")`.

Methods (`core/tls/plugin.ts`):

| Method | What it does |
|---|---|
| `inspect({ url })` | TCP connect + TLS handshake with SNI, records the leaf certificate, then aborts the handshake. **No HTTP request or application data is sent.** Returns base64 DER. |
| `request({ url, method, headers, data, timeoutMs, pins })` | One HTTPS request, accepted only if the leaf's SHA-256 is in `pins`. Redirects are not followed. |
| `openSocket({ id, url, protocols, pins })` | A `wss:` WebSocket with subprotocol `guacamole`, same pin rule. |
| `send({ id, messages })` | One text frame per message, in order. Resolves when the frames are queued/sent (outbound backpressure). |
| `ack({ id })` | JS processed the last `messages` event. |
| `closeSocket({ id, code, reason })` | Closes. |
| event `socket` | `open`, `messages` (a batch of frames), `close` (always last; `error` set for failures such as `PIN_MISMATCH`, never a clean 1000). |

Failure codes: `PIN_MISMATCH` (with the presented certificate), `TLS`, `TIMEOUT`,
`UNREACHABLE`, `BAD_REQUEST`. JS never pattern-matches error text for these.

- **iOS** (`PinnedTlsPlugin.swift`): one `URLSession` per request/socket with a delegate
  that handles the server-trust challenge: only for the expected host and port, it hashes
  the leaf (`SecTrustCopyCertificateChain`, CryptoKit SHA-256) and answers `.useCredential`
  on a match, otherwise cancels. WebSocket: `URLSessionWebSocketTask`, max message 16 MiB.
  The app's `NSAllowsArbitraryLoads` (docs/release.md) is what lets a credential for a
  non-chain-valid trust be used.
- **Android** (`PinnedTlsCore.kt`, `PinnedTlsPlugin.kt`): OkHttp 4.12 with an
  `X509TrustManager` that accepts only a pinned leaf (throws otherwise, so it is not a
  "trust-all" manager), a `HostnameVerifier` that re-checks the pin on the session instead of
  returning `true`, no redirects, and an interceptor that refuses any other host. One client
  per endpoint + pin set; nothing is shared with unpinned traffic. Inspection uses a trust
  manager that records the leaf and always throws.
  **New dependency:** `com.squareup.okhttp3:okhttp:4.12.0` (Apache-2.0). Capacitor does not
  ship it and Android has no platform WebSocket client; writing RFC 6455 framing by hand
  untested on a device was judged riskier.
- **Backpressure, inbound:** native sends one `messages` batch at a time and waits for
  `ack`. While more than 4 Mi characters wait, it stops reading: iOS does not call
  `receive()` again, Android blocks OkHttp's reader thread, so TCP flow control slows the
  server.

### JS side

- `core/tls/TlsTrustService.ts`: the in-memory origin → pin cache (refreshed from the
  profiles on every REST lookup), `inspect`/`check` (first use / changed / already
  trusted), `trust`, `forget`, pending pins. Without the plugin everything is a no-op.
- `core/tls/PinnedHttpClient.ts`: `PinRoutingHttpClient` wraps the system `HttpClient`.
  A request goes to the native path only when its origin has a pin; otherwise the system
  client is called unchanged. A pin mismatch becomes `CertificateMismatchError` (an
  `HttpTransportError` of kind `tls`), so the API layer reports it as a certificate error.
- `core/transport/NativeBridgeTunnel.ts`: a `Guacamole.Tunnel` (structurally `TunnelLike`)
  that mirrors the vendored `WebSocketTunnel` 1.6.0 (states, 15 s receive timeout,
  1.5 s unstable threshold, 500 ms internal ping sent through `sendMessage`, UUID from the
  first instruction, close mapping of docs/protocol-notes.md §3.6). It reuses the vendored
  `Guacamole.Parser`, `toInstruction` and `Status` (injected; the library is not modified).
  `createPinAwareTransport` picks it only for a pinned origin (`SessionHost`).
- UI: `ui/tls/CertificatePanel.tsx` under a `tls` error (Add/Edit server, sign-in,
  connection list); `ui/tls/CertificateRow.tsx` ("Certificate" section in Edit server, with
  Forget); strings in `ui/tls/tlsStrings.ts` (English and Spanish, completeness test).

### Flows

1. **First use.** Probe/sign-in fails with `tls` → the panel calls `inspect` and shows
   fingerprint, subject, issuer, validity and names, plus the `openssl` command to compare.
   "Trust this certificate for this server" stores the pin for that origin only; "Try again"
   repeats the action, which now uses the native path.
2. **Changed certificate.** The native path rejects with `PIN_MISMATCH`; the panel shows the
   trusted and the presented certificate side by side, says nothing was sent, and requires
   "Trust the new certificate…" plus a confirmation dialog.
3. **Forget.** Edit server › Certificate › Forget: the device trust store is used again.

## Other options (unchanged)

1. **Install your CA** on the device as a trusted root (best for a home or company CA).
   Android: the app opts in to user-installed CAs (`network_security_config.xml`,
   `<certificates src="user" />`). iOS: install the profile **and** enable it in Settings ›
   General › About › Certificate Trust Settings.
2. **Use a publicly trusted certificate** (Tailscale `tailscale cert` for `*.ts.net`, or a
   reverse proxy with Let's Encrypt).
3. **Plain `http://` on a private network** you trust; the app warns before sending a
   password over http.

**No silent fallback to http (AUDIT #11, 2026-11-21).** Without a typed scheme only `https://`
is tried; on failure the error offers "Use http instead — not encrypted". The connection test
(Edit server › Test connection) still opens its WebSocket probe from the WebView, so for a
pinned server it reports the WebSocket step as failing even though sessions work (known
limitation).

## Verification status

- **Unit-tested (Vitest):** DER parsing against Node's own X.509 parser on throwaway
  certificates generated in memory (`core/testing/testCertificate.ts`; no key material is
  stored), fingerprints and origins, the trust service, HTTP routing, the tunnel state
  machine against a fake native bridge (framing, batching, ack, ping, timeouts, every close
  mapping), profile and backup rules, strings.
- **Compiled:** nothing native was compiled locally (no Android SDK, no Mac). The Android
  and iOS workflows compile the plugin on every push (`npx cap sync` + `assembleDebug` /
  unsigned Simulator build).
- **Not run anywhere yet:** the native code itself. See the device checklist below.

### Device checklist (owner)

Use a server with a self-signed certificate (for example nginx in front of Guacamole with
`openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 30 -subj
"/CN=<your host>" -keyout key.pem -out cert.pem`).

1. Add the server by `https://` address: the panel appears with the fingerprint; it equals
   `openssl x509 -noout -fingerprint -sha256 -in cert.pem`.
2. Trust it, Try again: the server is saved; sign in works; Edit server shows the
   Certificate row.
3. Open RDP/VNC/SSH sessions: they connect, display, take input, survive 10+ minutes;
   clipboard and file transfer work; Disconnect, admin Kill (clean close, no reconnect) and
   pulling the network (reconnects) behave as on a system-trusted server.
4. Measure frame rate on a mid-range phone (scrolling a browser over RDP) vs the same server
   behind a trusted certificate.
5. Replace the certificate: sign-in shows "certificate has changed" with old and new; nothing
   connects until re-trusted.
6. Forget: connecting fails with the certificate error again.
7. A normal Let's Encrypt server on the same phone still works and never uses the plugin.
8. Backup with passwords, restore on another install: the pin and password come back; edit
   the backup's pin by hand: the password is not restored.
9. Android only: confirm `PIN_MISMATCH` carries the new certificate (Conscrypt keeps the
   cause); if not, the panel still inspects the server and shows old vs new.
