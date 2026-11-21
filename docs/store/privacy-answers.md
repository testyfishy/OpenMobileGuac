# Privacy questionnaire answers (drafts)

These are facts about the code to help the owner answer the store questionnaires. The answers
are the owner's declaration, not legal advice. Read each store's own definitions before
submitting.

## What the code does

Checked in the source on 2026-11-21:

- No analytics, advertising, crash-reporting or tracking SDK is in `app/package.json` or in
  the native projects. The Android build has the Capacitor template's optional
  `google-services` hook, but there is no `google-services.json`, so it is not applied.
- The production web bundle contains no third-party host that is contacted. The only URL
  literals are XML namespace strings, React's error-text link, the `https://demo.invalid`
  Demo placeholder and the project's GitHub link in Settings › About (opened on tap). See
  docs/AUDIT.md §3, "URL literals in the production bundle".
- Network traffic goes to the Guacamole server addresses the user enters or the share links
  the user opens. Single sign-on and Duo open the identity provider that the user's server
  points to.
- The developer runs no server and receives nothing.
- Features added since 1.0.1 send nothing new off the device: per-connection settings are
  stored locally, and the experimental iOS Picture in Picture window draws frames from memory
  (nothing is saved or sent).
- Data stored on the device is listed in [PRIVACY.md](../../PRIVACY.md).

## App Store: App Privacy

Apple counts data as "collected" when it is sent off the device in a way that the developer
or its partners can access. Data sent to a server that the user runs or chooses is not
accessible to the developer.

Suggested answer: **Data Not Collected**.

Owner to confirm: that this reading of Apple's definition fits, in particular for the
optional single sign-on step, where a third-party identity provider chosen by the user's
server sees the sign-in.

Tracking: **No**. The app does not track users across apps or websites and has no
advertising identifier code.

## Google Play: Data safety

Facts for the form:

| Question | Fact |
|---|---|
| Does the app collect or share user data? | The developer receives no data. Data goes only to the user's own server (and the identity provider that server uses) |
| Third-party SDKs that collect data | None |
| Is data encrypted in transit? | Only when the user's server uses HTTPS. Plain `http://` servers are allowed, with a warning before a password is sent |
| Can users request deletion? | There is nothing held by the developer. On the device: delete a server, "Sign out of all servers", or uninstall |

Play's definition of "collected" (data transmitted off the device) differs from Apple's.
Read Play's guidance on data sent to a server the user chooses before answering "No data
collected". That is the owner's decision.

## Privacy manifest (iOS)

There is no `PrivacyInfo.xcprivacy` in `app/ios/App/App`. Apple asks apps to declare the use
of certain "required reason" APIs (for example `UserDefaults`, which Capacitor's Preferences
plugin uses on iOS) in a privacy manifest. Whether the Capacitor packages bring their own
manifests, and whether App Store Connect warns about a missing one for this app, has not been
checked. Look at the upload email or the App Store Connect warnings after the next TestFlight
build.
