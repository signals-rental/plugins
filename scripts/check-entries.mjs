#!/usr/bin/env node
/**
 * Deep check of registry entries — the pull request gate.
 *
 * Structural validation (scripts/validate.mjs) proves an entry is well formed.
 * This proves the plugin behind it is real and installable:
 *
 *   - the source repository is reachable over the network
 *   - it publishes at least one strict SemVer tag
 *   - signals.yaml exists at the highest such tag
 *   - that manifest validates against the vendored framework manifest schema
 *   - the manifest's `package` matches the entry's `package` and its file path
 *
 * Usage:
 *   node scripts/check-entries.mjs                 check every entry
 *   node scripts/check-entries.mjs <file> [...]    check only these entry files
 *
 * Paths that are not registry entries are ignored, so the caller can pass a
 * raw list of files changed in a pull request. Any failure exits non-zero.
 */

import path from 'node:path';

import {
    PLUGINS_DIR,
    REPO_ROOT,
    loadManifestSchema,
    loadSchemas,
    offlineRequested,
    packageFromPath,
    rel,
    reportProblems,
    validateRegistry,
} from './lib/registry.mjs';
import { DEFAULT_TIMEOUT_MS, enrichEntry, localSourcesAllowed } from './lib/enrich.mjs';

function selectedPaths(argv) {
    const files = argv.filter((argument) => !argument.startsWith('--'));

    return files
        .map((file) => path.resolve(REPO_ROOT, file))
        .filter((file) => {
            const relative = path.relative(PLUGINS_DIR, file);
            return (
                relative !== '' &&
                !relative.startsWith('..') &&
                !path.isAbsolute(relative) &&
                file.endsWith('.json')
            );
        });
}

async function main() {
    const argv = process.argv.slice(2);
    const requested = selectedPaths(argv);
    const checkAll = requested.length === 0;
    const allowLocalSource = localSourcesAllowed(argv);

    const schemas = await loadSchemas({ allowLocalSource });
    const { entries, problems } = await validateRegistry(schemas);

    const wanted = new Set(requested);
    const structuralProblems = checkAll
        ? problems
        : problems.filter((problem) => wanted.has(problem.file));

    if (structuralProblems.length > 0) {
        console.error('Entries failed structural validation:');
        reportProblems(structuralProblems);
        console.error('\nDeep check failed.');
        process.exit(1);
    }

    const targets = checkAll ? entries : entries.filter((item) => wanted.has(item.file));

    if (targets.length === 0) {
        console.log('No registry entries to deep check.');
        return;
    }

    const manifestSchema = await loadManifestSchema({ offline: offlineRequested(argv) });
    if (manifestSchema.source === 'live') {
        console.log(`Manifest schema: using the live copy from ${manifestSchema.url}.`);
    }

    console.log(
        `Deep checking ${targets.length} entr${targets.length === 1 ? 'y' : 'ies'} against ${targets.length === 1 ? 'its' : 'their'} source repositories.`,
    );

    const failures = [];

    for (const { file, entry } of targets) {
        process.stdout.write(`\n  ${entry.package} (${rel(file)})\n`);
        process.stdout.write(`    source: ${entry.source.url}\n`);

        const result = await enrichEntry(entry, {
            validateManifest: manifestSchema.validate,
            timeoutMs: DEFAULT_TIMEOUT_MS,
            allowLocalSource,
        });

        for (const warning of result.warnings) {
            console.warn(`    warning: ${warning}`);
        }

        if (!result.ok) {
            console.error(`    FAILED: ${result.reason}`);
            failures.push({ package: entry.package, reason: result.reason });
            continue;
        }

        const pathPackage = packageFromPath(file);
        if (pathPackage !== entry.package) {
            const reason = `file path implies "${pathPackage}" but the entry declares "${entry.package}"`;
            console.error(`    FAILED: ${reason}`);
            failures.push({ package: entry.package, reason });
            continue;
        }

        const { latest } = result;
        console.log(
            `    OK: ${latest.name} ${latest.version} at tag ${latest.tag}, requires Signals ${latest.signals_version}`,
        );
        if (latest.network) {
            console.log(`    network: ${latest.network.join(', ')}`);
        }
        if (latest.permissions) {
            console.log(`    permissions: ${latest.permissions.join(', ')}`);
        }
    }

    if (failures.length > 0) {
        console.error(`\n${failures.length} entr${failures.length === 1 ? 'y' : 'ies'} failed the deep check:`);
        for (const failure of failures) {
            console.error(`  - ${failure.package}: ${failure.reason}`);
        }
        process.exit(1);
    }

    console.log('\nDeep check passed.');
}

await main();
