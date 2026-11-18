# vendor

Third-party code vendored verbatim, with its own licence files.

- `guacamole-common-js/`: the official Apache Guacamole JavaScript client library,
  vendored from `apache/guacamole-client` at tag `1.6.0` (task T0.2). Not linted or
  formatted by this project's tooling; the upstream `modules/` are excluded from tests, and
  `vendor.test.ts` smoke-tests the generated bundle.
