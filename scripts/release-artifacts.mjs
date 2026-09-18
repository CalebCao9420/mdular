#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadAppMetadata } from './app-metadata.mjs';
import { verifyReleaseTag } from './check-release-version.mjs';

export const RELEASE_PLATFORM_CONTRACT = Object.freeze({
  'windows-x86_64': Object.freeze({
    bundleType: 'nsis',
    bundleSuffix: '.exe',
    requiredAdditionalSuffixes: Object.freeze([]),
  }),
  'darwin-aarch64': Object.freeze({
    bundleType: 'app',
    bundleSuffix: '.app.tar.gz',
    requiredAdditionalSuffixes: Object.freeze(['.dmg']),
  }),
  'darwin-x86_64': Object.freeze({
    bundleType: 'app',
    bundleSuffix: '.app.tar.gz',
    requiredAdditionalSuffixes: Object.freeze(['.dmg']),
  }),
  'linux-x86_64': Object.freeze({
    bundleType: 'appimage',
    bundleSuffix: '.AppImage',
    requiredAdditionalSuffixes: Object.freeze([]),
  }),
});

const PLATFORM_KEYS = Object.freeze(Object.keys(RELEASE_PLATFORM_CONTRACT).sort());
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;

function fail(message) {
  throw new Error(message);
}

function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isRecord(value) {
  return null !== value && 'object' === typeof value && !Array.isArray(value);
}

function assertSafeBasename(value, label) {
  if (
    'string' !== typeof value ||
    '' === value ||
    value !== basename(value) ||
    '.' === value ||
    '..' === value ||
    /[\\/\0\r\n]/u.test(value) ||
    240 < value.length
  ) {
    fail(`${label} is not a safe basename`);
  }
  return value;
}

function collectRegularFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) { fail(`Release input contains a symbolic link: ${entry.name}`); }
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  }
  visit(root);
  return files;
}

function collectCandidateFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = readlinkSync(path);
        const isAppDirIcon =
          '.DirIcon' === entry.name &&
          basename(directory).endsWith('.AppDir') &&
          target === basename(target) &&
          '.' !== target &&
          '..' !== target;
        if (!isAppDirIcon || !lstatSync(join(directory, target)).isFile()) {
          fail(`Candidate output contains an unexpected symbolic link: ${entry.name}`);
        }
        continue;
      }
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  }
  visit(root);
  return files;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function copyUnique(source, outputDirectory, claimedBasenames) {
  const name = assertSafeBasename(basename(source), 'Release asset');
  if (claimedBasenames.has(name)) { fail(`Release asset basename is duplicated: ${name}`); }
  claimedBasenames.add(name);
  copyFileSync(source, join(outputDirectory, name));
  return name;
}

function readSignature(path) {
  const metadata = statSync(path);
  if (!metadata.isFile() || 64 * 1024 < metadata.size) {
    fail('Updater signature is missing, non-regular or oversized');
  }
  const signature = readFileSync(path, 'utf8').trim();
  if ('' === signature || /\s/u.test(signature)) {
    fail('Updater signature must be one non-empty base64 value');
  }
  return signature;
}

export function collectReleaseArtifact({
  platformKey,
  bundleType,
  searchRoot,
  outputDirectory,
}) {
  const contract = RELEASE_PLATFORM_CONTRACT[platformKey];
  if (!contract) { fail(`Unknown release platform: ${platformKey}`); }
  if (contract.bundleType !== bundleType) {
    fail(`Bundle type ${bundleType} does not match ${platformKey}`);
  }
  const root = resolve(searchRoot);
  const files = collectRegularFiles(root);
  const bundles = files.filter((path) =>
    path.endsWith(contract.bundleSuffix) && files.includes(`${path}.sig`)
  );
  if (1 !== bundles.length) {
    fail(`Expected exactly one signed ${contract.bundleSuffix} bundle for ${platformKey}`);
  }
  const bundlePath = bundles[0];
  const signaturePath = `${bundlePath}.sig`;
  readSignature(signaturePath);

  const additionalPaths = [];
  for (const suffix of contract.requiredAdditionalSuffixes) {
    const matches = files.filter((path) => path.endsWith(suffix));
    if (1 !== matches.length) {
      fail(`Expected exactly one ${suffix} installer for ${platformKey}`);
    }
    additionalPaths.push(matches[0]);
  }

  const output = resolve(outputDirectory);
  mkdirSync(output, { recursive: true });
  const claimed = new Set();
  const bundleBasename = copyUnique(bundlePath, output, claimed);
  const signatureBasename = copyUnique(signaturePath, output, claimed);
  const additionalAssets = additionalPaths.map((path) => {
    const assetBasename = copyUnique(path, output, claimed);
    return { basename: assetBasename, sha256: sha256(path) };
  });
  const inventory = {
    schemaVersion: 1,
    platformKey,
    bundleType,
    bundleBasename,
    signatureBasename,
    bundleSha256: sha256(bundlePath),
    signatureSha256: sha256(signaturePath),
    additionalAssets,
  };
  writeFileSync(
    join(output, `inventory-${platformKey}.json`),
    formatJson(inventory),
    'utf8',
  );
  return inventory;
}

function validateAdditionalAssets(value) {
  if (!Array.isArray(value)) { fail('Inventory additionalAssets must be an array'); }
  return value.map((asset) => {
    if (
      !isRecord(asset) ||
      'string' !== typeof asset.basename ||
      'string' !== typeof asset.sha256 ||
      !SHA256_PATTERN.test(asset.sha256)
    ) { fail('Inventory additional asset is malformed'); }
    return {
      basename: assertSafeBasename(asset.basename, 'Additional asset'),
      sha256: asset.sha256,
    };
  });
}

export function validateInventory(value) {
  if (!isRecord(value) || 1 !== value.schemaVersion) {
    fail('Release inventory has an unsupported schema');
  }
  const contract = RELEASE_PLATFORM_CONTRACT[value.platformKey];
  if (!contract || contract.bundleType !== value.bundleType) {
    fail('Release inventory platform or bundle type is invalid');
  }
  for (const field of ['bundleSha256', 'signatureSha256']) {
    if ('string' !== typeof value[field] || !SHA256_PATTERN.test(value[field])) {
      fail(`Release inventory ${field} is invalid`);
    }
  }
  const bundleBasename = assertSafeBasename(value.bundleBasename, 'Updater bundle');
  const signatureBasename = assertSafeBasename(value.signatureBasename, 'Updater signature');
  if (`${bundleBasename}.sig` !== signatureBasename) {
    fail('Updater signature basename does not match its bundle');
  }
  if (!bundleBasename.endsWith(contract.bundleSuffix)) {
    fail('Updater bundle suffix does not match its platform');
  }
  const additionalAssets = validateAdditionalAssets(value.additionalAssets);
  for (const suffix of contract.requiredAdditionalSuffixes) {
    if (1 !== additionalAssets.filter((asset) => asset.basename.endsWith(suffix)).length) {
      fail(`Release inventory is missing its required ${suffix} installer`);
    }
  }
  return {
    schemaVersion: 1,
    platformKey: value.platformKey,
    bundleType: value.bundleType,
    bundleBasename,
    signatureBasename,
    bundleSha256: value.bundleSha256,
    signatureSha256: value.signatureSha256,
    additionalAssets,
  };
}

function validateRfc3339(value) {
  if ('string' !== typeof value || !RFC3339_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    fail('Release pub_date must be a valid UTC RFC 3339 timestamp');
  }
  return value;
}

export function validateLatestManifest(manifest, { version, releaseTag, repositoryUrl }) {
  if (!isRecord(manifest) || manifest.version !== version) {
    fail('latest.json version does not match the canonical app version');
  }
  if ('string' !== typeof manifest.notes || '' === manifest.notes.trim()) {
    fail('latest.json notes must be non-empty');
  }
  validateRfc3339(manifest.pub_date);
  if (!isRecord(manifest.platforms)) { fail('latest.json platforms must be an object'); }
  const actualKeys = Object.keys(manifest.platforms).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(PLATFORM_KEYS)) {
    fail('latest.json platform coverage is incomplete');
  }
  for (const platformKey of PLATFORM_KEYS) {
    const platform = manifest.platforms[platformKey];
    if (
      !isRecord(platform) ||
      'string' !== typeof platform.url ||
      'string' !== typeof platform.signature ||
      '' === platform.signature.trim()
    ) { fail(`latest.json entry ${platformKey} is incomplete`); }
    const url = new URL(platform.url);
    if (
      'https:' !== url.protocol ||
      !url.href.startsWith(`${repositoryUrl}/releases/download/${releaseTag}/`)
    ) { fail(`latest.json entry ${platformKey} has an invalid release URL`); }
  }
  return manifest;
}

export function aggregateReleaseArtifacts({
  inputDirectory,
  outputDirectory,
  releaseTag,
  notes,
  pubDate = new Date().toISOString(),
  metadata,
}) {
  const appMetadata = metadata ?? loadAppMetadata();
  verifyReleaseTag(releaseTag, appMetadata.version);
  const normalizedNotes = notes.trim();
  if ('' === normalizedNotes || 64 * 1024 < Buffer.byteLength(normalizedNotes, 'utf8')) {
    fail('Release notes must be non-empty and no larger than 64 KiB');
  }
  validateRfc3339(pubDate);

  const input = resolve(inputDirectory);
  const inventoryPaths = collectRegularFiles(input).filter((path) =>
    /^inventory-.+\.json$/u.test(basename(path))
  );
  if (PLATFORM_KEYS.length !== inventoryPaths.length) {
    fail(`Expected ${PLATFORM_KEYS.length} release inventories`);
  }
  const inventories = new Map();
  for (const inventoryPath of inventoryPaths) {
    const inventory = validateInventory(JSON.parse(readFileSync(inventoryPath, 'utf8')));
    if (inventories.has(inventory.platformKey)) {
      fail(`Duplicate release inventory for ${inventory.platformKey}`);
    }
    inventories.set(inventory.platformKey, { inventory, directory: dirname(inventoryPath) });
  }
  if (PLATFORM_KEYS.some((key) => !inventories.has(key))) {
    fail('Release inventory platform coverage is incomplete');
  }

  const output = resolve(outputDirectory);
  const assetsOutput = join(output, 'assets');
  mkdirSync(assetsOutput, { recursive: true });
  const claimedBasenames = new Set();
  const platforms = {};
  const verificationEntries = [];
  const assetInventory = [];
  for (const platformKey of PLATFORM_KEYS) {
    const { inventory, directory } = inventories.get(platformKey);
    const bundlePath = join(directory, inventory.bundleBasename);
    const signaturePath = join(directory, inventory.signatureBasename);
    if (
      inventory.bundleSha256 !== sha256(bundlePath) ||
      inventory.signatureSha256 !== sha256(signaturePath)
    ) { fail(`Release artifact hash mismatch for ${platformKey}`); }
    const signature = readSignature(signaturePath);
    const bundleBasename = copyUnique(bundlePath, assetsOutput, claimedBasenames);
    const signatureBasename = copyUnique(signaturePath, assetsOutput, claimedBasenames);
    assetInventory.push(
      { basename: bundleBasename, sha256: inventory.bundleSha256, platformKey },
      { basename: signatureBasename, sha256: inventory.signatureSha256, platformKey },
    );
    for (const additional of inventory.additionalAssets) {
      const additionalPath = join(directory, additional.basename);
      if (additional.sha256 !== sha256(additionalPath)) {
        fail(`Additional release artifact hash mismatch for ${platformKey}`);
      }
      const copied = copyUnique(additionalPath, assetsOutput, claimedBasenames);
      assetInventory.push({ basename: copied, sha256: additional.sha256, platformKey });
    }
    platforms[platformKey] = {
      url: `${appMetadata.repositoryUrl}/releases/download/${releaseTag}/${encodeURIComponent(bundleBasename)}`,
      signature,
    };
    verificationEntries.push({
      platformKey,
      bundlePath: `assets/${bundleBasename}`,
      signature,
    });
  }

  const latest = {
    version: appMetadata.version,
    notes: normalizedNotes,
    pub_date: pubDate,
    platforms,
  };
  validateLatestManifest(latest, {
    version: appMetadata.version,
    releaseTag,
    repositoryUrl: appMetadata.repositoryUrl,
  });
  writeFileSync(join(output, 'latest.json'), formatJson(latest), 'utf8');
  writeFileSync(join(output, 'signature-verification.json'), formatJson({
    schemaVersion: 1,
    entries: verificationEntries,
  }), 'utf8');
  writeFileSync(join(output, 'release-assets.json'), formatJson({
    schemaVersion: 1,
    releaseTag,
    assets: assetInventory.sort((left, right) => left.basename.localeCompare(right.basename)),
  }), 'utf8');
  return { latest, assets: assetInventory };
}

export function validateReleaseConfiguration(projectRoot) {
  const root = resolve(projectRoot);
  const candidate = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.ci.json'), 'utf8'));
  const release = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.release.json'), 'utf8'));
  const base = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  if (false !== candidate.bundle?.createUpdaterArtifacts) {
    fail('Candidate config must disable updater artifacts');
  }
  if (true !== release.bundle?.createUpdaterArtifacts) {
    fail('Release config must enable updater artifacts');
  }
  if (
    'string' !== typeof base.plugins?.updater?.pubkey ||
    '' === base.plugins.updater.pubkey.trim() ||
    !Array.isArray(base.plugins.updater.endpoints) ||
    1 !== base.plugins.updater.endpoints.length ||
    !base.plugins.updater.endpoints[0].startsWith('https://')
  ) { fail('Updater public key or endpoint is incomplete'); }

  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const npmVersion = packageJson.dependencies?.['@tauri-apps/plugin-updater'];
  const cargoToml = readFileSync(join(root, 'src-tauri/Cargo.toml'), 'utf8');
  const cargoVersion = cargoToml.match(/^tauri-plugin-updater\s*=\s*"=([^"]+)"$/mu)?.[1];
  if (!npmVersion || npmVersion !== cargoVersion || !/^\d+\.\d+\.\d+$/u.test(npmVersion)) {
    fail('Rust and npm updater dependencies must use the same exact version');
  }
  const capability = readFileSync(join(root, 'src-tauri/capabilities/default.json'), 'utf8');
  if (
    /"updater:default"|"process:default"/u.test(capability) ||
    !/"allow-updater-coordination"/u.test(capability)
  ) { fail('Frontend updater capability is broader than the restart response contract'); }
  return { updaterVersion: npmVersion };
}

export function validateSigningEnvironment(environment = process.env) {
  if (
    'string' !== typeof environment.TAURI_SIGNING_PRIVATE_KEY ||
    '' === environment.TAURI_SIGNING_PRIVATE_KEY.trim()
  ) {
    fail('TAURI_SIGNING_PRIVATE_KEY is missing or empty');
  }
  return true;
}

export function assertCandidateOutput(searchRoot) {
  const forbidden = collectCandidateFiles(resolve(searchRoot)).filter((path) =>
    path.endsWith('.sig') ||
    path.endsWith('.app.tar.gz') ||
    'latest.json' === basename(path)
  );
  if (0 < forbidden.length) {
    fail('Candidate output unexpectedly contains updater or latest.json artifacts');
  }
  return true;
}

function parseCliArguments(arguments_) {
  const [command, ...tokens] = arguments_;
  const options = new Map();
  for (let index = 0; index < tokens.length; index += 2) {
    const name = tokens[index];
    const value = tokens[index + 1];
    if (!name?.startsWith('--') || undefined === value) {
      fail(`Invalid command argument near ${name ?? '(end)'}`);
    }
    options.set(name.slice(2), value);
  }
  return { command, options };
}

function required(options, name) {
  const value = options.get(name);
  if (!value) { fail(`Missing required option --${name}`); }
  return value;
}

function runCli() {
  const { command, options } = parseCliArguments(process.argv.slice(2));
  if ('collect' === command) {
    const inventory = collectReleaseArtifact({
      platformKey: required(options, 'platform'),
      bundleType: required(options, 'bundle-type'),
      searchRoot: required(options, 'search-root'),
      outputDirectory: required(options, 'output'),
    });
    console.log(`Collected signed updater artifact: ${inventory.platformKey}`);
    return;
  }
  if ('aggregate' === command) {
    const notes = readFileSync(required(options, 'notes-file'), 'utf8');
    const result = aggregateReleaseArtifacts({
      inputDirectory: required(options, 'input'),
      outputDirectory: required(options, 'output'),
      releaseTag: required(options, 'tag'),
      notes,
      ...(options.has('pub-date') ? { pubDate: options.get('pub-date') } : {}),
    });
    console.log(`Generated one latest.json with ${Object.keys(result.latest.platforms).length} platforms.`);
    return;
  }
  if ('validate-config' === command) {
    const result = validateReleaseConfiguration(options.get('root') ?? process.cwd());
    console.log(`Release configuration passed (updater ${result.updaterVersion}).`);
    return;
  }
  if ('validate-signing-env' === command) {
    validateSigningEnvironment();
    console.log('Updater signing environment is present.');
    return;
  }
  if ('assert-candidate' === command) {
    assertCandidateOutput(required(options, 'search-root'));
    console.log('Candidate contains zero updater artifacts and zero latest.json files.');
    return;
  }
  fail('Usage: release-artifacts.mjs collect|aggregate|validate-config|validate-signing-env|assert-candidate [options]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
