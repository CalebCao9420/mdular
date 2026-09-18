import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import { transformSync } from 'esbuild';

const projectRoot = resolve(import.meta.dirname, '..', '..');

function readProjectFile(relativePath) {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8');
}

function runLegacy(relativePath, globals, appendedSource) {
  const context = vm.createContext({ ...globals });
  context.globalThis = context;
  const source = `${readProjectFile(relativePath)}\n${appendedSource}`;
  const compiled = transformSync(source, { loader: 'ts', target: 'es2020' }).code;
  vm.runInContext(compiled, context, { filename: relativePath });
  return context;
}

test('V1 Media maps the supported clipboard MIME set and defaults unknown input to png', () => {
  const files = runLegacy(
    'src/files/index.ts',
    {},
    'Object.assign(globalThis, { __getImageExtension: getImageExtension, __isMediaPath: isMediaPath });',
  );
  assert.equal(files.__getImageExtension('image/jpeg'), 'jpg');
  assert.equal(files.__getImageExtension('video/quicktime'), 'mov');
  assert.equal(files.__getImageExtension('audio/x-wav'), 'wav');
  assert.equal(files.__getImageExtension('application/octet-stream'), 'png');
  assert.equal(files.__isMediaPath('media/demo.oga'), true);
  assert.equal(files.__isMediaPath('media/demo.svg'), false);
});
test('V1 Media filename policy replaces reserved characters', () => {
  const fs = runLegacy(
    'web/lib/fs.js',
    {},
    'Object.assign(globalThis, { __generateSafeFilename: generateSafeFilename });',
  );
  const filename = fs.__generateSafeFilename('my bad:<name>.png');
  assert.match(filename, /-my-bad--name-\.png$/u);
  assert.doesNotMatch(filename, /[<>:"/\\|?*\s]/u);
});

test('V1 editor accepts pasted image, video and audio, then inserts an image-style media link', () => {
  const source = readProjectFile('src/editor/index.ts');
  assert.match(source, /newEditor\.on\('paste'/u);
  assert.match(source, /item\.type\.startsWith\('image\/'\)[\s\S]*?item\.type\.startsWith\('video\/'\)[\s\S]*?item\.type\.startsWith\('audio\/'\)/u);
  assert.match(source, /writeMediaFile\(fileName, file\)[\s\S]*?`!\[\]\(media\/\$\{fileName\}\)\\n`[\s\S]*?replaceSelection/u);
  assert.doesNotMatch(source, /newEditor\.on\('drop'/u);
});

test('V1 preview distinguishes images, muted looping video and controlled audio', () => {
  const source = readProjectFile('web/lib/fold-image.js');
  assert.match(source, /document\.createElement\("video"\)[\s\S]*?autoplay = true[\s\S]*?muted = true[\s\S]*?loop = true[\s\S]*?controls = true/u);
  assert.match(source, /document\.createElement\("audio"\)[\s\S]*?controls = true[\s\S]*?preload = "metadata"/u);
  assert.match(source, /event\.key !== "Escape"/u);
  assert.match(source, /modal\.addEventListener\("click"/u);
  assert.match(source, /cm\?\.focus\(\)/u);
  assert.match(source, /prefers-reduced-motion: reduce/u);
});
