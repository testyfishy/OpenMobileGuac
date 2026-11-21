# Contributing to OpenMobileGuac

Thanks for your interest. Bug reports, testing on real devices, translations and code are
all welcome. The project is in early development, so expect things to move.

## Ways to help

- **Report a bug or ask for a feature:** open an issue at
  <https://github.com/testyfishy/OpenMobileGuac/issues>. Say which device, OS version, app
  version and Guacamole server version you use. Leave out server addresses, user names and
  anything personal.
- **Test on a device:** the checklists in [docs/checklists/](docs/checklists/README.md) list
  what still needs a real phone. Results in an issue are very useful.
- **Translate:** see [docs/TRANSLATING.md](docs/TRANSLATING.md).
- **Security problems:** do not open a public issue; see [SECURITY.md](SECURITY.md).
- **Code:** read on.

## Licence of contributions

OpenMobileGuac is licensed under GPL-3.0-or-later with an additional permission for app
stores ([LICENSE](LICENSE), [LICENSE-APP-STORE-EXCEPTION](LICENSE-APP-STORE-EXCEPTION)).

By sending a contribution you agree that it is licensed under the same terms: GPL-3.0-or-later
**including that additional permission** (inbound = outbound). This lets the maintainer, and
anyone who forks the project and publishes their source, keep shipping the app through the
App Store and Google Play.

There is no contributor licence agreement and no Developer Certificate of Origin sign-off.
Only send work you have the right to contribute.

Commits published before the licence change were released under Apache-2.0 and remain
available under it. The vendored `guacamole-common-js` in `app/src/vendor` keeps its own
Apache-2.0 licence. It is copied unmodified from `apache/guacamole-client` 1.6.0 (see its
README), so fixes to the library itself belong upstream.

## Before you start

- Read [docs/SPEC.md](docs/SPEC.md) and [docs/PLAN.md](docs/PLAN.md). Work is organised
  as tasks in the plan; open an issue before starting anything large.
- Building and running: [docs/BUILDING.md](docs/BUILDING.md).

## Development setup

```sh
cd app
npm ci
npm run dev                  # open the printed URL; the Demo server works with no setup
```

Optional, to reach your own test server from the browser:

```sh
cp .env.example .env.local   # git-ignored; point at a test Guacamole server
```

## Checks

`npm run check` must pass in `app/` before a change is merged. It runs typecheck, lint,
format check, unit tests and the production build. CI runs the same command on every pull
request. Use `npm run format` to apply Prettier.

## Rules

- Do not write Guacamole REST paths, tunnel parameters, or library names from memory;
  read them from the vendored library or from `apache/guacamole-client` at tag `1.6.0`.
- `PointerModel`, `KeyModel`, `Viewport`, and the gesture recogniser stay free of DOM and
  Capacitor imports and ship with unit tests.
- All network access goes through `HttpClient` / `SessionTransport`. The app must not contact
  any host other than the user's servers: no analytics, crash reporting, ads or remote
  configuration.
- New dependencies must be under a licence compatible with GPL-3.0-or-later and with the
  app-store permission, in practice a permissive licence (for example MIT, BSD, ISC,
  Apache-2.0). Record runtime dependencies in [NOTICE](NOTICE).
- Do not copy code or assets from closed-source or unlicensed clients.
- User-facing text goes in the string tables (`app/src/ui/i18n/`,
  `app/src/ui/session/sessionStrings.ts`), not in components.

## Privacy and secrets

This repository is public.

- Never commit credentials. Local server details belong in `app/.env.local`, which is
  git-ignored.
- No real hostnames, IP addresses, or usernames in code, docs, or test fixtures. Use
  `example.com` names and `192.0.2.x` addresses in examples.
- Screenshots and recorded session streams may only come from a clean, throwaway remote
  desktop with nothing personal on screen.
- Check what name and email your commits carry before you push. GitHub's no-reply address
  works if you do not want to publish your email.
