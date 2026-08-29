#!/usr/bin/env node
/**
 * Structural validation of the registry. No network access.
 *
 *   - both registry schemas compile
 *   - every plugins/**\/*.json is valid JSON and valid against schema.json
 *   - each entry sits at plugins/<vendor>/<package>.json matching its `package`
 *   - package names are unique
 *   - example-entry.json still validates against schema.json
 *
 * Exits non-zero on any failure.
 */

import {
    EXAMPLE_ENTRY_PATH,
    loadSchemas,
    readJson,
    rel,
    reportProblems,
    formatErrors,
    validateRegistry,
} from './lib/registry.mjs';

async function main() {
    let schemas;

    try {
        schemas = await loadSchemas();
    } catch (error) {
        console.error(`Schema error: ${error.message}`);
        process.exit(1);
    }

    console.log('Schemas compiled: schema.json, index.schema.json, vendored manifest schema.');

    const { files, entries, problems } = await validateRegistry(schemas);

    if (problems.length > 0) {
        console.error(`\n${problems.length} invalid registry entr${problems.length === 1 ? 'y' : 'ies'}:`);
        reportProblems(problems);
    }

    let exampleFailed = false;
    try {
        const example = await readJson(EXAMPLE_ENTRY_PATH);
        if (!schemas.validateEntry(example)) {
            exampleFailed = true;
            console.error(`\n  ${rel(EXAMPLE_ENTRY_PATH)}`);
            for (const message of formatErrors(schemas.validateEntry.errors)) {
                console.error(`    - ${message}`);
            }
        }
    } catch (error) {
        exampleFailed = true;
        console.error(`\n  ${rel(EXAMPLE_ENTRY_PATH)}\n    - ${error.message}`);
    }

    console.log(
        `Checked ${files.length} entr${files.length === 1 ? 'y' : 'ies'}: ${entries.length} valid, ${problems.length} invalid.`,
    );

    if (problems.length > 0 || exampleFailed) {
        console.error('\nValidation failed.');
        process.exit(1);
    }

    console.log('Validation passed.');
}

await main();
