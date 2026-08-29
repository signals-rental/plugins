#!/usr/bin/env node
/**
 * Refresh the pinned copy of the framework manifest schema.
 *
 * Fetches the live schema, trust-checks it (correct $id, compiles cleanly) and
 * rewrites schemas/vendor/signals-plugin-manifest.v1.json only when the bytes
 * differ. Run by the publish workflow so the fallback copy tracks upstream
 * without a hand-written pull request.
 *
 * Always exits 0: a failed refresh is not a failed build, it just means the
 * build carries on against the copy already in the repository.
 */

import { readFile, writeFile } from 'node:fs/promises';

import {
    MANIFEST_SCHEMA_PATH,
    MANIFEST_SCHEMA_URL,
    fetchManifestSchema,
    rel,
} from './lib/registry.mjs';

async function main() {
    let fetched;

    try {
        fetched = await fetchManifestSchema();
    } catch (error) {
        console.log(`Manifest schema unchanged: could not refresh (${error.message}).`);
        return;
    }

    const current = await readFile(MANIFEST_SCHEMA_PATH, 'utf8');

    if (current === fetched.text) {
        console.log(`Manifest schema unchanged: ${rel(MANIFEST_SCHEMA_PATH)} matches ${MANIFEST_SCHEMA_URL}.`);
        return;
    }

    await writeFile(MANIFEST_SCHEMA_PATH, fetched.text, 'utf8');
    console.log(`Manifest schema updated: wrote ${rel(MANIFEST_SCHEMA_PATH)} from ${MANIFEST_SCHEMA_URL}.`);
}

await main();
