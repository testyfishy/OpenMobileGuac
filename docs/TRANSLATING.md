# Translating OpenMobileGuac

The app chrome (everything outside the remote-desktop screen) reads every user-facing string
from one table per language. Translations are welcome.

## Where the strings are

- `app/src/ui/i18n/en.ts` — English, the reference. Its shape defines the type `Strings`.
- `app/src/ui/i18n/es.ts` — Spanish, an example of a complete translation.
- `app/src/ui/i18n/locale.ts` — the list of languages (`LOCALES`) and their own names.
- `app/src/ui/strings.ts` — picks the active table. Code uses `strings.section.key`.

The language follows the device unless the user picks one in Settings › Appearance › Language.

## Adding a language

1. Copy `es.ts` to `<code>.ts` (for example `fr.ts`), rename the export (`export const fr: Strings`)
   and translate every value. Keep the keys.
2. Add the code to `LOCALES` and its own name to `LOCALE_NAMES` in `locale.ts`.
3. Register the table in `TABLES` in `strings.ts`.
4. Run `npm run check` in `app/`. The type check fails if a key is missing or extra, and
   `locale.test.ts` can be extended to cover the new table the way it covers Spanish.

## Rules

- **Functions** take the variable parts (`(name: string) => \`Connect to ${name}\``). Reorder the
  pieces freely; do not build sentences by concatenation in components.
- **Plurals** use the small `plural(n, one, other)` helper at the top of each file. If your
  language needs more forms, write the logic inside your own function.
- **Do not translate** product and protocol names: OpenMobileGuac, Apache Guacamole, RDP, VNC,
  SSH, Telnet, Kubernetes, Tailscale, Face ID, `otpauth://`, `openmobileguac://`.
- **Security text** (two-factor key warning, plain-http warning, backup passphrase hints)
  must keep its full meaning. Prefer a longer, clear sentence to a short, vague one.
- Keep the tone short and direct, addressing the user informally where the language allows.
- The session screen (toolbar, key bar, in-session menus) has its own English strings under
  `app/src/ui/session/` and is not yet part of the table.
