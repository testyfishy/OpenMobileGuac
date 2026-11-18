# guacamole-common-js (vendored)

The official Apache Guacamole JavaScript client library, copied unmodified from
[`apache/guacamole-client`](https://github.com/apache/guacamole-client).

| | |
|---|---|
| Tag | `1.6.0` |
| Commit | `0537c89cd783681b986ff8f8c4e0b97ec6873371` |
| Upstream path | `guacamole-common-js/src/main/webapp/` |

Contents:

- `modules/*.js`: upstream `guacamole-common-js/src/main/webapp/modules/*.js`, byte-for-byte.
- `common/license.js`: upstream `guacamole-common-js/src/main/webapp/common/license.js` (the header upstream
  puts at the top of its concatenated `all.js`).
- `LICENSE`, `NOTICE`: the upstream repository's root licence and notice files.
- `index.js`: **generated**. The modules concatenated in upstream's build order and wrapped
  as an ES module whose default export is the `Guacamole` namespace. Do not edit by hand.
- `index.d.ts`: hand-written TypeScript declarations for the parts this app uses, derived
  from the module sources above. Review them when updating to a new tag.
- `vendor.test.ts`: a smoke test for the bundle.

To update, from `/app`:

```sh
node scripts/update-guac.mjs <tag>      # fetch a tag and regenerate index.js and this README
node scripts/update-guac.mjs --generate # regenerate index.js from the files on disk
```

This directory is excluded from ESLint and Prettier. Usage: `import Guacamole from
'../vendor/guacamole-common-js'` (adjust the relative path).
