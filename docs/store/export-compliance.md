# Encryption and export compliance (facts for the owner)

This page lists every use of cryptography in the app, so the owner can answer the App Store
Connect encryption questions and any export rules that apply to them. It is not legal
advice, and the answers are the owner's declaration. Checked in the source on 2026-11-21.

## Current setting

`app/ios/App/App/Info.plist` sets `ITSAppUsesNonExemptEncryption` to `false`. With that key,
App Store Connect does not ask the encryption questions for each build. If the owner's
answer differs from what this key says, change the key.

## Every use of cryptography

None of these is an algorithm written for this project. Each one calls an operating-system
or WebView API, or a standard library that ships with the platform.

| Use | Algorithm | Provided by | Where |
|---|---|---|---|
| Connections to the user's server over `https://` and `wss://` | TLS, negotiated by the OS | iOS URLSession / WebKit; Android HttpURLConnection, WebView, and OkHttp 4.12 on the platform's TLS stack for pinned servers | `core/http`, `core/transport`, `plugins/omg-pinned-tls` |
| Certificate fingerprint for self-signed servers | SHA-256 of the certificate | iOS CryptoKit; Android `java.security.MessageDigest`; WebCrypto `subtle.digest` in JS | `plugins/omg-pinned-tls`, `core/tls/fingerprint.ts` |
| Optional encryption of passwords and TOTP secrets inside a backup file | PBKDF2-SHA256 (310,000 iterations) to derive a 256-bit key, then AES-256-GCM | WebCrypto (`crypto.subtle`) in the system WebView | `core/backup/backup.ts` |
| TOTP two-factor codes | HMAC-SHA1, HMAC-SHA256 or HMAC-SHA512, as the server specifies | WebCrypto HMAC | `core/totp/totp.ts` |
| Storing secrets on the device | iOS Keychain; on Android AES-GCM with a key held in the Android Keystore | `@aparajita/capacitor-secure-storage`, using the platform APIs | `core/storage/NativeSecureStore.ts` |
| Random values (SSO state, IDs) | Platform random number generator | WebCrypto `getRandomValues` / `randomUUID` | `core/sso/sso.ts`, `core/storage/ProfileStore.ts` |

What the app does not contain: no VPN, no own TLS or crypto library, no end-to-end
encryption protocol, no encrypted messaging, no proprietary or non-standard algorithm.

## Questions the owner has to answer

App Store Connect asks, in short: does the app use encryption, and if so, is it only
encryption that is exempt (for example standard encryption provided by the operating system,
or encryption used only for authentication or to protect the user's own data)?

Points to weigh:

- HTTPS/TLS here is the operating system's standard implementation.
- The backup encryption protects the user's own file with the user's passphrase. It uses
  standard algorithms through the platform's WebCrypto API, not an own implementation.
- The current `false` value in `Info.plist` was set on the basis that only standard OS
  encryption is used. The original note on that key did not mention the backup encryption;
  the owner should decide whether it changes the answer.

Some countries have their own rules for distributing apps that use encryption; App Store
Connect shows them when relevant. Check them for the countries you choose.
