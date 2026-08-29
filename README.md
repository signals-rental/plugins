# Signals Plugin Registry

The plugin registry for the [Signals Rental Framework](https://github.com/signals-rental/framework-core). The Signals application reads it to discover and install plugins.

This repository holds pointers and curation metadata only. Plugin code lives in each plugin's own repository.

## Published files

Served from `https://plugins.signals.rent/`:

| File | Purpose |
| --- | --- |
| `index.json` | The aggregated registry index |
| `schema.json` | Registry entry schema |
| `index.schema.json` | Registry index schema |
| `schemas/vendor/signals-plugin-manifest.v1.json` | Vendored copy of the framework's `signals.yaml` manifest schema |

`index.json` is also committed at the root of this repository.

Until that domain is live, the same files are served at `https://signals-rental.github.io/plugins/`. The schemas carry stable canonical `$id` values on `docs.signals.rent` regardless of where they are served from:

- `https://docs.signals.rent/schemas/signals-plugin-registry-entry.v1.json`
- `https://docs.signals.rent/schemas/signals-plugin-registry-index.v1.json`

## Two schemas, two jobs

These are separate and easily confused:

- **`schema.json` — the registry entry schema.** Defined in this repository. It governs the JSON files under `plugins/`: where a plugin's code lives, who wrote it, its licence, its curation tier. It has no version or capability fields.
- **`signals-plugin-manifest.v1.json` — the framework's manifest schema.** Defined by the framework, published at `https://docs.signals.rent/`, and pinned here under `schemas/vendor/` as a fallback. It governs the `signals.yaml` inside each plugin repository: display name, version, framework compatibility, permissions, network hosts and everything else the plugin declares.

A plugin must satisfy both: a valid entry here, and a valid manifest in its own repository.

## Entries

One file per plugin at `plugins/<vendor>/<package>.json`. The path segments must equal the entry's `package` field, so `acme/booking-reminders` lives at `plugins/acme/booking-reminders.json`.

Entries are hand-maintained pointers. They deliberately carry no version data. See [`example-entry.json`](example-entry.json) for a template and [CONTRIBUTING.md](CONTRIBUTING.md) for the field reference.

## How the index is built

Registry entries store a git URL; everything about a release is read from the plugin itself.

For each entry, CI:

1. Lists the source repository's tags and picks the highest strict SemVer one (a leading `v` is accepted). Stable releases are preferred over prereleases; a prerelease is only used when the repository has no stable tag.
2. Shallow-clones at that tag and reads `signals.yaml`.
3. Validates the manifest against the framework's manifest schema, fetched from `https://docs.signals.rent/`, with the pinned copy in `schemas/vendor/` as the fallback when that is unreachable.
4. Merges `name`, `version`, `signals_version`, `icon`, `permissions` and `network` into the entry as a generated `latest` block, alongside the tag it came from.

If a repository cannot be reached, or its manifest is invalid, or its `package` disagrees with the entry, the build does not fail. The entry keeps its previous `latest` and is marked `"enrichment": "stale"`; if there is nothing to carry forward it is marked `"enrichment": "failed"` and has no `latest`.

Pull requests run the same fetch as a gate, where failure does block the merge.

The index is rebuilt on every push to `main` and weekly, so new plugin releases appear without a registry commit.

## Tiers

- **verified** — Signals reviewed the plugin. Verification is anchored to one release: the entry records `verification.reviewed_version` and `verification.reviewed_at`. A later release published by the author is not automatically verified, so `latest.version` may be ahead of `reviewed_version`. Consumers that require a reviewed build should compare the two.
- **community** — listed but not reviewed. Self-hosted only, installed at the operator's own risk.

## Status

`status` is `active` when absent.

- **active** — normal listing.
- **deprecated** — still installable, no longer recommended. `status_reason` explains why.
- **yanked** — withdrawn. Yanked entries stay in the index so consumers holding a cached copy still see the status change; the web UI hides them by default.

## Consuming the index

- Fetch `https://plugins.signals.rent/index.json`.
- Check `index_schema_version` and refuse a version you do not understand.
- Use conditional requests (`If-None-Match` with the returned `ETag`) and poll about once a day.
- Install from `source.url` at `latest.tag`.
- Treat an entry with `enrichment: "stale"` as usable but possibly behind, and one with `enrichment: "failed"` as having no installable release.

## Licence

The tooling and metadata in this repository are MIT licensed. Each listed plugin retains the licence declared in its own repository. Listing a plugin here does not change its licence and implies no endorsement.
