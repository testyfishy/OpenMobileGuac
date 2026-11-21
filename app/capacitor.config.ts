import type { CapacitorConfig } from '@capacitor/cli';

// Network settings: users connect to self-hosted Guacamole servers on private networks
// (Tailscale 100.x addresses, MagicDNS names, LAN) that are often plain `http://` / `ws://`.
// See docs/release.md ("Network configuration") for why each key is set.

// Debugging is off in every build, including debug APKs and Debug iOS builds: Capacitor's
// default "debug" logging writes each plugin call's arguments (passwords, auth tokens) to
// logcat / the Xcode console, and WebView debugging lets anything attached over USB read the
// page. For local development only, run `npx cap sync` with OMG_DEBUG_WEBVIEW=1 to turn
// both back on (see docs/BUILDING.md). Never set it for a build you hand to anyone.
const debugWebView = process.env.OMG_DEBUG_WEBVIEW === '1';

const config: CapacitorConfig = {
  // Placeholder id; may change before store submission. Also set in
  // android/app/build.gradle and ios/App/App.xcodeproj (see docs/release.md).
  appId: 'io.github.testyfishy.omg',
  appName: 'OpenMobileGuac',
  webDir: 'dist',
  loggingBehavior: debugWebView ? 'debug' : 'none',
  server: {
    // Keep the WebView origin at https://localhost (the Capacitor default) so it stays a
    // secure context; clipboard and other APIs require one.
    androidScheme: 'https',
    // Adds android:usesCleartextTraffic="true" via the generated plugin manifest. The
    // committed AndroidManifest.xml and network_security_config.xml also permit cleartext,
    // so this is belt-and-braces rather than the only switch.
    cleartext: true,
  },
  android: {
    // The page origin is https://localhost but sessions open ws:// sockets to the server.
    // Without this the Android WebView blocks them as mixed content.
    allowMixedContent: true,
    // Capacitor's default is "on when the APK is debuggable", which includes nightly builds.
    webContentsDebuggingEnabled: debugWebView,
  },
  ios: {
    // Capacitor's default is "on in Debug builds" (WKWebView.isInspectable).
    webContentsDebuggingEnabled: debugWebView,
  },
};

export default config;
