# Features and parity

Status of OpenMobileGuac against other mobile remote-desktop clients, compiled 2026-11-18.

> **Nothing in this app has run on a physical phone or against a real Guacamole server
> yet.** Everything marked "Built" is implemented and unit-tested, and has been exercised
> only in a desktop browser against the in-app demo server. Device gates G0 and G1
> (`docs/PLAN.md`) are still open.

Other products' features were taken from their own documentation, store listings and
release notes, linked per cell. "?" means the feature could not be confirmed from a fetched
page. It does not mean the product lacks it. No text, code or assets were copied from other
products.

## 1. OpenMobileGuac feature list

Tags:

- **Built**: in the tree and working in a desktop browser; nothing device-specific.
- **Built – untested on device**: code and unit tests are in the tree; not yet tested on a
  device or a real server.
- **Partial**: some of it is in the tree.
- **In progress**: another work stream is adding it now; files are appearing but not
  finished. These will be reconciled.
- **Planned**: has a SPEC requirement or PLAN task; no code yet.
- **Not planned**: out of scope, or not possible with Guacamole.

IDs refer to `docs/SPEC.md` §6.

### Servers and sign-in

| Feature                                                                                                                                          | Status                     | ID     |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | ------ |
| Several server profiles: add, edit, delete, reorder                                                                                              | Built – untested on device | SRV-1  |
| Address entry tolerant of a missing scheme or `/guacamole/` path, with distinct errors for unreachable, timeout, TLS failure and "not Guacamole" | Built – untested on device | SRV-2  |
| Passwords in Keychain / Keystore-backed storage (`@aparajita/capacitor-secure-storage`); dev builds warn that browser storage is unencrypted     | Built – untested on device | SRV-3  |
| Token reuse; silent re-login with a saved password                                                                                               | Built – untested on device | SRV-4  |
| Generic "additional credentials" step: TOTP code entry and TOTP enrolment (QR code and setup key)                                                | Built – untested on device | SRV-5  |
| Warning before sending a password over plain `http`, which can be turned off per server                                                          | Built – untested on device | —      |
| Biometric / device-credential gate (`ui/lock/` appearing)                                                                                        | In progress                | SRV-6  |
| SSO (SAML/OIDC/CAS) through an in-app browser (`core/sso/` appearing; the current sign-in form skips redirect fields)                            | In progress                | SRV-7  |
| Per-server trust of a self-signed certificate                                                                                                    | Planned                    | SRV-8  |
| Stored TOTP seed (`core/totp/` appearing)                                                                                                        | In progress                | SRV-9  |
| Profile export/import, backup and restore (`core/backup/` appearing)                                                                             | In progress                | SRV-10 |

### Connection browser

| Feature                                                                                                                | Status                     | ID    |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------- | ----- |
| Connection tree across data sources: nested groups, protocol label, "in use by n" indicator, balancing groups labelled | Built – untested on device | CON-1 |
| Search that ignores case and accents; pull to refresh                                                                  | Built – untested on device | CON-2 |
| Recents and favourites per server, stored locally                                                                      | Built – untested on device | CON-3 |
| Built-in demo server: a simulated desktop that runs offline in the app                                                 | Built – untested on device | T3.2  |
| Thumbnails of the last frame                                                                                           | Planned                    | CON-4 |
| Deep links / home-screen shortcuts (`core/links/` appearing)                                                           | In progress                | CON-5 |
| Sharing-profile links                                                                                                  | Planned                    | CON-6 |

### Display

| Feature                                                                                                                    | Status                                         | ID    |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----- |
| Fit screen / fit width / fit height / 1:1, remembered per connection                                                       | Built – untested on device                     | DSP-1 |
| Pinch zoom and pan with bounds and fling                                                                                   | Built – untested on device (60 fps unmeasured) | DSP-2 |
| Re-layout on rotation, resize, safe-area or visual-viewport change without reconnecting                                    | Built – untested on device                     | DSP-3 |
| "Match device size": sends the view size to the server (RDP display-update, SSH); off by default                           | Built – untested on device                     | DSP-4 |
| View follows the pointer when zoomed; stays above the soft keyboard                                                        | Built – untested on device                     | DSP-5 |
| Cursor drawn in an overlay from the server cursor image                                                                    | Built – untested on device                     | DSP-6 |
| Safe-area aware layout; collapsible session toolbar; keep-awake (Web Wake Lock API, which may be missing in some WebViews) | Partial (no immersive mode)                    | DSP-7 |
| Foldable tabletop posture; split trackpad/display layout                                                                   | In progress                                    | DSP-8 |
| Connecting / reconnecting / error / disconnected overlay; automatic reconnect with exponential backoff                     | Built – untested on device                     | DSP-9 |
| Background grace period with clean resume                                                                                  | Planned                                        | T2.1  |

### Pointer input

| Feature                                                                                                                       | Status                                                                                                                                 | ID    |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Direct touch mode (tap, double tap, long press, drag, two-finger scroll, pinch)                                               | Built – untested on device                                                                                                             | PTR-1 |
| Trackpad mode (relative; three-finger tap = middle click; double-tap-and-hold drag; adjustable speed)                         | Built – untested on device                                                                                                             | PTR-2 |
| One-tap mode toggle, remembered per connection                                                                                | Built – untested on device                                                                                                             | PTR-3 |
| Haptics on click, right click and drag start                                                                                  | Built – untested on device                                                                                                             | PTR-4 |
| Hardware mouse / trackpad: hover, buttons and wheel go straight to the remote. A stylus is treated as touch, with no pressure | Built – untested on device (input refinements in progress)                                                                             | PTR-5 |
| RDP multi-touch pass-through (a `touch` pointer mode is appearing in `PointerModel`)                                          | In progress                                                                                                                            | PTR-6 |
| Natural scrolling and pointer speed settings; two-finger drag can scroll or pan (model option)                                | Partial (no long-press duration setting)                                                                                               | PTR-7 |
| Horizontal scrolling                                                                                                          | Not planned: Guacamole's mouse state has only wheel up/down (`Guacamole.Mouse.State` in `app/src/vendor/guacamole-common-js/index.js`) | —     |

### Keyboard

| Feature                                                                                             | Status                                                               | ID    |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----- |
| Keyboard button raises the soft keyboard regardless of remote focus                                 | Built – untested on device                                           | KEY-1 |
| Hidden-field text bridge: diffs, Backspace, Enter, Unicode, IME composition                         | Built – untested on device (IME and swipe typing untested on device) | KEY-2 |
| Extra-key bar: Esc, Tab, sticky/locked Ctrl/Alt/Shift/Win, arrows, Home/End, PgUp/PgDn, Del, F1–F12 | Built – untested on device                                           | KEY-3 |
| Combo menu: presets plus user combos that can be reordered and deleted                              | Built – untested on device                                           | KEY-4 |
| Key bar usable with the soft keyboard hidden                                                        | Built – untested on device                                           | KEY-5 |
| Hardware keyboard pass-through, with modifier chords synthesised when missing                       | Built – untested on device (refinements in progress)                 | KEY-6 |
| User-editable key bar                                                                               | Planned                                                              | KEY-7 |

### Clipboard

| Feature                                                                        | Status                     | ID    |
| ------------------------------------------------------------------------------ | -------------------------- | ----- |
| Paste button (device → remote); optional auto-send when a session opens        | Built – untested on device | CLP-1 |
| Remote → device text, can be turned off                                        | Built – untested on device | CLP-2 |
| "Type clipboard" as keystrokes (long press on Paste)                           | Built – untested on device | CLP-3 |
| The device clipboard is read only on an explicit action unless auto-send is on | Built – untested on device | CLP-4 |
| Clipboard panel for editing text before sending                                | Planned                    | CLP-5 |
| Image or file clipboard                                                        | Not planned (see §3)       | —     |

### Media, files, sessions, app

| Feature                                                                                                                                                                                                   | Status                                 | ID     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------ |
| Audio playback. The vendored library plays audio streams by default, and supported types are advertised at connect (`ui/launch/mediaSupport.ts`). There is no mute, audio-focus or silent-switch handling | Partial                                | AUD-1  |
| File browser, upload and download (no `onfile`/`onfilesystem` handlers yet)                                                                                                                               | Planned                                | FIL-1  |
| Several sessions at once, with a switcher (`ui/sessions/` appearing)                                                                                                                                      | In progress                            | MUL-1  |
| Settings: theme, session defaults, clipboard, haptics, keep-awake                                                                                                                                         | Built – untested on device             | SET-1  |
| All strings in one table (`ui/strings.ts`). Translations (`ui/i18n/`) are appearing                                                                                                                       | Partial / In progress                  | I18N-1 |
| Accessible labels on session chrome. VoiceOver/TalkBack and dynamic type have not been checked                                                                                                            | Partial                                | A11Y-1 |
| Local diagnostics and connection test (`core/diagnostics/` appearing)                                                                                                                                     | In progress                            | DIAG-1 |
| Server credential prompt (`required` instruction) for connections without stored credentials                                                                                                              | Not built (no handler); see §3         | —      |
| Microphone input, printing, session-recording playback                                                                                                                                                    | Not planned for v1 (SPEC §4 non-goals) | —      |
| No analytics, ads, account or third-party hosts (no such dependencies in `app/package.json`)                                                                                                              | Built                                  | §7     |

## 2. Parity matrix

Legend: **Y** yes · **P** partial or limited (see the source) · **N** no · **?** not
confirmed from a fetched page · **–** not applicable. In the OpenMobileGuac column, **B†**
means Built – untested on device, and **WIP** means in progress. Bracketed keys link to
the sources in §2.1.

| Feature                                 | OpenMobileGuac               | PocketGuac            | Guacamole web (mobile browser) | DWService                            | Windows App                                              | Jump Desktop                                   | RealVNC Viewer            | TeamViewer               | AnyDesk                   | Chrome Remote Desktop                 | RustDesk                          | bVNC / aRDP              | Termius          |
| --------------------------------------- | ---------------------------- | --------------------- | ------------------------------ | ------------------------------------ | -------------------------------------------------------- | ---------------------------------------------- | ------------------------- | ------------------------ | ------------------------- | ------------------------------------- | --------------------------------- | ------------------------ | ---------------- |
| Direct touch pointer                    | B†                           | Y [PG2]               | Y [GW1]                        | ?                                    | Y [MIN]                                                  | Y [JG]                                         | P iOS only [RU]           | Y [TVI]                  | Y [ADI]                   | P Windows hosts [CA]                  | Y [RDA]                           | Y [BV]                   | –                |
| Trackpad (relative) pointer             | B†                           | Y [PG1]               | Y [GW1]                        | Y [DGE]                              | P cursor follows finger [MIN]                            | Y [JG]                                         | Y [RU]                    | Y [TVI]                  | Y [ADA]                   | Y [CA]                                | Y [RDA]                           | Y [BV]                   | –                |
| Multi-touch pass-through                | WIP                          | ?                     | Y RDP [GW2]                    | ?                                    | Y [MIN]                                                  | Y [JG]                                         | ?                         | ?                        | P Android→Android [ADA]   | ?                                     | ?                                 | ?                        | –                |
| Two-finger vertical scroll              | B†                           | Y [PG2]               | Y [GW1]                        | Y [DGE]                              | Y [MIN]                                                  | Y [JG]                                         | Y [RU]                    | ?                        | P 3-finger [ADA]          | Y [CA]                                | ?                                 | Y [BV]                   | –                |
| Horizontal scroll                       | N (protocol)                 | ?                     | ?                              | ?                                    | ?                                                        | ?                                              | ?                         | ?                        | ?                         | ?                                     | ?                                 | ?                        | –                |
| Local pinch zoom                        | B†                           | Y [PG1]               | Y [GW1]                        | Y [DGE]                              | Y [MIN]                                                  | Y [JG]                                         | Y [RU]                    | ?                        | Y [ADA]                   | Y [CA]                                | ?                                 | Y [BV]                   | –                |
| Three-finger gestures                   | B† middle click              | ?                     | Y [GW1]                        | ?                                    | ?                                                        | Y [JG]                                         | Y [RU]                    | ?                        | Y [ADA]                   | Y [CA]                                | ?                                 | Y [BV]                   | –                |
| Fit / scale modes                       | B† 4 modes                   | P zoom/pan [PG1]      | P fit + zoom [GW1]             | Y [DSC]                              | P global [MDS]                                           | Y [JI]                                         | ?                         | ?                        | ?                         | ?                                     | ?                                 | Y [BV]                   | –                |
| Remote resolution matches device        | B† opt-in                    | ?                     | Y [GW2]                        | ?                                    | P Android only, no dynamic [MCMP]                        | Y [JI] [JA]                                    | ?                         | ?                        | ?                         | ?                                     | ?                                 | Y [BV] [AR]              | –                |
| Extra-key bar                           | B†                           | P combo screen [PG1]  | P on-screen keyboard [GW1]     | P keystroke menu [DSC]               | ?                                                        | Y [JI] [JA]                                    | Y [RU]                    | ?                        | Y [ADA] [ADI]             | ?                                     | ?                                 | Y [BV] [AR]              | Y [TM]           |
| Saved custom combos / macros            | B†                           | Y [PG1]               | ?                              | P fixed list [DSC]                   | ?                                                        | P macros [JI]                                  | ?                         | ?                        | P presets [ADA]           | ?                                     | ?                                 | ?                        | Y snippets [TMB] |
| Hardware keyboard                       | B†                           | ?                     | P browser [GW1]                | ?                                    | Y [MIN]                                                  | Y [JI]                                         | Y [RAS]                   | P [TVC]                  | ?                         | ?                                     | ?                                 | Y [BV] [AR]              | Y [TM]           |
| Hardware mouse / trackpad               | B†                           | ?                     | ?                              | ?                                    | Y [MIN]                                                  | Y [JI] [JA]                                    | Y [RAS]                   | ?                        | ?                         | ?                                     | ?                                 | P aRDP iOS [AR]          | –                |
| Stylus / Apple Pencil                   | P as touch                   | ?                     | ?                              | ?                                    | Y pressure [MIN]                                         | Y [JI]                                         | ?                         | ?                        | ?                         | ?                                     | ?                                 | ?                        | –                |
| Samsung DeX                             | untested                     | ?                     | ?                              | ?                                    | ?                                                        | ?                                              | ?                         | ?                        | ?                         | ?                                     | ?                                 | Y bVNC [BV]              | –                |
| Text clipboard both ways                | B†                           | Y [PG1]               | Y [GW1]                        | P manual [DCP]                       | Y [MCMP]                                                 | Y [JC]                                         | P iOS [RC]                | ?                        | Y [ADA]                   | ?                                     | ?                                 | Y [BV] [AR]              | –                |
| Image / file clipboard                  | N (§3)                       | ?                     | N [J55]                        | N [DCP]                              | P images, iOS [MCMP]                                     | N [JC]                                         | ?                         | ?                        | P files, Android [ADA]    | ?                                     | ?                                 | ?                        | –                |
| Type clipboard as keys                  | B†                           | ?                     | ?                              | ?                                    | ?                                                        | Y [JC]                                         | ?                         | ?                        | ?                         | ?                                     | ?                                 | ?                        | –                |
| File transfer                           | Planned                      | Y [PG1]               | Y [GW1]                        | Y [DA]                               | P drive redirection [MCMP]                               | P RDP, iOS [JAS]                               | N [RF]                    | Y [TVAS]                 | Y [ADA] [ADI]             | ?                                     | Y [RDM]                           | ?                        | –                |
| Audio out                               | P no controls                | Y [PG1]               | Y [GW2]                        | Y [DSC]                              | Y [MCMP]                                                 | Y [JAU]                                        | ?                         | Y [TVAS]                 | Y [ADA]                   | ?                                     | ?                                 | P aRDP iOS [AR]          | –                |
| Microphone in                           | Not planned v1               | ?                     | Y RDP [GW2]                    | ?                                    | Y [MCMP]                                                 | ?                                              | ?                         | ?                        | Y [ADA]                   | ?                                     | ?                                 | ?                        | –                |
| Choose remote monitor                   | N (protocol)                 | ?                     | N [J288]                       | Y [DSC]                              | P [MCMP]                                                 | Y [JD]                                         | ?                         | Y [TVAS]                 | Y [ADA]                   | ?                                     | ?                                 | ?                        | –                |
| Several sessions at once                | WIP                          | ?                     | Y [GW1]                        | ?                                    | ?                                                        | P iPad [JI]                                    | P plan limit [RN]         | ?                        | ?                         | ?                                     | ?                                 | ?                        | –                |
| Groups / folders                        | B†                           | Y [PG1]               | Y [GW1]                        | ?                                    | ?                                                        | ?                                              | ?                         | ?                        | ?                         | ?                                     | ?                                 | ?                        | –                |
| Search                                  | B†                           | ?                     | Y [GW1]                        | ?                                    | Y [MCMP]                                                 | ?                                              | Y [RAS]                   | ?                        | ?                         | ?                                     | ?                                 | ?                        | –                |
| Favourites / recents                    | B†                           | ?                     | P recents [GW1]                | ?                                    | Y [MCMP]                                                 | ?                                              | ?                         | P recents [TVAS]         | ?                         | ?                                     | P history [RDA]                   | ?                        | –                |
| Thumbnails                              | Planned                      | ?                     | Y [GW1]                        | ?                                    | ?                                                        | ?                                              | ?                         | ?                        | ?                         | ?                                     | ?                                 | ?                        | –                |
| Home-screen shortcut / deep link        | WIP                          | ?                     | ?                              | ?                                    | P Remote PC URI [MCMP]                                   | Y Android [JA]                                 | ?                         | ?                        | ?                         | ?                                     | ?                                 | ?                        | –                |
| 2FA                                     | B† TOTP                      | Y + stored seed [PG1] | Y TOTP, Duo [GW5]              | Y [DSEC]                             | ?                                                        | Y account [J2FA]                               | ?                         | P [TVAS]                 | Y [ADA]                   | ?                                     | P Pro [RD2FA]                     | P Pro SSH [BV]           | –                |
| SSO                                     | WIP                          | Y [PG1]               | Y [GW6]                        | ?                                    | Y Entra [MCMP]                                           | ?                                              | Y [RN]                    | Y [TVAS]                 | ?                         | P Google account [CA]                 | P Pro [RDD]                       | ?                        | –                |
| Biometric app lock                      | WIP                          | Y [PG1]               | –                              | ?                                    | ?                                                        | P iOS [JI]                                     | ?                         | ?                        | ?                         | ?                                     | ?                                 | ?                        | –                |
| Automatic reconnect                     | B†                           | Y [PG1]               | ?                              | ?                                    | Y [MAS]                                                  | Y [JAS]                                        | ?                         | ?                        | ?                         | ?                                     | ?                                 | ?                        | –                |
| Soft keyboard on demand                 | B†                           | ?                     | P text input mode [GW1]        | ?                                    | P Android toolbar; no third-party keyboards on iOS [MIN] | Y three-finger tap [JG]                        | ?                         | ?                        | Y auto-show option [ADA]  | ?                                     | ?                                 | ?                        | Y [TM]           |
| Tablet / split-screen / foldable layout | P relayout; tabletop WIP     | ?                     | ?                              | ?                                    | P Stage Manager, orientation [MCMP] [MDS]                | Y Split View, Android split-screen [JI] [JA]   | ?                         | ?                        | ?                         | ?                                     | ?                                 | ?                        | –                |
| Accessibility (store label)             | P labelled chrome, unchecked | ?                     | ?                              | ?                                    | none declared [MAS]                                      | none declared [JAS]                            | none declared [RAS]       | ?                        | ?                         | ?                                     | ?                                 | ?                        | –                |
| Wake-on-LAN                             | via server config            | ?                     | Y server-side [GW2]            | ?                                    | ?                                                        | ?                                              | ?                         | Y [TVAS]                 | ?                         | ?                                     | ?                                 | ?                        | –                |
| Vendor account required                 | N                            | N [PG1]               | N (own server)                 | Y [DOV]                              | ?                                                        | P Android [JGP]                                | Y [RN]                    | ?                        | P licence [ADA]           | Y [CA]                                | ?                                 | ?                        | –                |
| Traffic via vendor servers              | N                            | N [PG1]               | N (own server)                 | Y [DSEC]                             | ?                                                        | P relay, E2E [JH]                              | P broker or direct [RGP]  | ?                        | P cloud or on-prem [ADAS] | P [CI]                                | P public relay by default [RDG]   | ?                        | –                |
| Data collected (store label)            | None                         | None [PG1]            | –                              | ?                                    | Y [MAS]                                                  | Y not linked [JAS]                             | Y [RAS]                   | Y [TVAS]                 | Y not linked [ADAS]       | ?                                     | ?                                 | None [AR] [BVAS]         | –                |
| Open source                             | Y Apache-2.0                 | N [PG1]               | Y [GWH]                        | P agent [DSEC]                       | ?                                                        | ?                                              | ?                         | ?                        | ?                         | ?                                     | Y AGPL-3.0 [RDG]                  | Y GPL-3.0 [RDCG]         | –                |
| Price                                   | Free                         | Free [PG1]            | Free [GWH]                     | Free, optional plans [DH]            | Free [MAS]                                               | iOS one-time fee; Android free beta [JAS] [JA] | Subscription needed [RGP] | Free + paid plans [TVAS] | Free personal [ADAS]      | Free [CGP]                            | Free client [RDG]                 | Free/Pro; iOS paid [AR]  | ?                |
| Platforms                               | iOS, Android (not released)  | Android APK [PG1]     | Browser [GWH]                  | Android; no iOS app found [DDL] [DN] | iOS, Android [MAS] [MGP]                                 | iOS, Android beta [JAS]                        | iOS, Android [RAS] [RGP]  | iOS, Android [TVAS]      | iOS, Android [ADAS]       | Android; iOS app withdrawn [PW] [CGP] | Android; iOS as controller [RDAS] | Android, iOS [RDCG] [AR] | ?                |

Notes:

- **Closed-source products.** The "?" for Windows App, Jump, RealVNC, TeamViewer, AnyDesk
  and Chrome Remote Desktop means that no fetched page stated a licence.
- **Termius** is included only for its extra-keys UX:
  - The bar shows customisable groups of keys above the soft keyboard. [TM]
  - Holding Space and sliding sends arrow keys. [TM]
  - Snippets can be run from a side panel. [TMB]
  - The bar hides when a hardware keyboard is connected. [TM]
- **Widgets** (home-screen widgets) were not confirmed for any product, so there is no row.
- **Blink Shell** documents hardware-key remapping (for example Caps Lock as Esc/Ctrl). [BS]
- **PocketGuac** is closed source and is used here as a feature reference only.

### 2.1 Sources

PocketGuac: [PG1] site, [PG2] releases.
Guacamole: [GW1] using, [GW2] configuring, [GW3] protocol reference, [GW4] protocol
design, [GW5] manual index, [GW6] SSO, [GWH] home page, plus release notes [GR0910],
[GR120], [GR130], [GR140], [GR150], [GR160] and issues [J288], [J55], [PR1061].
DWService: [DGE], [DSC], [DCP], [DA], [DSEC], [DOV], [DH], [DDL], [DN].
Windows App: [MCMP], [MIN], [MDS], [MAS], [MGP].
Jump: [JI], [JA], [JG], [JC], [JAU], [JD], [JAS], [JGP], [JH], [J2FA].
RealVNC: [RU], [RC], [RF], [RN], [RAS], [RGP].
TeamViewer: [TVI], [TVA], [TVAS], [TVC].
AnyDesk: [ADA], [ADI], [ADAS].
Chrome Remote Desktop: [CA], [CI], [CGP], [PW].
RustDesk: [RDA], [RDM], [RDG], [RDAS], [RD2FA], [RDD].
bVNC/aRDP: [BV], [AR], [BVAS], [RDCG].
Termius/Blink: [TM], [TMB], [BS].

Some sources could not be fetched directly or are thin:

- help.realvnc.com blocked automated fetching; its articles were read by direct download.
- Google Play pages returned description text only.
- The Chrome Remote Desktop iOS App Store listing returns 404.
- anydesk.com pricing returned 403.
- Several dwservice.net pages had no usable content.
- bVNC/aRDP facts come mainly from the Apple App Store and an APKMirror copy of the Play
  description.
- TeamViewer's mobile documentation is thin.

[PG1]: https://guac.pocketsized.app/
[PG2]: https://github.com/pocketsized-apps/pocketguac/releases
[GW1]: https://guacamole.apache.org/doc/gug/using-guacamole.html
[GW2]: https://guacamole.apache.org/doc/gug/configuring-guacamole.html
[GW3]: https://guacamole.apache.org/doc/gug/protocol-reference.html
[GW4]: https://guacamole.apache.org/doc/gug/guacamole-protocol.html
[GW5]: https://guacamole.apache.org/doc/gug/
[GW6]: https://guacamole.apache.org/doc/gug/sso.html
[GWH]: https://guacamole.apache.org/
[GR0910]: https://guacamole.apache.org/releases/0.9.10-incubating/
[GR120]: https://guacamole.apache.org/releases/1.2.0/
[GR130]: https://guacamole.apache.org/releases/1.3.0/
[GR140]: https://guacamole.apache.org/releases/1.4.0/
[GR150]: https://guacamole.apache.org/releases/1.5.0/
[GR160]: https://guacamole.apache.org/releases/1.6.0/
[J288]: https://issues.apache.org/jira/browse/GUACAMOLE-288
[J55]: https://issues.apache.org/jira/browse/GUACAMOLE-55
[PR1061]: https://github.com/apache/guacamole-client/pull/1061
[DGE]: https://docs.dwservice.net/docs/site/basic-definitions/gestures/
[DSC]: https://docs.dwservice.net/docs/site/basic-definitions/screen-application/
[DCP]: https://docs.dwservice.net/docs/site/basic-definitions/copy/
[DA]: https://www.dwservice.net/en/applications.html
[DSEC]: https://www.dwservice.net/en/security.html
[DOV]: https://www.dwservice.net/en/overview.html
[DH]: https://www.dwservice.net/en/home.html
[DDL]: https://www.dwservice.net/en/download.html
[DN]: https://news.dwservice.net/2022/06
[MCMP]: https://learn.microsoft.com/en-us/windows-app/compare-platforms-features
[MIN]: https://learn.microsoft.com/en-us/windows-app/input-keyboard-mouse-touch-pen
[MDS]: https://learn.microsoft.com/en-us/windows-app/display-settings
[MAS]: https://apps.apple.com/us/app/windows-app/id714464092
[MGP]: https://play.google.com/store/apps/details?id=com.microsoft.rdc.androidx
[JI]: https://jumpdesktop.com/remote-desktop-iphone-ipad.html
[JA]: https://jumpdesktop.com/remote-desktop-android.html
[JG]: https://docs.jumpdesktop.com/viewer/session/controls-and-gestures/
[JC]: https://docs.jumpdesktop.com/viewer/session/clipboard/
[JAU]: https://docs.jumpdesktop.com/viewer/session/audio/
[JD]: https://docs.jumpdesktop.com/viewer/session/displays/
[JAS]: https://apps.apple.com/us/app/jump-desktop-rdp-vnc-fluid/id364876095
[JGP]: https://play.google.com/store/apps/details?id=com.p5sys.jump.android
[JH]: https://jumpdesktop.com/
[J2FA]: https://docs.jumpdesktop.com/account/manage-account/#reset-2fa
[RU]: https://help.realvnc.com/hc/en-us/articles/360018541231-How-do-I-use-VNC-Viewer-for-Android-and-iOS-
[RC]: https://help.realvnc.com/hc/en-us/articles/7636620287133
[RF]: https://help.realvnc.com/hc/en-us/articles/360002250477
[RN]: https://help.realvnc.com/hc/en-us/articles/37090410046109
[RAS]: https://apps.apple.com/us/app/vnc-viewer/id352019548
[RGP]: https://play.google.com/store/apps/details?id=com.realvnc.viewer.android
[TVI]: https://www.teamviewer.com/en/global/support/knowledge-base/teamviewer-classic/mobile/ios/interaction-methods-on-ios/
[TVA]: https://www.teamviewer.com/en/global/support/knowledge-base/teamviewer-classic/mobile/android/touch-interactions-vs-mouse-interactions-on-android/
[TVAS]: https://apps.apple.com/us/app/teamviewer-remote-control/id692035811
[TVC]: https://community.teamviewer.com/English/discussion/121567/ipad-controlling-a-pc-with-with-physical-keyboard-ctrl-keys-doesnt-work
[ADA]: https://support.anydesk.com/docs/anydesk-for-android
[ADI]: https://support.anydesk.com/docs/anydesk-for-ios-ipados-tvos
[ADAS]: https://apps.apple.com/us/app/anydesk-remote-desktop/id1176131273
[CA]: https://support.google.com/chrome/answer/1649523?co=GENIE.Platform%3DAndroid
[CI]: https://support.google.com/chrome/answer/1649523?co=GENIE.Platform%3DiOS
[CGP]: https://play.google.com/store/apps/details?id=com.google.chromeremotedesktop
[PW]: https://piunikaweb.com/2025/09/06/chrome-remote-desktop-ios-app-discontinued/
[RDA]: https://rustdesk.com/docs/en/client/android/
[RDM]: https://rustdesk.com/docs/en/manual/mobile/
[RDG]: https://github.com/rustdesk/rustdesk
[RDAS]: https://apps.apple.com/us/app/rustdesk-remote-desktop/id1581225015
[RD2FA]: https://rustdesk.com/docs/en/self-host/rustdesk-server-pro/2fa/
[RDD]: https://rustdesk.com/docs/en/
[BV]: https://www.apkmirror.com/apk/iordan-iordanov-undatech/bvnc-secure-vnc-viewer/bvnc-secure-vnc-viewer-v6-4-5-release/
[AR]: https://apps.apple.com/us/app/id1620745523
[BVAS]: https://apps.apple.com/us/app/bvnc-pro-vnc-screen-sharing/id1506461202
[RDCG]: https://github.com/iiordanov/remote-desktop-clients
[TM]: https://docs.termius.com/terminal/mobile-terminal
[TMB]: https://termius.com/blog/new-touch-terminal-on-ios
[BS]: https://docs.blink.sh/basics/customize

## 3. Gaps to close

**Prerequisite.** Before any of these, run G0/G1 on real phones against a real server.
Every "Built" row above is unverified on devices until then.

Gaps are ordered by value. Effort: S = days, M = 1–2 weeks, L = more. "Guacamole" says
whether the server and protocol allow the feature.

| #   | Gap                                                                                                           | Why                                                                                            | Effort       | Guacamole                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | File browser, upload, download (FIL-1), with the share sheet / Files app                                      | Most peers have it. On a phone it is the main way to move a file to or from the remote.        | M–L          | **Yes.** RDP virtual drive (`enable-drive`) with a "Download" folder; SFTP for SSH, and for VNC/RDP (`enable-sftp`). Upload and download can be enabled separately since 1.2.0; chunked upload since 1.6.0. [GW1] [GW2] [GR120] [GR160] |
| 2   | RDP multi-touch pass-through (PTR-6)                                                                          | Windows touch apps and pinch inside remote apps. Windows App and Jump have it.                 | M            | **Yes, RDP only:** `enable-touch` and the `touch` instruction, since 1.4.0. [GW2] [GR140]                                                                                                                                               |
| 3   | Several sessions with a switcher (MUL-1)                                                                      | The web client does it. Jump does it on iPad.                                                  | M–L          | **Yes:** one tunnel per session. [GW1]                                                                                                                                                                                                  |
| 4   | Credential prompt from the server (`required` instruction)                                                    | Connections with no stored username or password currently fail. The web client shows a prompt. | S            | **Yes, since 1.3.0:** the vendored 1.6.0 library dispatches it as `onrequired`; the client answers on `argv` streams. [GW4] [GR130]                                                                                                     |
| 5   | Audio controls (AUD-1): mute, audio focus, silent switch, background behaviour                                | Playback already happens but cannot be controlled.                                             | S            | **Yes.** RDP audio is on by default; VNC needs `enable-audio` and PulseAudio. [GW2]                                                                                                                                                     |
| 6   | Biometric lock and app-switcher privacy (SRV-6, NFR Security)                                                 | PocketGuac and Jump (iOS) offer an app lock.                                                   | S–M          | – (client only)                                                                                                                                                                                                                         |
| 7   | SSO (SRV-7)                                                                                                   | Needed for SAML/OIDC/CAS deployments. PocketGuac has it.                                       | M            | **Yes:** CAS, OpenID, SAML (1.2.0+), several providers at once since 1.4.0. [GW6] [GR120] [GR140]                                                                                                                                       |
| 8   | iPad / DeX desktop-class input (PTR-5, KEY-6 polish): pointer lock, right click, Cmd→Win mapping, Esc on iPad | Windows App, Jump and bVNC document this well. S5 depends on it.                               | M            | **Yes**, except horizontal wheel (mouse mask has only up/down)                                                                                                                                                                          |
| 9   | Thumbnails and home-screen shortcuts / deep links (CON-4, CON-5)                                              | The web client shows thumbnails; Jump has Android shortcuts.                                   | S–M          | – (client only; thumbnails from the last display frame)                                                                                                                                                                                 |
| 10  | Printing to PDF → share sheet                                                                                 | Cheap once file download exists.                                                               | S (after #1) | **Yes, RDP only:** `enable-printing` sends a PDF stream to the client; needs GhostScript on the guacd host. [GW2]                                                                                                                       |
| 11  | RDP microphone                                                                                                | Calls and dictation. Windows App and AnyDesk have it.                                          | M            | **Yes, RDP only:** `enable-audio-input` (0.9.10+). The client must capture audio and send it (library `AudioRecorder`). [GW2] [GR0910]. SPEC lists it as a v1 non-goal.                                                                 |
| 12  | Wake-on-LAN awareness                                                                                         | Waking a sleeping PC from a phone is a common need.                                            | S            | **Server-side, since 1.2.0:** `wol-send-packet` etc. The app only needs a longer "waking" connect state and timeout. [GW2] [GR120] [GR160]                                                                                              |
| 13  | Self-signed certificate trust (SRV-8)                                                                         | Common on home servers.                                                                        | M            | – (client/native bridge)                                                                                                                                                                                                                |
| 14  | Editable key bar, arrow-swipe gesture, snippets (KEY-7)                                                       | Termius and bVNC show that this is valued.                                                     | S–M          | –                                                                                                                                                                                                                                       |
| 15  | Clipboard panel (CLP-5)                                                                                       | Lets the user check text before sending it.                                                    | S            | –                                                                                                                                                                                                                                       |
| 16  | Sharing-profile links and joining shared sessions (CON-6)                                                     | Help-desk style use.                                                                           | M            | **Yes:** sharing profiles since 0.9.10; join notifications since 1.5.0. [GR0910] [GR150]                                                                                                                                                |
| 17  | External display / Stage Manager output                                                                       | Windows App and Jump use an external monitor with the phone as trackpad.                       | L            | – (client only; one Guacamole display)                                                                                                                                                                                                  |
| 18  | Choose / span remote monitors                                                                                 | Many peers offer it.                                                                           | –            | **Not possible today.** No multi-monitor in any release; GUACAMOLE-288 is open; draft RDP PR #1061 is a work in progress. Revisit when merged. [J288] [PR1061]                                                                          |
| 19  | Image / file clipboard                                                                                        | Windows App (iOS images) and AnyDesk (files) offer it.                                         | –            | **Not possible today.** The protocol's clipboard stream carries a mimetype, but client support for images (GUACAMOLE-55) is unresolved. [GW3] [J55]                                                                                     |
| 20  | Horizontal scroll                                                                                             | Wide spreadsheets and timelines.                                                               | S hack       | **Not in the protocol:** the mouse instruction has wheel up/down only. A Shift+wheel emulation would work in some Windows apps only.                                                                                                    |
| 21  | Session-recording playback                                                                                    | —                                                                                              | —            | Server feature: recording is server-side, with in-browser playback since 1.5.0. Out of scope. [GW2] [GR150]                                                                                                                             |

## 4. Deliberate differences

- **No account, no relay, no broker.** The app talks only to servers the user adds (SPEC
  G4, §7 Privacy). It will not add a cloud address book, sync service or NAT-traversal
  relay. Reachability is the user's network or VPN.
- **No telemetry, ads or crash SDKs.** Several peers' store privacy labels list usage or
  diagnostics data. We collect none. Diagnostics (DIAG-1) stay on the device and are shared
  only when the user chooses to.
- **No direct RDP/VNC/SSH.** guacd does the protocol work (SPEC §4). Peers that speak RDP
  directly can offer smart-card redirection, multi-monitor and camera redirection; we get
  only what guacd exposes.
- **No server administration in v1.** We will not edit connections, users or permissions.
  PocketGuac edits connections; the web client remains the admin tool.
- **No global "ignore TLS errors".** Only per-server trust after showing the fingerprint
  (SRV-8).
- **TOTP seed storage is opt-in and labelled as weakening 2FA** (SRV-9), unlike a silent
  convenience feature.
- **No code, text or assets from closed-source apps.** PocketGuac and the commercial apps
  are feature references only.
- **Open source and free (Apache-2.0)**, with no paid tier or licence key.

## 5. Suggested additions to the spec (proposal only)

These are not yet in `docs/SPEC.md`; the owner decides.

| ID     | Pri | Requirement                                                                                                                                                                                            | Acceptance                                                                                      |
| ------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| SRV-11 | P1  | Handle the `required` instruction: prompt for the requested parameters (username, password, domain) and send them on `argv` streams, with an option to remember them per connection in secure storage. | An RDP connection with no stored credentials connects after the user types them in the prompt.  |
| AUD-2  | P3  | RDP microphone input when the connection has `enable-audio-input`; permission requested on first use; mic indicator and toggle in the toolbar.                                                         | Speech recorded in a remote Windows app is audible on playback.                                 |
| FIL-2  | P2  | RDP print jobs (`enable-printing`) arrive as a PDF and open in the OS share sheet / print dialog.                                                                                                      | Printing a test page from Notepad offers the PDF on the phone.                                  |
| FIL-3  | P2  | Share-sheet / Files "Open in" target: send a file from another app to the active session's drive or SFTP root.                                                                                         | Sharing a photo from the gallery uploads it to the RDP drive.                                   |
| CON-7  | P2  | Show a "waking the computer" state with a longer connect timeout for connections that use Wake-on-LAN.                                                                                                 | A sleeping PC with WoL configured connects without a timeout error.                             |
| PTR-8  | P3  | Optional horizontal scroll emulation (Shift + wheel) for two-finger horizontal drags, off by default.                                                                                                  | Horizontal drag scrolls a wide Excel sheet when enabled.                                        |
| KEY-8  | P2  | Swipe on the key bar (or hold Space and slide) to send arrow keys.                                                                                                                                     | Caret moves by one character per step in Notepad.                                               |
| DSP-10 | P3  | External display: render the session on a connected monitor while the phone becomes a trackpad and key bar.                                                                                            | With an iPad on a USB-C monitor, the desktop fills the monitor and the iPad acts as a trackpad. |
| MUL-2  | P3  | Join or share a session through Guacamole sharing profiles (paste or open a share link).                                                                                                               | Opening a share link from the web client joins the session in the app.                          |
| A11Y-2 | P2  | VoiceOver/TalkBack pass of every screen recorded in a device checklist before each release.                                                                                                            | Checklist completed with no blocking issue.                                                     |
