/**
 * Enrichment: resolve a registry entry's source repository to its highest
 * SemVer git tag, read signals.yaml at that tag and validate it against the
 * vendored framework manifest schema.
 *
 * The registry itself stores no version data; everything under `latest` in
 * index.json comes from here.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import semver from 'semver';
import yaml from 'js-yaml';

import { formatErrors } from './registry.mjs';

export const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Local sources (file:// or a filesystem path) are refused unless explicitly
 * allowed. The entry schema is https-only; this switch exists purely so the
 * enrichment path can be exercised against a local fixture repository in
 * tests, and it never relaxes what the registry will accept.
 */
export function localSourcesAllowed(argv = process.argv) {
    return (
        argv.includes('--allow-local-source') ||
        process.env.SIGNALS_ALLOW_LOCAL_SOURCE === '1'
    );
}

function isHttpsUrl(url) {
    return /^https:\/\//.test(url);
}

class EnrichmentError extends Error {}

function run(command, args, { cwd, timeoutMs }) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            env: {
                ...process.env,
                GIT_TERMINAL_PROMPT: '0',
                GIT_ASKPASS: 'echo',
                GIT_CONFIG_NOSYSTEM: '1',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
        }, timeoutMs);

        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });

        child.on('error', (error) => {
            clearTimeout(timer);
            reject(new EnrichmentError(`could not run ${command}: ${error.message}`));
        });

        child.on('close', (code) => {
            clearTimeout(timer);
            if (timedOut) {
                reject(
                    new EnrichmentError(
                        `${command} ${args[0]} timed out after ${Math.round(timeoutMs / 1000)}s`,
                    ),
                );
                return;
            }
            if (code !== 0) {
                const detail = (stderr || stdout).trim().split('\n').slice(-3).join('; ');
                reject(
                    new EnrichmentError(
                        `${command} ${args[0]} failed (exit ${code})${detail ? `: ${detail}` : ''}`,
                    ),
                );
                return;
            }
            resolve({ stdout, stderr });
        });
    });
}

/**
 * Parse `git ls-remote --tags` output into tag names, dropping the peeled
 * `^{}` refs that annotated tags produce.
 */
export function parseTags(lsRemoteOutput) {
    const tags = new Set();

    for (const line of lsRemoteOutput.split('\n')) {
        const match = line.match(/\trefs\/tags\/(.+)$/);
        if (!match) {
            continue;
        }
        tags.add(match[1].replace(/\^\{\}$/, ''));
    }

    return [...tags];
}

/**
 * Highest strict-SemVer tag, accepting an optional leading "v".
 *
 * Stable releases win over prereleases regardless of ordering: 1.2.0 is
 * published as latest in preference to 2.0.0-rc.1, because an entry's `latest`
 * is what operators install. A prerelease is only chosen when the repository
 * has no stable tag at all.
 *
 * Returns { tag, version } or null when the repository publishes no usable tag.
 */
export function pickHighestSemverTag(tags) {
    let stable = null;
    let prerelease = null;

    for (const tag of tags) {
        const candidate = tag.startsWith('v') ? tag.slice(1) : tag;
        if (!semver.valid(candidate, { loose: false })) {
            continue;
        }

        const isPrerelease = semver.prerelease(candidate) !== null;
        const current = isPrerelease ? prerelease : stable;

        if (current === null || semver.gt(candidate, current.version)) {
            if (isPrerelease) {
                prerelease = { tag, version: candidate };
            } else {
                stable = { tag, version: candidate };
            }
        }
    }

    return stable ?? prerelease;
}

/**
 * Enrich one entry.
 *
 * Resolves to { ok: true, latest } or { ok: false, reason, warnings }.
 * Never throws for a repository problem — one unreachable plugin must not
 * fail the whole build.
 */
export async function enrichEntry(entry, options = {}) {
    const {
        validateManifest,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        allowLocalSource = false,
    } = options;

    const warnings = [];
    const url = entry.source?.url ?? '';
    let workDir = null;

    try {
        if (!isHttpsUrl(url) && !allowLocalSource) {
            throw new EnrichmentError(`source url must be https (got "${url}")`);
        }

        const started = Date.now();
        const remaining = () => Math.max(1_000, timeoutMs - (Date.now() - started));

        const { stdout } = await run('git', ['ls-remote', '--tags', '--', url], {
            timeoutMs: remaining(),
        });

        const tags = parseTags(stdout);
        if (tags.length === 0) {
            throw new EnrichmentError('repository publishes no git tags');
        }

        const picked = pickHighestSemverTag(tags);
        if (picked === null) {
            throw new EnrichmentError(
                `no strict SemVer tag among ${tags.length} tag(s): ${tags.slice(0, 5).join(', ')}`,
            );
        }

        workDir = await mkdtemp(path.join(os.tmpdir(), 'signals-registry-'));
        const checkout = path.join(workDir, 'repo');

        await run(
            'git',
            [
                'clone',
                '--depth',
                '1',
                '--single-branch',
                '--branch',
                picked.tag,
                '--',
                url,
                checkout,
            ],
            { timeoutMs: remaining() },
        );

        const manifestPath = path.join(checkout, 'signals.yaml');
        if (!existsSync(manifestPath)) {
            throw new EnrichmentError(`no signals.yaml at tag ${picked.tag}`);
        }

        let manifest;
        try {
            manifest = yaml.load(await readFile(manifestPath, 'utf8'));
        } catch (error) {
            throw new EnrichmentError(`signals.yaml is not valid YAML: ${error.message}`);
        }

        if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
            throw new EnrichmentError('signals.yaml must contain a mapping');
        }

        if (!validateManifest(manifest)) {
            const details = formatErrors(validateManifest.errors).slice(0, 8);
            throw new EnrichmentError(
                `signals.yaml at tag ${picked.tag} fails the manifest schema:\n      ${details.join('\n      ')}`,
            );
        }

        if (manifest.package !== entry.package) {
            const message = `signals.yaml declares package "${manifest.package}" but the registry entry is "${entry.package}"`;
            warnings.push(message);
            throw new EnrichmentError(message);
        }

        if (manifest.version !== picked.version) {
            warnings.push(
                `signals.yaml version "${manifest.version}" differs from tag ${picked.tag}; using the manifest version`,
            );
        }

        const hasPermissions =
            Array.isArray(manifest.permissions) && manifest.permissions.length > 0;
        const hasNetwork = Array.isArray(manifest.network) && manifest.network.length > 0;

        const latest = {
            version: manifest.version,
            name: manifest.name,
            signals_version: manifest.signals_version,
            ...(typeof manifest.icon === 'string' ? { icon: manifest.icon } : {}),
            ...(hasPermissions ? { permissions: [...manifest.permissions] } : {}),
            ...(hasNetwork ? { network: [...manifest.network] } : {}),
            tag: picked.tag,
            fetched_at: new Date().toISOString(),
        };

        return { ok: true, latest, warnings };
    } catch (error) {
        if (error instanceof EnrichmentError) {
            return { ok: false, reason: error.message, warnings };
        }
        return { ok: false, reason: error.message, warnings };
    } finally {
        if (workDir) {
            await rm(workDir, { recursive: true, force: true }).catch(() => {});
        }
    }
}
