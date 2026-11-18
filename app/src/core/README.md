# core

Non-UI code: Guacamole REST API client, session transport, secure storage, settings,
profiles, and typed models. No React or DOM imports. All network access goes through
`HttpClient` and `SessionTransport` (see docs/SPEC.md §8.2).
