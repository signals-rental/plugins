#!/usr/bin/env node
/**
 * Build index.json from the registry entries.
 *
 * Entries are pointers; every version and capability field published in the
 * index is read from the plugin's own repository at build time. For each
 * entry the build resolves the highest strict SemVer git tag, reads
 * signals.yaml there, validates it against the vendored framework manifest
 * schema and merges the result in as `latest`.
 *
 * A repository that cannot be reached never fails the build: its previous
 * `latest` is carried forward and marked "stale", or the entry is marked
 * "failed" when there is nothing to carry forward.
 *
 * Flags:
 *   --offline               skip enrichment entirely (stale/failed fallback)
 *   --out <path>            write somewhere other than ./index.json
 *   --allow-local-source    permit non-https sources (test fixtures only)
 */

import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import {
    INDEX_PATH,
    REPO_ROOT,
    formatErrors,
    loadManifestSchema,
    loadSchemas,
    readJson,
    rel,
    reportProblems,
    validateRegistry,
} from './lib/registry.mjs';
import { DEFAULT_TIMEOUT_MS, enrichEntry, localSourcesAllowed } from './lib/enrich.mjs';

function parseArgs(argv) {
    const outFlag = argv.indexOf('--out');
    return {
        offline: argv.includes('--offline'),
        allowLocalSource: localSourcesAllowed(argv),
        outPath:
            outFlag !== -1 && argv[outFlag + 1]
                ? path.resolve(REPO_ROOT, argv[outFlag + 1])
                : INDEX_PATH,
    };
}

/** Previous `latest` blocks, keyed by package, for the stale fallback. */
async function loadPreviousLatest() {
    if (!existsSync(INDEX_PATH)) {
        return new Map();
    }

    try {
        const previous = await readJson(INDEX_PATH);
        const map = new Map();
        for (const plugin of previous.plugins ?? []) {
            if (plugin && typeof plugin.package === 'string' && plugin.latest) {
                map.set(plugin.package, plugin.latest);
            }
        }
        return map;
    } catch (error) {
        console.warn(`Warning: could not read the previous index (${error.message}); no stale fallback available.`);
        return new Map();
    }
}

function toIndexItem(entry) {
    const item = {
        package: entry.package,
        source: { type: entry.source.type, url: entry.source.url },
        description: entry.description,
        tier: entry.tier,
        status: entry.status ?? 'active',
    };

    if (entry.status_reason !== undefined) item.status_reason = entry.status_reason;
    if (entry.license !== undefined) item.license = entry.license;
    if (entry.authors !== undefined) item.authors = entry.authors;
    if (entry.homepage !== undefined) item.homepage = entry.homepage;
    if (entry.keywords !== undefined) item.keywords = entry.keywords;
    if (entry.verification !== undefined) item.verification = entry.verification;
    if (entry.added_at !== undefined) item.added_at = entry.added_at;

    return item;
}

async function main() {
    const { offline, allowLocalSource, outPath } = parseArgs(process.argv.slice(2));

    const schemas = await loadSchemas({ allowLocalSource });
    const { entries, problems } = await validateRegistry(schemas);

    if (problems.length > 0) {
        console.error(`${problems.length} invalid registry entr${problems.length === 1 ? 'y' : 'ies'}:`);
        reportProblems(problems);
        console.error('\nRefusing to build an index from an invalid registry.');
        process.exit(1);
    }

    const previousLatest = await loadPreviousLatest();

    if (offline) {
        console.log('Offline mode: skipping repository enrichment.');
    }

    // Offline builds never reach for the network, so they use the pinned copy.
    const manifestSchema = await loadManifestSchema({ offline });
    if (manifestSchema.source === 'live') {
        console.log(`Manifest schema: using the live copy from ${manifestSchema.url}.`);
    }

    const plugins = [];
    const counters = { enriched: 0, stale: 0, failed: 0 };

    for (const { entry } of entries) {
        const item = toIndexItem(entry);

        const result = offline
            ? { ok: false, reason: 'offline build', warnings: [] }
            : await enrichEntry(entry, {
                  validateManifest: manifestSchema.validate,
                  timeoutMs: DEFAULT_TIMEOUT_MS,
                  allowLocalSource,
              });

        for (const warning of result.warnings) {
            console.warn(`Warning: ${entry.package}: ${warning}`);
        }

        if (result.ok) {
            item.latest = result.latest;
            counters.enriched += 1;
            console.log(`  ${entry.package}: ${result.latest.version} (tag ${result.latest.tag})`);
        } else {
            const carried = previousLatest.get(entry.package);
            if (carried) {
                item.latest = carried;
                item.enrichment = 'stale';
                counters.stale += 1;
                if (!offline) {
                    console.warn(
                        `Warning: ${entry.package}: enrichment failed (${result.reason}); keeping version ${carried.version} from the previous index.`,
                    );
                } else {
                    console.log(`  ${entry.package}: stale, keeping ${carried.version}`);
                }
            } else {
                item.enrichment = 'failed';
                counters.failed += 1;
                if (!offline) {
                    console.warn(`Warning: ${entry.package}: enrichment failed (${result.reason}); no previous data to carry forward.`);
                } else {
                    console.log(`  ${entry.package}: no data`);
                }
            }
        }

        plugins.push(item);
    }

    plugins.sort((a, b) => (a.package < b.package ? -1 : a.package > b.package ? 1 : 0));

    const index = {
        index_schema_version: 1,
        generated_at: new Date().toISOString(),
        count: plugins.length,
        plugins,
    };

    if (!schemas.validateIndex(index)) {
        console.error('The generated index does not satisfy index.schema.json:');
        for (const message of formatErrors(schemas.validateIndex.errors)) {
            console.error(`  - ${message}`);
        }
        process.exit(1);
    }

    await writeFile(outPath, `${JSON.stringify(index, null, 4)}\n`, 'utf8');

    console.log(
        `Wrote ${rel(outPath)}: ${plugins.length} plugin(s) — ${counters.enriched} enriched, ${counters.stale} stale, ${counters.failed} failed.`,
    );
}

await main();
