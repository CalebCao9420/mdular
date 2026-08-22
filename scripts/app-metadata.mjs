import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const IDENTIFIER_PATTERN = /^[A-Za-z0-9.-]+$/u;
const PACKAGE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;
const VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

function requireString(value, field) {
  if ('string' !== typeof value || '' === value.trim()) {
    throw new Error(`app.manifest.json#${field} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeRepositoryUrl(value) {
  const rawUrl = requireString(value, 'repository').replace(/^git\+/u, '');
  const url = new URL(rawUrl);
  const pathname = url.pathname.replace(/^\/+|\/+$/gu, '').replace(/\.git$/u, '');
  if ('github.com' !== url.hostname.toLowerCase() || 2 !== pathname.split('/').length) {
    throw new Error('app.manifest.json#repository must point to a GitHub owner/repository URL');
  }
  return `https://github.com/${pathname}`;
}

export function loadAppMetadata(projectRoot = process.cwd()) {
  const manifestPath = resolve(projectRoot, 'app.manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const name = requireString(manifest.name, 'name');
  const version = requireString(manifest.version, 'version');
  const description = requireString(manifest.description, 'description');
  const author = requireString(manifest.author, 'author');
  const license = requireString(manifest.license, 'license');
  const identifier = requireString(manifest.identifier, 'identifier');

  if (!PACKAGE_NAME_PATTERN.test(name)) {
    throw new Error('app.manifest.json#name must be a lowercase package-safe application name');
  }
  if (!VERSION_PATTERN.test(version)) {
    throw new Error('app.manifest.json#version must be a semantic version');
  }
  if (!IDENTIFIER_PATTERN.test(identifier) || !identifier.includes('.')) {
    throw new Error('app.manifest.json#identifier must use reverse-domain notation');
  }

  const repositoryUrl = normalizeRepositoryUrl(manifest.repository);
  const repositorySlug = new URL(repositoryUrl).pathname.replace(/^\//u, '');
  return Object.freeze({
    name,
    version,
    description,
    author,
    license,
    identifier,
    repositoryUrl,
    repositorySlug,
    workspaceConfigPath: `.${name}/config.json`,
    webWorkspaceConfigPath: `/.${name}/config.json`,
  });
}
