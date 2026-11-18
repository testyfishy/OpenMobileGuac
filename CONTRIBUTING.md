# Contributing to OpenMobileGuac

Thanks for your interest. The project is in early development, so expect things to move.

## Before you start

- Read [docs/SPEC.md](docs/SPEC.md) and [docs/PLAN.md](docs/PLAN.md). Work is organised
  as tasks in the plan; open an issue before starting anything large.
- By contributing, you agree that your contribution is licensed under the
  [Apache License 2.0](LICENSE).

## Development setup

```sh
cd app
npm install
cp .env.example .env.local   # point at your own test Guacamole server
npm run dev
```

## Rules

- `npm run check` (typecheck, lint, format check, unit tests, build) must pass in `app/`
  before a change is merged. Use `npm run format` to apply Prettier.
- Do not write Guacamole REST paths, tunnel parameters, or library names from memory;
  read them from the vendored library or from `apache/guacamole-client` at tag `1.6.0`.
- `PointerModel`, `KeyModel`, `Viewport`, and the gesture recogniser stay free of DOM and
  Capacitor imports and ship with unit tests.
- All network access goes through `HttpClient` / `SessionTransport`.
- New dependencies must be under a licence compatible with Apache-2.0 (for example MIT,
  BSD, ISC, Apache-2.0). Record runtime dependencies in [NOTICE](NOTICE).
- Do not copy code or assets from closed-source or unlicensed clients.

## Privacy and secrets

This repository is public.

- Never commit credentials. Local server details belong in `app/.env.local`, which is
  git-ignored.
- No real hostnames, IP addresses, or usernames in code, docs, or test fixtures.
- Screenshots and recorded session streams may only come from a clean, throwaway remote
  desktop with nothing personal on screen.
