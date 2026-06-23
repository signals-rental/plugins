# Signals Plugin Registry
 
The plugin registry for the [Signals Rental Framework](https://github.com/signals-rental/framework) — a curated index of verified and community plugins. The Signals application reads this registry to power plugin discovery and installation.
 
This repository holds **pointers and curation metadata only**. Plugin code lives in each plugin's own repository.
 
## How it works
 
Each plugin is a single JSON file in `plugins/`. On every change, CI validates entries against `schema.json` and publishes an aggregated `index.json` that the framework fetches.
 
- Published index: `https://signals-rental.github.io/plugins/index.json`
- Entry schema: `https://signals-rental.github.io/plugins/schema.json`
## Submitting a plugin
 
Open a pull request adding one file at `plugins/<vendor>--<package>.json`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the format, and [`example-entry.json`](example-entry.json) for a template to copy.
 
Listing a plugin here does not change its licence and implies no endorsement.
 
## Tiers
 
- **verified** — reviewed by Signals; eligible for Signals Cloud.
- **community** — listed but not reviewed; self-hosted only, installed at the operator's own risk.
## Licence
 
Each listed plugin retains the licence declared in its own repository.
