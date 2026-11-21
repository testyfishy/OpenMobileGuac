# Store submission drafts

Text and facts for the App Store Connect and Google Play Console forms. Everything here is
a draft: the owner reviews it, changes what is needed and submits it. Nothing in this folder
is legal advice.

The app is licensed under GPL-3.0-or-later with an additional permission for app stores
(`LICENSE-APP-STORE-EXCEPTION`). Earlier commits were published under Apache-2.0 and remain
available under it; the vendored `guacamole-common-js` stays Apache-2.0. Every store build
must have its complete source published here, which the public workflow and `main` provide.

| File | Contents |
|---|---|
| [listing.md](listing.md) | App name notes, subtitle options, short and long description, keywords, What's New, URLs |
| [review-notes.md](review-notes.md) | How a reviewer can test with the built-in Demo, permission explanations, age rating notes |
| [privacy-answers.md](privacy-answers.md) | Facts for the App Privacy and Data safety questionnaires, privacy manifest note |
| [export-compliance.md](export-compliance.md) | Every use of cryptography in the app, for the encryption questions |

Related: [PRIVACY.md](../../PRIVACY.md) (the privacy policy to link), [release.md](../release.md)
(signing, App Transport Security justification, Android foreground service declaration),
[BUILDING.md](../BUILDING.md).

## How the store builds relate to this repository

- The iOS build is made by `.github/workflows/ios.yml` on GitHub's runners from a commit on
  `main` (the workflow uploads to TestFlight only from `main`, also for manual runs), signed with the maintainer's Apple account and uploaded to TestFlight. The build
  number is the workflow run number, so each App Store build can be traced to a public run
  and commit. There is no tag-triggered release workflow yet; for a release, tag the commit
  the submitted build came from.
- No iOS binary is published on GitHub. Most iPhone users cannot install an app from outside
  the App Store, and anyone can build their own from this source (see BUILDING.md).
- Android: the debug APK on the `nightly` prerelease today; a signed release APK on GitHub
  Releases and Google Play later.

## Owner checklist (only the owner can do these)

Accounts and names

- [ ] Check that the app name is available in the App Store and in Google Play, and decide
      on it. SPEC §2 suggests the pattern "X for Apache Guacamole" with an "unofficial" line.
- [ ] Decide the subtitle (three options in listing.md).
- [ ] Fill in the App Review contact details in App Store Connect. They are private to Apple;
      do not put them in this repository.

Listing

- [ ] Screenshots for each required device size, taken from the Demo or a throwaway remote
      desktop with nothing personal on screen. Review each one before upload.
- [ ] Privacy policy URL: <https://github.com/testyfishy/OpenMobileGuac/blob/main/PRIVACY.md>
- [ ] Support URL: <https://github.com/testyfishy/OpenMobileGuac/issues>
- [ ] Remove description lines for features not yet seen working on a device.
- [ ] Category, price (free) and countries.

Questionnaires

- [ ] App Privacy (App Store) and Data safety (Play): see privacy-answers.md.
- [ ] Encryption: see export-compliance.md, and keep `ITSAppUsesNonExemptEncryption` in
      `Info.plist` in line with the answer.
- [ ] Age rating: see review-notes.md.
- [ ] App Transport Security justification, if App Review asks: draft text in release.md,
      "iOS: App Transport Security".
- [ ] Play: foreground service declaration and video (release.md, "Foreground service").

Before the first release

- [ ] Walk through the Demo steps in review-notes.md on the build being submitted.
- [ ] Version numbers agree for the submitted version (1.1.0): `app/package.json`,
      `app/package-lock.json` (both places), Android `versionName`, iOS `MARKETING_VERSION`
      (both configurations) and the CHANGELOG heading.
- [ ] In the CHANGELOG, rename `[Unreleased]` to `[1.1.0] - <date>`, add a new empty
      `[Unreleased]` above it and a `[1.1.0]` link at the bottom; tag the commit the
      submitted build came from (`v1.1.0`).
- [ ] **Decision: submit with or without the `audio` background mode.** Every iOS build
      declares `UIBackgroundModes: audio`, used only by the experimental, off-by-default
      Picture in Picture setting. App Review may question it under guideline 2.5.4
      (background modes only for their intended purpose).
      - *Option A, leave it out of the store build (lower review risk):* remove
        `UIBackgroundModes` from the store build only (for example a workflow input that
        runs `/usr/libexec/PlistBuddy -c "Delete :UIBackgroundModes"` before Archive in
        `ios.yml`) **and** hide the Picture in Picture setting and the More entry in that
        build (a code change; without it the setting would do nothing). TestFlight builds
        can keep both. Drop the reviewer paragraph. Neither part exists yet.
      - *Option B, submit as is:* keep the reviewer paragraph "Background audio mode" in
        review-notes.md, and walk through its steps (setting on, Demo desktop, leave the
        app) on the submitted build. Nothing else to change.
- [ ] Turn on private vulnerability reporting (repository Settings › Code security), which
      SECURITY.md tells reporters to use. It was off when checked on 2026-11-21.
- [ ] Check App Store Connect for a privacy-manifest warning (privacy-answers.md).
- [ ] Android release keystore: create it, store it safely, add the four secrets
      (BUILDING.md §6). The release-signing step has never run.
