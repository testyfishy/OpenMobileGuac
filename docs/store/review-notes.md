# App Review notes (drafts)

## Notes for the reviewer (App Store Connect › App Review Information › Notes)

```
OpenMobileGuac is a client for Apache Guacamole, a remote desktop gateway that users host themselves. The app has no accounts and no server of its own, so there is no demo login to give you. Instead, the app contains a built-in Demo: a simulated remote desktop that runs entirely on the device, with no network access.

To try it on a fresh install:
1. The introduction appears on first launch. Tap "Next", then "Next" again.
2. On the last card, tap "Try the Demo".
3. In the list, tap "Demo desktop".

If you skipped the introduction: on the Servers screen, tap the row "Demo" ("Built-in sample desktop. Works offline."), then tap "Demo desktop".

In the Demo you can try the touch pointer modes, pinch zoom, the soft keyboard and extra-key bar, the clipboard, and the toolbar. The two "fixed" desktops (1024 x 768 and 1920 x 1080) are for trying zoom and pan.

Network: App Transport Security allows arbitrary loads because users connect to servers on their own home or private networks, often by IP address or private DNS names over plain http, and the addresses are only known at run time. The app connects only to servers the user adds. HTTPS is used whenever the user's server supports it, and the app warns before sending a password over http.

Microphone: used only when the user turns on "Send microphone" during an RDP session whose server accepts audio input. It is off by default.

Background audio mode: the app declares the "audio" background mode only for an optional, experimental setting, Settings > Sessions > In the background > "Picture in picture (experimental)", which is off by default. With it on, the remote screen is shown in the system Picture in Picture window, which iOS offers only to apps with this mode. The window is view only; while it is open the remote session stays connected, and the window closes when the session ends or the app lock engages. To see it: turn the setting on, open the Demo desktop, then leave the app or tap More > "Open picture in picture". With the setting off, the app does not use the background audio mode. The microphone is never used in the background.

The app is open source: github.com/testyfishy/OpenMobileGuac
```

Status of these steps: checked in the source code (`App.tsx` first-run introduction,
`ui/onboarding/Onboarding.tsx`, `ui/servers/ServersScreen.tsx`, `demo/profile.ts`), not yet
walked through on a device. Walk through them on the build you submit and adjust the button
names if they differ. The Demo row is shown automatically only while no server is saved
(Settings › About › "Demo server in the list" can force it on), so a fresh install shows it.

The "Background audio mode" paragraph applies only if the build is submitted with the
`audio` background mode (owner decision in [README.md](README.md)); drop it otherwise. Not
yet checked on a device: that the Picture in Picture window opens for the Demo desktop
(the code needs a connected Guacamole client and does not exclude the Demo, which runs one
over an in-app tunnel). Walk through it on the
submitted build.

Sign-in information: leave "Sign-in required" off, since the Demo needs no account. If
Apple asks for a real server anyway, the owner would have to provide a throwaway test server
and account. Never put real server addresses or passwords in this repository.

## Google Play

- **App access:** "All functionality is available without special access" does not fit,
  because real use needs the user's own server. Choose the option for restricted access and
  give the same Demo instructions as above. Play asks for credentials when parts of the app
  need them; the Demo needs none.
- **Foreground service declaration:** the text and the video plan are in
  [docs/release.md, "Foreground service"](../release.md#foreground-service-android-background-keep-alive).
  Play may refuse the `specialUse` type for this purpose; the fallback is in that section.
- **Microphone** (`RECORD_AUDIO`): explain it as above.

## Age rating

The app itself contains no objectionable content. It shows whatever is on the remote
computer the user connects to, which can include a web browser, and the single sign-on step
opens web pages in an in-app browser. The App Store questionnaire asks about unrestricted
web access, and the answer to that question affects the rating. This is the owner's decision;
look at how other remote desktop apps in the store are rated before answering.
