# Marketing review for the first release

Name, positioning, listing copy, screenshot plan, GitHub presentation and a launch
checklist. The assets themselves are in [`marketing/`](../../marketing/README.md). This file
adds to the drafts in this folder ([listing.md](listing.md), [review-notes.md](review-notes.md));
it does not replace them. Written 2026-11-21.

**Claims.** All copy below names only features that are in the code and in
[docs/FEATURES.md](../FEATURES.md). Most of them are marked "Built – untested on device"
there. The copy assumes the device checklists ([docs/checklists/](../checklists/README.md))
pass before submission; drop any line for a feature that did not work on a phone. Single
sign-on is experimental and Duo has never run against Duo, so neither appears in a headline.

**Facts checked while writing this:**

- The app icon in `app/ios/.../AppIcon.appiconset` and the Android mipmaps is still the
  **Capacitor placeholder** (blue crossed bars on a grid), and `app/public/favicon.svg` is
  **Vite's default logo**. Neither can ship. See "Owner decisions".
- The theme accent is teal (`#1f6f5c` light, `#5cc8a8` dark). All assets use it.
- Licence: GPL-3.0-or-later with the app-store permission (`LICENSE`,
  `LICENSE-APP-STORE-EXCEPTION`, Settings › About). README and FEATURES.md now say the same.

---

## Owner decisions (2026-11-21): name "Open Mobile Guac", short form "OMG"

**This section supersedes the name recommendation in (a)** and the name used in the copy
in (c). The owner chose:

- **App Store name: `Open Mobile Guac`** (16 characters, three words).
- **Short form: OMG** (the bundle id already ends in `.omg`), used as the home-screen name
  and as the lettering in the icon.
- **Banner concept A** ("Midnight", dark). Concept B is withdrawn.
- The listing must make it unmistakable that the app **only works with an Apache Guacamole
  server the user runs** and is not a general remote-desktop app.

### Subtitle (max 30), paired with "Open Mobile Guac"

| # | Subtitle | Chars | Note |
|---|---|---|---|
| 1 | `For Apache Guacamole servers` | 28 | **Recommended.** Reads as a requirement ("for … servers"), uses the full mark in the ASF's own "for Apache *Project*" form, and puts "Apache" and "Guacamole" in the indexed fields |
| 2 | `Client for Apache Guacamole` | 27 | Equally ASF-clean; "client" tells technical users a server is needed, but says less to everyone else |
| 3 | `Apache Guacamole client` | 23 | Shortest; starts with the mark, which reads closer to an official product. Only if 1 and 2 are rejected |
| 4 | `Needs your Guacamole server` | 27 | The most explicit requirement, but uses "Guacamole" without "Apache" on its first prominent use, which the ASF guidance discourages |

**Fallback store names** if "Open Mobile Guac" is already taken (the owner must check):
`Open Mobile Guac Client` (23) or `Open Mobile Guac – OMG` (22). Do not use a bare "OMG"
as the store name: a three-letter word is unlikely to be free and is unsearchable.

**Home-screen display name: `OMG`.** "Open Mobile Guac" (16 characters) is truncated under
the icon on both platforms (about 12 characters fit); "OMG" never is, and it matches the
icon lettering and the bundle id. (`CFBundleDisplayName` on iOS, the app label on Android:
a change in `app/`, not made here.)

**Play:** title `Open Mobile Guac`; short description (max 80):
`Requires your own Apache Guacamole server. Touch-first, free and open source.` (77).

**Trademark guidance kept:** "Apache Guacamole" only descriptively ("for Apache Guacamole
servers", "requires your own Apache Guacamole server"); no ASF feather, no Guacamole logo
or imitation of it; the unofficial / not-endorsed line stays in the description and in the
README hero. "Guac" in the name carries the same low-to-moderate risk assessed in (a). Not
legal advice.

### Requirement up front

Promotional text (max 170):

```
Requires your own Apache Guacamole server. Open Mobile Guac makes it comfortable by touch: trackpad or direct pointer, extra keys, clipboard both ways. Free, no account.
```

169 characters.

First two sentences of the description (they replace the first paragraph in (c)):

```
Open Mobile Guac (OMG) requires your own Apache Guacamole server: it is a client for the Guacamole gateway that you or your organisation already runs, not a stand-alone remote-desktop app. With it, the desktops and terminals your server offers become comfortable to use by touch on iPhone, iPad and Android.
```

In the rest of the description, write "Open Mobile Guac" instead of "OpenMobileGuac",
except in the GitHub address.

Screenshot caption 1 (all sets): headline "Your remote desktop, made for **touch**", with the
subline in mint semibold: **"Requires your own Apache Guacamole server"** (rendered in
`marketing/screenshots/*/01-session.png`). Every banner carries the same line as a badge.

Keywords (max 100), for the name "Open Mobile Guac" with subtitle 1 (words already in the
name and subtitle are left out):

```
remote,desktop,rdp,vnc,ssh,telnet,guacd,selfhosted,homelab,terminal,trackpad,keyboard,touch,omg
```

95 characters, no spaces.

### App icon: option 3 chosen (owner decision, 2026-11-21)

**Final:** option 3, a screen and pointer showing an avocado half, on an avocado-green
gradient (`marketing/brand/icon-3.svg` / `.png`; drawing code in
`marketing/tools/icon-art.mjs`). The owner also confirmed: store name "Open Mobile Guac",
subtitle "For Apache Guacamole servers", home-screen label "OMG".

It is now wired into the app (generated by `marketing/tools/app-assets.mjs` at the exact
pixel size of each file it replaced):

- iOS: `AppIcon.appiconset/AppIcon-512@2x.png` (1024 × 1024, opaque RGB, square corners;
  iOS applies the mask) and the three `Splash.imageset` images (2732 × 2732, green with the
  icon art centred). The imageset has no dark variant, so none was added.
- Android: `ic_launcher`, `ic_launcher_round` and `ic_launcher_foreground` in every
  `mipmap-*` density; a new `ic_launcher_monochrome` per density for Android 13 themed
  icons, referenced from `mipmap-anydpi-v26/ic_launcher.xml` and `ic_launcher_round.xml`;
  background colour `#44702A` in `values/ic_launcher_background.xml`; all 11 `splash.png`
  drawables.
- Web: `app/public/favicon.svg`.

**Comparison with the official Apache Guacamole logo: still the owner's to do.** I do not
know the official logo's exact shapes reliably enough to describe them from memory, and I
did not download or view it. Before submission, the owner should put the two side by side
and confirm that option 3 cannot be mistaken for it or for an official product. What option 3
avoids by construction: lettering, a bowl, chips, a mascot or face, and the Apache feather.
Its only food cue is a symmetric, geometric avocado cross-section on a monitor.

The other options are kept as SVG only in `marketing/brand/alternatives/` (with the old
comparison sheet).

### Icon options (as proposed; superseded by the decision above)

The app still shipped the Capacitor placeholder icon. Four options, each a 1024 × 1024 SVG and
PNG: opaque (iOS master), key content inside the inner 66 % for Android adaptive icons, no
fine detail. `alternatives/icon-options-sheet.png` shows each one at 180 px with the iOS corner mask, with
an Android round mask of the inner 66 %, and at 60 px, on light and dark.

| # | File | Idea | At 60 px |
|---|---|---|---|
| 1 | `icon-1.svg` / `.png` | **"OMG" lettering** in white on the app's teal gradient. The letters are round-capped strokes, not a font | Clearest of the four |
| 2 | `icon-2.svg` / `.png` | A mint screen outline with "OMG" inside, on near-black | Readable; the letters get small |
| 3 | `icon-3.svg` / `.png` | Screen and pointer in an **avocado palette**; the screen shows a flat avocado-half cross-section (lime flesh, round brown pit) | Reads as "green screen with an avocado"; the pointer is lost |
| 4 | `icon-4.svg` / `.png` | A large **key cap** with "OMG" on it (the extra key bar is the app's signature) on teal | Readable and distinctive |

**Recommendation at the time (not taken): option 1.** It is the most legible at small sizes, carries the short name
the owner chose, uses the app's own colours, and contains nothing that could be confused
with the Apache Guacamole project. If the owner wants a visible "guac" cue, take option 3
after the check below.

**How option 3 stays clear of the official logo.** It has no lettering, no bowl, no chips,
no mascot or face, and no shape taken from the Apache Guacamole logo. The only food cue is a
symmetric, geometric avocado cross-section made of simple curves and a circle, shown as the
picture on a monitor with a pointer, in a generic avocado green. I did not look at or
download the official logo while drawing it, so **the owner should compare the two side by
side** before choosing it. The original brief for these assets said to avoid avocado
imagery that implies official status; option 3 exists only because the owner asked for a
guac hint.

The banners show whichever icon is in `marketing/brand/banner-icon.svg` (now option 3); see
"Swapping the icon" in marketing/README.md.

---

## (a) Naming (first review; its recommendation is superseded, see above)

### "OpenMobileGuac" as a store name

| Question | Assessment |
|---|---|
| Clarity | Clear to people who already run Guacamole ("Guac" is the community's short form) and says open source and mobile. To anyone else it says nothing about remote desktops. In the store, the subtitle has to do that work. |
| Trademark | "Apache Guacamole" and "Guacamole" are ASF trademarks. "Guac" is not itself a registered mark as far as the project docs record, but it is an obvious short form, and the ASF policy covers names that are confusingly similar. The "Open" prefix, the unofficial line and the absence of any ASF logo lower the risk. The ASF's own guidance favours the pattern "*Product* for Apache *Project*", which the subtitle below follows. Risk: **low to moderate**; an ASF request to rename is possible but not likely. Apple can also question third-party marks in an app name (App Review guideline 5.2.1); the descriptive "for Apache Guacamole servers" in the subtitle is the accepted way to name compatibility. This is not legal advice. |
| Pronounceability | "Open-Mobile-Gwack": readable, but a 14-letter camel-case word is hard to say aloud or remember the spelling of. People will write "Open Mobile Guac", "OpenGuac" or "OMG". |
| Acronym | "OMG" is already the CSS prefix in the code (`--omg-…`). Fine internally; avoid it in marketing. |
| Search | Store search weights the title most. "OpenMobileGuac" alone ranks only for itself. Adding "Remote Desktop" to the store title is the single biggest search gain available. People who search "guacamole" will also find it through the subtitle and description. |
| Switching cost | The name is in the repo URL, backup format ("not an OpenMobileGuac backup"), file paths (Files › OpenMobileGuac › Downloads), deep links (`openmobileguac://`) and the About screen. Renaming the project is a real cost; renaming only the store title is not. |

### Five alternatives

The owner must check every name in both stores, on GitHub and with a trademark search
(for example the USPTO and EUIPO databases) before deciding. Availability was **not**
checked here.

| Name | Pros | Cons |
|---|---|---|
| **Molcajete** (the stone bowl guacamole is made in) | Memorable, witty nod to Guacamole without using the mark; fits the Spanish localisation; very low trademark risk in this class | Hard to spell and say outside Spanish-speaking countries; no search value; needs the subtitle to explain everything |
| **Guac Touch** | Short, says "touch"; strong for people who know Guacamole | Starts with the mark's short form, which listing.md already advises against; highest trademark risk of the five |
| **Thumbport** | Short, neutral, ownable; "thumb" + "port" hints at touch and connection | No meaning or search value on its own; may collide with existing small apps |
| **Gatepad** | Describes the product: a pad (trackpad, key pad) for a gateway | Generic-sounding; possible collisions with hardware products |
| **Pocket Gateway** | Plain description of what Guacamole plus a phone is | Generic phrase, hard to own or find; two words |

### Recommendation (superseded by the owner decision above)

Keep **OpenMobileGuac** as the project and app name (no switching cost, the open-source
promise is in the name), and add the category to the **store title** only:

| Field | Text | Characters |
|---|---|---|
| App Store name (max 30) | `OpenMobileGuac Remote Desktop` | 29 |
| Subtitle (max 30) | `For Apache Guacamole servers` | 28 |
| Home-screen name | `OpenMobileGuac` (or the shorter `MobileGuac` if it is cut off: check on a device) | 14 |

Other pairs, in order of preference:

| Name | Subtitle | Note |
|---|---|---|
| `OpenMobileGuac Remote Desktop` (29) | `Touch client for Guacamole` (26) | Puts "touch" in the indexed fields |
| `OpenMobileGuac` (14) | `Remote desktop for Guacamole` (28) | If the owner prefers the bare name |
| `Molcajete Remote Desktop` (24) | `For Apache Guacamole servers` (28) | Only if the owner wants no "Guac" in the name at all |

Google Play: title max 30 characters, the same `OpenMobileGuac Remote Desktop`; short
description in listing.md is good as is.

---

## (b) Positioning

**One-sentence pitch:** OpenMobileGuac is a free, open-source iPhone, iPad and Android app
that makes the Apache Guacamole server you already run comfortable to use by touch.

**Three key messages**

1. **Made for touch.** Direct-touch or trackpad pointer, an extra key bar with Esc, Ctrl,
   Alt, arrows and F-keys, key sets for Windows, macOS and Linux terminals, saved combos,
   and a landscape layout that moves the toolbar and keys to the sides so the desktop gets
   the whole height. Every gesture is explained in Settings with a small animation.
2. **Your server, your rules.** It talks only to the Guacamole servers you add: no
   account, no cloud relay, no analytics, ads or tracking. Passwords stay in the
   Keychain / Keystore behind an optional Face ID / fingerprint lock; self-signed HTTPS is
   trusted per server after checking the certificate fingerprint; TOTP works as on the web.
3. **Open source, for good.** GPL-3.0-or-later, free, no paid tier; every behaviour is a
   setting rather than one fixed UI, and you can build it yourself.

**Who it is for**

- Home-lab and self-hosting users who already run Guacamole for their PCs, VMs and SSH
  boxes and want something better on a phone than the web client in a browser.
- Small IT teams and schools that provide Guacamole to staff, and the admins who need to
  look at or join a session, or change a connection's quality, from a phone.
- Not for: people without a Guacamole server (the listing must say so early, or reviews
  will be "it doesn't connect to my PC").

**Comparison stance.** Do not name, rank or criticise other apps, in the store or on
GitHub. Compare only with the situation the user is in: "instead of the web client in a
mobile browser" is fine, because that is Guacamole itself and the comparison is factual
(docs/GUACAMOLE-PARITY.md). Lead with what this app does and why it is trustworthy (open
source, no account, no tracking), not with what others lack.

---

## (c) Listing review

The drafts in [listing.md](listing.md) are accurate, careful with the trademark and honest
about the server requirement. Points to improve:

1. **The first three lines decide everything.** The store shows about three lines before
   "more". Today they spend that on "is a free, open-source app… It is an unofficial
   client…". Lead with the benefit and the requirement, keep the disclaimer at the end.
2. **Keywords repeat the title.** With "Remote Desktop" in the store name, the keyword
   field should not spend 15 characters on it. "touch" is in the subtitle option 2 only.
3. **Missing differentiators**: the Gestures guide, the landscape side layout, key sets
   by name, biometric fill of connection passwords, joining sessions (admins), English and
   Spanish.
4. **"Toolbar at the bottom, top, side or floating; many options in Settings"** undersells
   the "everything is a setting" principle; make it a headline section.
5. **Face ID line** is iOS-only; the Play version needs the Android wording (listing.md
   already notes it).

### Promotional text (App Store, max 170) (superseded: see "Requirement up front")

```
Your own Apache Guacamole server, made for touch: trackpad or direct pointer, extra keys and key sets, clipboard both ways. Free and open source. No account, no tracking.
```

170 characters.

### Keywords (App Store, max 100, no spaces) (superseded: see "Requirement up front")

With the recommended name and subtitle (words already in the name or subtitle are left out):

```
rdp,vnc,ssh,telnet,guacd,selfhosted,homelab,terminal,trackpad,keyboard,gateway,opensource,pc,linux
```

98 characters, no spaces. Apple indexes the name and subtitle words separately, so "remote", "desktop", "apache", "guacamole" and "servers" are already covered. If the subtitle does not contain "Guacamole", replace `linux` with `guacamole` (words in the description do not count for App Store search). `opensource` and `selfhosted` are written as one word to keep the field free of spaces; also try `open source` if the owner prefers natural phrases.

### Description (both stores, max 4000)

Use it with the new first paragraph from "Requirement up front", and "Open Mobile Guac" as the name.

```
Use the Apache Guacamole server you already run from your iPhone, iPad or Android phone, with controls made for touch. OpenMobileGuac is free, open source and has no account, no ads and no tracking.

You need a Guacamole server that you or your organisation runs. The app shows the desktops and terminals your server offers (RDP, VNC, SSH, Telnet, Kubernetes). Not sure yet? Open the built-in Demo: a simulated desktop that runs on the device, so you can try every control without a server.

MADE FOR TOUCH
- Direct touch or trackpad pointer, one tap to switch
- Pinch to zoom and pan; fit screen, fit width, fit height or 1:1 pixels, remembered per connection
- Every gesture explained in Settings, each with a small animation, most with a switch
- RDP multi-touch, hardware mouse and keyboard
- Turn the phone sideways: the toolbar and keys move to the sides and the desktop gets the full height

A KEYBOARD THAT WORKS
- Soft keyboard on demand, even when nothing on the remote has focus
- Extra key bar: Esc, Tab, sticky Ctrl, Alt, Shift and Win, arrows, Home/End, F1–F12
- Key sets for Windows, macOS, Linux terminals, editing and function keys, or build your own
- Saved key combos such as Ctrl+Alt+Del, built by tapping keys

CLIPBOARD, FILES AND SOUND
- Clipboard in both directions, with a panel to check or edit text before sending
- Upload and download files through the drive or SFTP your server provides
- RDP print jobs arrive as a PDF
- Sound, and the microphone for RDP when you turn it on

EVERYTHING IS A SETTING
- Toolbar docked at the bottom, top or side, or floating; choose and order its buttons
- Pointer speed, scrolling direction, gesture timings, key bar behaviour and more
- Per-connection overrides, with "Use app default" one tap away

YOUR SERVERS
- Several servers and several sessions at once
- Folders, search, favourites, recents and thumbnails
- Two-factor sign-in with TOTP; single sign-on (experimental)
- Self-signed HTTPS: trust your server's certificate after checking its fingerprint
- Admins can manage connections and folders, and see or join active sessions

PRIVATE BY DESIGN
- No account, no analytics, no ads, no tracking
- The app talks only to the servers you add
- Saved passwords stay in the device keychain
- Optional app lock with Face ID, Touch ID or the device passcode, also before saved passwords are filled in
- Backups can include passwords only encrypted with your passphrase

OPEN SOURCE
The full source code, the build workflows and the privacy policy are public at github.com/testyfishy/OpenMobileGuac, under the GNU GPL version 3 or later. Anyone can read it and build it themselves. Available in English and Spanish.

OpenMobileGuac is an unofficial client and is not made or endorsed by the Apache Software Foundation. Apache, Apache Guacamole and Guacamole are trademarks of the Apache Software Foundation.
```

About 2,700 characters. Play version: replace "Face ID, Touch ID or the device passcode" with
"fingerprint, face unlock or the device PIN" and "iPhone, iPad or Android phone" with
"Android phone or tablet".

### What's New (first version)

```
First release.
- Touch-first controls: direct or trackpad pointer, extra key bar, key sets and saved combos
- Landscape layout with the toolbar and keys at the sides
- Clipboard both ways, file transfer, sound and RDP microphone
- TOTP sign-in, self-signed HTTPS trust and an optional Face ID lock
- A built-in Demo desktop to try everything without a server
Free and open source. No account, no tracking.
```

---

## (d) Screenshot plan

All images are in `marketing/screenshots/`. **Real captures** of the web build running the
built-in Demo (headless Edge at the device's CSS size and pixel ratio), framed in a drawn
phone outline with a caption on top. **Mock-ups: none.** Slot 8 is a typographic card, not a
screenshot. The admin "join session" screen was not captured (see "What could not be done").

### iPhone 6.9" (1290 × 2796), order and captions

| # | File | Caption | Subline | Shows (real capture) |
|---|---|---|---|---|
| 1 | `01-session` | Your remote desktop, made for **touch** | **Requires your own Apache Guacamole server** (mint) | Demo desktop with the docked toolbar |
| 2 | `02-keys` | Esc, Ctrl, Alt and arrows, **one tap** away | Extra key bar, with or without the keyboard | Key bar above the toolbar |
| 3 | `03-landscape` | Turn sideways for the **full height** | Toolbar and keys move to the sides | Two landscape captures: key column shown / hidden |
| 4 | `04-keysets` | Key sets for **every kind** of desktop | Windows, macOS, Linux terminal, or your own | Switch key set sheet |
| 5 | `05-gestures` | Every gesture **explained** | Animated, with switches to turn gestures off | Settings › Gestures |
| 6 | `06-view` | Fit, zoom or **pixel-perfect** 1:1 | Remembered for each connection | View sheet |
| 7 | `07-more` | Every option is **a setting** | Pointer, keyboard, toolbar, clipboard, sound | More sheet |
| 8 | `08-privacy` | Private by **design** | No account / no ads, no tracking / keychain / app lock / open source | Typographic card |

The first three carry the listing (most people never scroll further); keep that order.
The App Store allows up to 10 per size; 1290 × 2796 is accepted for the 6.9" slot and Apple
scales it for smaller iPhones.

**Landscape option (2796 × 1290):** `iphone-6.9-landscape/01-landscape.png`, caption on the
left, landscape capture on the right. Mixing orientations in one set is allowed as far as known here, but a consistent set looks better in the store row; check in App Store Connect. Slot 3 already shows landscape inside a portrait frame.

### iPad 13" (2064 × 2752)

`ipad-13/`: 01-session, 02-keys, 03-more, 04-gestures (the iPad layout shows the server list
beside Settings), 05-privacy. Same captions as the iPhone set.

### Google Play

- Phone, 1080 × 1920 (`play-phone/`): the same eight, with the Android wording on the
  privacy card (fingerprint, face unlock, device PIN). Play takes 2–8 phone screenshots.
- Feature graphic, 1024 × 500: `marketing/banners/play-feature-graphic-1024x500.png`.
- 7" and 10" tablet screenshots are optional; the iPad images (resized) can be used once
  the Android tablet layout has been checked.
- App icon 512 × 512 is required and does not exist yet (see "Owner decisions").

### Known limits of the captures

- They come from the **web build in desktop Edge**, so the font is Segoe UI, not SF Pro or
  Roboto, and there is no system status bar. Apple wants screenshots that show the app in
  use; these do, but re-capturing the same scenes from the iOS Simulator and an Android
  emulator before release would match each platform exactly. The scenes are scripted in
  `marketing/tools/capture.mjs`.
- On the iPad and landscape captures, the app's "Demo" pill covers part of the demo
  desktop's own title ("Demo" + "no" shows). That is how the app looks today; a small inset
  on the pill or the demo desktop's top bar would fix it (app change, not done here).
- The demo desktop clock is pinned to 09:41.

---

## (e) GitHub

**Social preview (Settings › Social preview, 1280 × 640):**
`marketing/banners/social-preview-1280x640.png`: concept A, chosen by the owner (dark,
portrait phone with the toolbar, "Open Mobile Guac" with the OMG icon, and the line
"Requires your own Apache Guacamole server").

**README hero:** concept A in a dark and a light version, switched by the viewer's theme:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="marketing/banners/readme-hero-dark-1600x600.png">
  <img alt="Open Mobile Guac (OMG): your remote desktop, made for touch. Requires your own Apache Guacamole server. Free and open source for iOS and Android." src="marketing/banners/readme-hero-light-1600x600.png">
</picture>
```

If only one is used, use the dark one: it has its own background and reads well on both themes.

**Short repo description (About field):**

```
Open Mobile Guac (OMG): free, open-source iOS and Android client for your own Apache Guacamole server. Touch-first. No account, no tracking.
```

**Topics** (GitHub allows 20):

```
guacamole, apache-guacamole, remote-desktop, rdp, vnc, ssh, self-hosted, homelab, ios, android,
capacitor, react, typescript, mobile-app, touch, open-source, gpl-3
```

**Website field:** none needed yet; later the App Store link.

---

## (f) Launch checklist (only the owner can do these)

Adds to the checklist in [README.md](README.md) in this folder.

Brand

- [x] App icon chosen (option 3) and wired into iOS, Android and the web favicon.
- [ ] Compare option 3 side by side with the official Apache Guacamole logo (see "App icon").
- [ ] Look at the new icon and splash on a real iPhone and Android phone (themed icon too).
- [ ] Upload the Play icon: `marketing/brand/play-icon-512.png` (512 × 512, opaque).
- [ ] Check that "Open Mobile Guac" is free in both stores (fallbacks in "Owner decisions")
      and run a trademark search. Subtitle and "OMG" home-screen label are decided and set.

Store pages

- [ ] Paste the promotional text, keywords, description and What's New (section c) after
      removing any line for a feature that did not work on a device.
- [ ] Upload screenshots: `iphone-6.9/` (8), `ipad-13/` (5), `play-phone/` (8) and the feature
      graphic. Look at each one first; they contain only the Demo.
- [ ] Optionally re-capture from the iOS Simulator / Android emulator for native fonts.

GitHub

- [ ] Settings › Social preview: upload the chosen 1280 × 640 PNG.
- [ ] About: description and topics (section e).
- [ ] Decide whether to add the README hero (README.md is not edited by this review).

Announcement (each post is the owner's decision and account)

- [ ] Where to announce: r/selfhosted, r/homelab, the Guacamole user mailing list, Mastodon,
      Lemmy. Use the link card (1200 × 628) or the square image. Say "unofficial" in every
      post. Never post a screenshot of a real desktop.
- [ ] Pick the public contact identity for support (GitHub issues only is enough).

---

## What could not be done here

- **Store availability and trademark searches**: not possible from here; the owner must check.
- **Admin screens** (connection management, active sessions with Join): these run against
  a fake in-memory server (`?harness=admin`); driving it was refused by the session's
  permission checks, so there is no capture and no mock-up of them. To add one, run the
  harness yourself and capture with `capture.mjs`-style steps.
- **File transfer screenshot**: the Demo connection has no file system, so its Files sheet
  only shows "Send file to remote"; it was left out rather than staged.
- **Biometric lock and certificate trust**: the web build shows these as "mobile app only"
  or hides them, so they are named in copy and on the privacy card but not shown.
