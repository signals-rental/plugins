# Vendored schemas

## signals-plugin-manifest.v1.json

The Signals Rental Framework's schema for a plugin's `signals.yaml` manifest. It is not
maintained here — this is a pinned copy that acts as a **fallback and cache**.

- Canonical identifier (authoritative): `https://signals.rent/schemas/signals-plugin-manifest.v1.json`
- Published at: `https://docs.signals.rent/schemas/signals-plugin-manifest.v1.json`

Normal builds fetch the published schema so plugin manifests are checked against the rules
in force today. A fetched document is only trusted when it parses as JSON, carries one of
the two identifiers above, and compiles. If any of that fails — including a build with no
network — the tooling falls back to this copy and says so on stderr, so a build is never
blocked by the schema being unreachable.

The weekly publish workflow refreshes this file automatically: it fetches the live schema,
trust-checks it, and commits the result when the bytes differ. A hand-written update pull
request is no longer required, though one is still perfectly valid — replace this file with
a fresh copy of the published schema, on its own, with no other changes.
