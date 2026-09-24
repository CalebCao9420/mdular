import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { after } from 'node:test';

import {
  RELEASE_PLATFORM_CONTRACT,
  aggregateReleaseArtifacts,
  assertCandidateOutput,
  collectReleaseArtifact,
  validateLatestManifest,
  validateReleaseConfiguration,
  validateSigningEnvironment,
} from '../release-artifacts.mjs';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const fixtureRoots = [];
const metadata = Object.freeze({
  version: '0.1.0',
  repositoryUrl: 'https://github.com/CalebCao9420/mdular',
});
const platformKeys = Object.freeze(Object.keys(RELEASE_PLATFORM_CONTRACT).sort());

after(() => {
  for (const root of fixtureRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixtureRoot(label) {
  const root = mkdtempSync(join(tmpdir(), `mdular-release-${label}-`));
  fixtureRoots.push(root);
  return root;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function platformAssetNames(platformKey, duplicateMacNames = false) {
  if ('windows-x86_64' === platformKey) {
    return { bundle: 'mdular_0.1.0_x64-setup.exe', additional: [] };
  }
  if ('linux-x86_64' === platformKey) {
    return { bundle: 'mdular_0.1.0_amd64.AppImage', additional: [] };
  }
  const architecture = duplicateMacNames
    ? 'shared'
    : ('darwin-aarch64' === platformKey ? 'aarch64' : 'x64');
  return {
    bundle: `mdular_0.1.0_${architecture}.app.tar.gz`,
    additional: [`mdular_0.1.0_${architecture}.dmg`],
  };
}

function createCollectedFixture(label, { duplicateMacNames = false } = {}) {
  const root = fixtureRoot(label);
  const input = join(root, 'input');
  const collected = new Map();
  for (const platformKey of platformKeys) {
    const contract = RELEASE_PLATFORM_CONTRACT[platformKey];
    const source = join(root, 'source', platformKey);
    const output = join(input, platformKey);
    mkdirSync(source, { recursive: true });
    const names = platformAssetNames(platformKey, duplicateMacNames);
    const bundlePath = join(source, names.bundle);
    const signaturePath = `${bundlePath}.sig`;
    writeFileSync(bundlePath, `bundle:${platformKey}\n`, 'utf8');
    writeFileSync(
      signaturePath,
      Buffer.from(`signature:${platformKey}`, 'utf8').toString('base64'),
      'utf8',
    );
    for (const additional of names.additional) {
      writeFileSync(join(source, additional), `installer:${platformKey}\n`, 'utf8');
    }
    const inventory = collectReleaseArtifact({
      platformKey,
      bundleType: contract.bundleType,
      searchRoot: source,
      outputDirectory: output,
    });
    collected.set(platformKey, { inventory, output });
  }
  return { root, input, collected };
}

function aggregate(fixture, overrides = {}) {
  return aggregateReleaseArtifacts({
    inputDirectory: fixture.input,
    outputDirectory: join(fixture.root, 'aggregate'),
    releaseTag: 'v0.1.0',
    notes: 'A bounded release fixture.',
    pubDate: '2026-09-18T00:00:00Z',
    metadata,
    ...overrides,
  });
}

test('collects exact signed platform inventories and emits one complete latest.json', () => {
  const fixture = createCollectedFixture('happy');
  const result = aggregate(fixture);
  const output = join(fixture.root, 'aggregate');
  const latest = JSON.parse(readFileSync(join(output, 'latest.json'), 'utf8'));
  const verification = JSON.parse(
    readFileSync(join(output, 'signature-verification.json'), 'utf8'),
  );
  const assetInventory = JSON.parse(
    readFileSync(join(output, 'release-assets.json'), 'utf8'),
  );

  assert.deepEqual(Object.keys(latest.platforms).sort(), platformKeys);
  assert.deepEqual(result.latest, latest);
  assert.equal(verification.entries.length, 4);
  assert.equal(assetInventory.assets.length, 10);
  assert.equal(
    readdirSync(output).filter((name) => 'latest.json' === name).length,
    1,
  );
  for (const platformKey of platformKeys) {
    assert.match(
      latest.platforms[platformKey].url,
      new RegExp(`^https://github\\.com/CalebCao9420/mdular/releases/download/v0\\.1\\.0/`, 'u'),
    );
    assert.notEqual(latest.platforms[platformKey].signature, '');
  }
  for (const asset of assetInventory.assets) {
    assert.equal(sha256(join(output, 'assets', asset.basename)), asset.sha256);
  }
});

test('rejects missing platform coverage and changed bundle bytes', () => {
  const missing = createCollectedFixture('missing');
  rmSync(join(missing.input, 'linux-x86_64'), { recursive: true });
  assert.throws(() => aggregate(missing), /Expected 4 release inventories/u);

  const corrupted = createCollectedFixture('corrupt');
  const windows = corrupted.collected.get('windows-x86_64');
  writeFileSync(
    join(windows.output, windows.inventory.bundleBasename),
    'changed-after-inventory\n',
    'utf8',
  );
  assert.throws(() => aggregate(corrupted), /hash mismatch for windows-x86_64/u);
});

test('rejects empty signatures, duplicate asset names, and tag metadata mismatches', () => {
  const root = fixtureRoot('empty-signature');
  const source = join(root, 'source');
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, 'mdular.exe'), 'bundle', 'utf8');
  writeFileSync(join(source, 'mdular.exe.sig'), ' \n', 'utf8');
  assert.throws(() => collectReleaseArtifact({
    platformKey: 'windows-x86_64',
    bundleType: 'nsis',
    searchRoot: source,
    outputDirectory: join(root, 'output'),
  }), /signature must be one non-empty base64 value/u);

  const duplicate = createCollectedFixture('duplicate', { duplicateMacNames: true });
  assert.throws(() => aggregate(duplicate), /asset basename is duplicated/u);

  const mismatched = createCollectedFixture('tag-mismatch');
  assert.throws(
    () => aggregate(mismatched, { releaseTag: 'v0.1.1' }),
    /expected v0\.1\.0/u,
  );
});

test('fails closed on invalid release notes, dates, URLs, and manifest coverage', () => {
  const fixture = createCollectedFixture('manifest-errors');
  assert.throws(() => aggregate(fixture, { notes: '  ' }), /notes must be non-empty/u);
  assert.throws(
    () => aggregate(fixture, { pubDate: '2026-09-18' }),
    /valid UTC RFC 3339/u,
  );

  const valid = aggregate(createCollectedFixture('manifest-valid')).latest;
  const missing = structuredClone(valid);
  delete missing.platforms['linux-x86_64'];
  assert.throws(() => validateLatestManifest(missing, {
    version: metadata.version,
    releaseTag: 'v0.1.0',
    repositoryUrl: metadata.repositoryUrl,
  }), /platform coverage is incomplete/u);

  const insecure = structuredClone(valid);
  insecure.platforms['linux-x86_64'].url = 'http://example.invalid/mdular.AppImage';
  assert.throws(() => validateLatestManifest(insecure, {
    version: metadata.version,
    releaseTag: 'v0.1.0',
    repositoryUrl: metadata.repositoryUrl,
  }), /invalid release URL/u);
});

test('candidate and signing gates reject forbidden output or missing secrets', () => {
  const root = fixtureRoot('candidate');
  mkdirSync(join(root, 'bundle'), { recursive: true });
  writeFileSync(join(root, 'bundle', 'mdular.exe'), 'installer', 'utf8');
  assert.equal(assertCandidateOutput(root), true);
  writeFileSync(join(root, 'bundle', 'mdular.exe.sig'), 'signature', 'utf8');
  assert.throws(() => assertCandidateOutput(root), /unexpectedly contains updater/u);

  assert.throws(() => validateSigningEnvironment({}), /missing or empty/u);
  assert.throws(
    () => validateSigningEnvironment({ TAURI_SIGNING_PRIVATE_KEY: '   ' }),
    /missing or empty/u,
  );
  assert.equal(
    validateSigningEnvironment({ TAURI_SIGNING_PRIVATE_KEY: 'private-key-reference' }),
    true,
  );
});

test('candidate permits only the standard local AppDir icon link', {
  skip: 'win32' === process.platform,
}, () => {
  const root = fixtureRoot('candidate-appdir-link');
  const appDir = join(root, 'bundle', 'mdular.AppDir');
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, 'mdular.png'), 'icon', 'utf8');
  symlinkSync('mdular.png', join(appDir, '.DirIcon'));

  assert.equal(assertCandidateOutput(root), true);

  rmSync(join(appDir, '.DirIcon'));
  symlinkSync(join(appDir, 'mdular.png'), join(appDir, '.DirIcon'));
  assert.throws(() => assertCandidateOutput(root), /unexpected symbolic link/u);

  rmSync(join(appDir, '.DirIcon'));
  symlinkSync('mdular.png', join(appDir, '.DirIcon'));
  symlinkSync('mdular.png', join(appDir, 'unexpected-link'));
  assert.throws(() => assertCandidateOutput(root), /unexpected symbolic link/u);
});

test('repository release config pins one updater version and a narrow response capability', () => {
  assert.deepEqual(validateReleaseConfiguration(projectRoot), { updaterVersion: '2.10.1' });
});
