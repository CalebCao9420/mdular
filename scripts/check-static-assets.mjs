import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const projectRoot = process.cwd();
const webRoot = resolve(projectRoot, 'web');
const offlineSource = readFileSync(resolve(webRoot, 'offline.js'), 'utf8');
const indexSource = readFileSync(resolve(webRoot, 'index.html'), 'utf8');

const cacheArray = offlineSource.match(/const urlsToCache = \[([\s\S]*?)\n\];/);
if (!cacheArray) {
  throw new Error('Could not locate urlsToCache in web/offline.js');
}

const cachedUrls = Array.from(
  cacheArray[1].matchAll(/^\s*['"]([^'"]+)['"],?\s*$/gm),
  (match) => match[1]
);
const cachedSet = new Set(cachedUrls);
const errors = [];

if (cachedSet.size !== cachedUrls.length) {
  const seen = new Set();
  const duplicates = cachedUrls.filter((url) => seen.has(url) || !seen.add(url));
  errors.push(`Duplicate offline cache entries: ${Array.from(new Set(duplicates)).join(', ')}`);
}

for (const url of cachedUrls) {
  if (url === '/') continue;
  const relative = url.replace(/^\//, '').split(/[?#]/, 1)[0];
  const filePath = resolve(webRoot, relative.replaceAll('/', sep));
  if (!filePath.startsWith(webRoot + sep)) {
    errors.push(`Offline path escapes web root: ${url}`);
    continue;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    errors.push(`Offline cache entry does not exist: ${url}`);
  }
}

const initialAssets = Array.from(
  indexSource.matchAll(/\b(?:src|href)="([^"]+)"/g),
  (match) => match[1]
).filter((ref) => !/^(?:[a-z]+:|\/\/|#|data:)/i.test(ref));

for (const ref of initialAssets) {
  const cleanRef = ref.split(/[?#]/, 1)[0].replace(/^\.\//, '');
  const cacheUrl = '/' + cleanRef.replace(/^\//, '');
  if (!cachedSet.has(cacheUrl)) {
    errors.push(`Initial index asset is missing from offline cache: ${cacheUrl}`);
  }
}

if (errors.length > 0) {
  throw new Error(errors.join('\n'));
}

console.log(`Static asset check passed (${cachedUrls.length} cached, ${initialAssets.length} initial).`);
