/**
 * Shared registry helpers: paths, schema loading, entry discovery and
 * structural validation. Used by validate.mjs, check-entries.mjs and
 * build-index.mjs so the rules live in exactly one place.
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const here = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(here, '..', '..');
export const PLUGINS_DIR = path.join(REPO_ROOT, 'plugins');
export const ENTRY_SCHEMA_PATH = path.join(REPO_ROOT, 'schema.json');
export const INDEX_SCHEMA_PATH = path.join(REPO_ROOT, 'index.schema.json');
export const MANIFEST_SCHEMA_PATH = path.join(
    REPO_ROOT,
    'schemas',
    'vendor',
    'signals-plugin-manifest.v1.json',
);
export const INDEX_PATH = path.join(REPO_ROOT, 'index.json');
export const EXAMPLE_ENTRY_PATH = path.join(REPO_ROOT, 'example-entry.json');

/** Where the framework publishes the live signals.yaml manifest schema. */
export const MANIFEST_SCHEMA_URL =
    'https://docs.signals.rent/schemas/signals-plugin-manifest.v1.json';

/**
 * A fetched manifest schema is only trusted when it identifies itself as the
 * framework's schema: either by its canonical $id or by the URL it was served
 * from. Anything else is treated as a wrong document, not a schema update.
 */
export const MANIFEST_SCHEMA_IDS = [
    'https://signals.rent/schemas/signals-plugin-manifest.v1.json',
    MANIFEST_SCHEMA_URL,
];

export const MANIFEST_FETCH_TIMEOUT_MS = 10_000;

/** Relative path for display, always with forward slashes. */
export function rel(absolutePath) {
    return path.relative(REPO_ROOT, absolutePath).split(path.sep).join('/');
}

export function createAjv() {
    const ajv = new Ajv2020({
        allErrors: true,
        strict: false,
        allowUnionTypes: true,
    });
    addFormats(ajv);
    return ajv;
}

export async function readJson(file) {
    const raw = await readFile(file, 'utf8');
    try {
        return JSON.parse(raw);
    } catch (error) {
        throw new Error(`invalid JSON: ${error.message}`);
    }
}

export async function loadSchemas(options = {}) {
    const ajv = createAjv();
    const [entrySchema, indexSchema, manifestSchema] = await Promise.all([
        readJson(ENTRY_SCHEMA_PATH),
        readJson(INDEX_SCHEMA_PATH),
        readJson(MANIFEST_SCHEMA_PATH),
    ]);

    // Test mode only: relax the https-only source rule in an in-memory copy so
    // the enrichment path can be exercised against a local fixture repository.
    // schema.json on disk — the rule the registry actually enforces — is never
    // touched, and this is unreachable without the explicit opt-in flag.
    if (options.allowLocalSource) {
        delete entrySchema.$id;
        delete entrySchema.properties.source.properties.url.pattern;
        delete entrySchema.properties.source.properties.url.minLength;
        delete entrySchema.properties.source.properties.url.format;
        delete indexSchema.$id;
        delete indexSchema.$defs.indexedPlugin.properties.source.properties.url.format;
    }

    return {
        ajv,
        entrySchema,
        indexSchema,
        manifestSchema,
        validateEntry: ajv.compile(entrySchema),
        validateIndex: ajv.compile(indexSchema),
        validateManifest: ajv.compile(manifestSchema),
    };
}

/** True when this run must not touch the network. */
export function offlineRequested(argv = process.argv) {
    return argv.includes('--offline') || process.env.SIGNALS_OFFLINE === '1';
}

/**
 * Parse and trust-check a manifest schema document before it is used to
 * validate anyone's signals.yaml. Throws with a reason when the document is
 * not the framework's schema or does not compile.
 */
export function acceptManifestSchema(text) {
    let schema;

    try {
        schema = JSON.parse(text);
    } catch (error) {
        throw new Error(`response is not valid JSON: ${error.message}`);
    }

    if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
        throw new Error('response is not a JSON object');
    }

    if (typeof schema.$id !== 'string' || !MANIFEST_SCHEMA_IDS.includes(schema.$id)) {
        throw new Error(`unexpected $id ${JSON.stringify(schema.$id ?? null)}`);
    }

    // Compile in a throwaway instance: a schema that fails here must not leave
    // its $id registered on the instance the caller goes on to use.
    let validate;
    try {
        validate = createAjv().compile(schema);
    } catch (error) {
        throw new Error(`does not compile: ${error.message}`);
    }

    return { schema, validate };
}

/** Fetch the live manifest schema, aborting quickly so CI is never held up. */
export async function fetchManifestSchema(options = {}) {
    const { url = MANIFEST_SCHEMA_URL, timeoutMs = MANIFEST_FETCH_TIMEOUT_MS } = options;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let text;
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            redirect: 'follow',
            headers: { accept: 'application/json' },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        text = await response.text();
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`);
        }
        throw new Error(error.message);
    } finally {
        clearTimeout(timer);
    }

    return { text, ...acceptManifestSchema(text) };
}

/**
 * The manifest schema every fetched signals.yaml is validated against.
 *
 * Prefers the framework's published copy so a plugin author's manifest is
 * checked against the rules in force today, and falls back to the pinned copy
 * in schemas/vendor/ whenever that cannot be had — offline builds included.
 * The fallback is never silent: it always reports one line on stderr.
 *
 * Returns { validate, schema, source: 'live' | 'vendored', url?, reason? }.
 */
export async function loadManifestSchema(options = {}) {
    const {
        offline = false,
        url = MANIFEST_SCHEMA_URL,
        timeoutMs = MANIFEST_FETCH_TIMEOUT_MS,
        log = console.error,
    } = options;

    let reason = 'offline';

    if (offline) {
        log('Manifest schema: using the vendored copy (offline).');
    } else {
        try {
            const { schema, validate } = await fetchManifestSchema({ url, timeoutMs });
            return { schema, validate, source: 'live', url };
        } catch (error) {
            reason = error.message;
            log(`Manifest schema: using the vendored copy (${url}: ${reason}).`);
        }
    }

    const schema = await readJson(MANIFEST_SCHEMA_PATH);
    return { schema, validate: createAjv().compile(schema), source: 'vendored', reason };
}

/** Format ajv errors as one readable line each. */
export function formatErrors(errors) {
    if (!errors || errors.length === 0) {
        return ['unknown validation error'];
    }

    return errors.map((error) => {
        const where = error.instancePath === '' ? '(root)' : error.instancePath;
        const extra =
            error.params && Object.keys(error.params).length > 0
                ? ` (${Object.entries(error.params)
                      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
                      .join(', ')})`
                : '';
        return `${where} ${error.message}${extra}`;
    });
}

/**
 * Every *.json file under plugins/, at any depth, so misplaced files are
 * reported rather than silently ignored.
 */
export async function listEntryFiles() {
    if (!existsSync(PLUGINS_DIR)) {
        return [];
    }

    const found = [];

    async function walk(dir) {
        const dirents = await readdir(dir, { withFileTypes: true });
        for (const dirent of dirents) {
            const full = path.join(dir, dirent.name);
            if (dirent.isDirectory()) {
                await walk(full);
            } else if (dirent.isFile() && dirent.name.endsWith('.json')) {
                found.push(full);
            }
        }
    }

    await walk(PLUGINS_DIR);
    return found.sort();
}

/**
 * The package name a file path implies: plugins/<vendor>/<name>.json.
 * Returns null when the file is not at that exact depth.
 */
export function packageFromPath(absolutePath) {
    const relative = path.relative(PLUGINS_DIR, absolutePath);
    const segments = relative.split(path.sep);

    if (segments.length !== 2 || !segments[1].endsWith('.json')) {
        return null;
    }

    return `${segments[0]}/${segments[1].slice(0, -'.json'.length)}`;
}

/**
 * Validate the whole registry: JSON well-formedness, entry schema,
 * filename/package agreement and package uniqueness.
 *
 * Returns { entries, problems } where entries are the successfully parsed and
 * validated ones (used by the index build) and problems is a list of
 * { file, messages }.
 */
export async function validateRegistry(schemas) {
    const files = await listEntryFiles();
    const entries = [];
    const problems = [];
    const seen = new Map();

    for (const file of files) {
        const messages = [];
        const expectedPackage = packageFromPath(file);

        if (expectedPackage === null) {
            problems.push({
                file,
                messages: [
                    'entry files must live at plugins/<vendor>/<package>.json (exactly one directory deep)',
                ],
            });
            continue;
        }

        let entry;
        try {
            entry = await readJson(file);
        } catch (error) {
            problems.push({ file, messages: [error.message] });
            continue;
        }

        if (!schemas.validateEntry(entry)) {
            messages.push(...formatErrors(schemas.validateEntry.errors));
        }

        if (typeof entry.package === 'string' && entry.package !== expectedPackage) {
            messages.push(
                `package "${entry.package}" does not match the file path, which implies "${expectedPackage}"`,
            );
        }

        if (typeof entry.package === 'string') {
            const previous = seen.get(entry.package);
            if (previous) {
                messages.push(`duplicate package, already declared by ${rel(previous)}`);
            } else {
                seen.set(entry.package, file);
            }
        }

        if (messages.length > 0) {
            problems.push({ file, messages });
            continue;
        }

        entries.push({ file, entry });
    }

    entries.sort((a, b) => (a.entry.package < b.entry.package ? -1 : 1));

    return { files, entries, problems };
}

export function reportProblems(problems) {
    for (const problem of problems) {
        console.error(`\n  ${rel(problem.file)}`);
        for (const message of problem.messages) {
            console.error(`    - ${message}`);
        }
    }
}
