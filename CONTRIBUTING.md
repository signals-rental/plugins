# Contributing

## Before you submit

Your plugin repository must already be publishable:

- It is public and clonable over HTTPS without credentials.
- It has at least one strict SemVer git tag (`1.4.0` or `v1.4.0`).
- `signals.yaml` sits at the repository root of that tag and validates against the framework's [manifest schema](schemas/vendor/signals-plugin-manifest.v1.json).
- The manifest's `package` matches the package name you are registering.

## Submitting

1. Fork this repository.
2. Add one file at `plugins/<vendor>/<package>.json`. The path segments must equal the entry's `package` field: `acme/booking-reminders` goes in `plugins/acme/booking-reminders.json`.
3. Copy [`example-entry.json`](example-entry.json) as a starting point and edit it.
4. Open a pull request containing only that file.

New plugins are listed as `community`. Do not set `tier` to `verified` or add a `verification` block yourself; the schema rejects it.

## Entry fields

| Field | Required | Notes |
| --- | --- | --- |
| `package` | yes | Composer name in `vendor/name` form. Must match the file path and the plugin's `signals.yaml`. |
| `source.type` | yes | `git` — the only supported install source. |
| `source.url` | yes | Public HTTPS clone URL. SSH and `git://` URLs are rejected. |
| `description` | yes | One sentence, up to 500 characters. Shown in listings. The manifest has no description field, so this is the only source of it. |
| `tier` | yes | `community` for new submissions. |
| `license` | no | SPDX identifier, for example `MIT` or `Apache-2.0`. |
| `authors` | no | Array of `{ name, email?, url? }`. `name` is required on each. |
| `homepage` | no | HTTPS documentation or product page. |
| `keywords` | no | Up to 10 kebab-case tags used for filtering. |
| `status` | no | `active` (default), `deprecated` or `yanked`. |
| `status_reason` | no | Short explanation shown with a deprecated or yanked badge. |
| `verification` | no | Set by Signals only. Required on verified entries, rejected on community ones. |
| `added_at` | no | `YYYY-MM-DD`. |

Do not add version, compatibility, permission or network fields. They are read from your `signals.yaml` at build time and would be overwritten.

## What the pull request gate checks

Every check must pass before an entry can be merged.

Across the whole registry:

- Every entry file is valid JSON and valid against `schema.json`.
- Every entry sits at `plugins/<vendor>/<package>.json` matching its `package`.
- No two entries declare the same `package`.

For each entry your pull request adds or changes, against the real repository:

- The source repository is reachable.
- It publishes at least one strict SemVer tag.
- A shallow clone at the highest such tag contains `signals.yaml`.
- That manifest validates against the framework's manifest schema, fetched from `https://docs.signals.rent/` (the pinned copy in `schemas/vendor/` is used if the fetch fails).
- The manifest's `package` matches both the entry's `package` and the file path.

Run the same checks locally:

```
npm ci
npm run validate
node scripts/check-entries.mjs plugins/<vendor>/<package>.json
```

## Verified tier

Verification is granted by Signals, not requested in an entry. Every plugin starts as `community`.

Signals reviews a specific tagged release. When it passes, we open a pull request setting `tier` to `verified` and adding:

```json
"verification": {
    "reviewed_version": "1.4.0",
    "reviewed_at": "2026-08-01"
}
```

Verification stays pinned to that version. Later releases you publish appear in the index as `latest` but are not automatically verified — a new review is needed to move `reviewed_version` forward.

## Updating an entry

Open a pull request against the entry file.

Version changes need no pull request at all: the index is rebuilt from your repository's highest SemVer tag on a schedule, so a new tagged release appears on its own.

Use pull requests for:

- Corrections to the description, keywords, licence, authors or homepage.
- A moved repository: change `source.url`. Keep the old URL working until the change merges.
- Deprecation: set `"status": "deprecated"` with a `status_reason`.
- Withdrawal: set `"status": "yanked"` with a `status_reason`. Yanked entries stay in the index so operators with a cached copy still see the change.

Renaming a package means a new entry file and a yank of the old one, in the same pull request.
