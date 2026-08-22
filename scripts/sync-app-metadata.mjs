import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadAppMetadata } from './app-metadata.mjs';

const projectRoot = process.cwd();
const checkOnly = process.argv.includes('--check');
const metadata = loadAppMetadata(projectRoot);
const driftedPaths = [];
const changedPaths = [];
const brandLeaks = [];

function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function updateFile(relativePath, expected) {
  const filePath = resolve(projectRoot, relativePath);
  const current = readFileSync(filePath, 'utf8');
  if (current === expected) { return; }

  if (checkOnly) {
    driftedPaths.push(relativePath);
    return;
  }
  writeFileSync(filePath, expected, 'utf8');
  changedPaths.push(relativePath);
}

function updateJson(relativePath, transform) {
  const current = JSON.parse(readFileSync(resolve(projectRoot, relativePath), 'utf8'));
  updateFile(relativePath, formatJson(transform(current)));
}

function replaceHtmlValue(source, pattern, replacement, label) {
  if (!pattern.test(source)) {
    throw new Error(`Could not find ${label} in web/index.html`);
  }
  return source.replace(pattern, replacement);
}

function replaceTomlField(source, section, field, value) {
  const heading = `[${section}]`;
  const start = source.indexOf(heading);
  if (-1 === start) { throw new Error(`Missing ${heading} in src-tauri/Cargo.toml`); }
  const next = source.indexOf('\n[', start + heading.length);
  const end = -1 === next ? source.length : next;
  const sectionSource = source.slice(start, end);
  const pattern = new RegExp(`^${field}\\s*=.*$`, 'mu');
  if (!pattern.test(sectionSource)) {
    throw new Error(`Missing ${field} in ${heading} of src-tauri/Cargo.toml`);
  }
  const updatedSection = sectionSource.replace(pattern, `${field} = ${value}`);
  return source.slice(0, start) + updatedSection + source.slice(end);
}

function collectFiles(relativePath, results) {
  const absolutePath = resolve(projectRoot, relativePath);
  if (statSync(absolutePath).isFile()) {
    results.push(relativePath);
    return;
  }
  for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
    const childPath = `${relativePath}/${entry.name}`;
    if (entry.isDirectory()) {
      collectFiles(childPath, results);
    } else if (entry.isFile()) {
      results.push(childPath);
    }
  }
}

function checkBrandNeutralImplementation() {
  // Product metadata belongs in app.manifest.json and generated host manifests. Internal
  // protocols stay neutral so a future identity change never becomes a source sweep.
  const roots = [
    'src',
    'src-tauri/src',
    'src-tauri/permissions',
    'launch.ps1',
    'install-desktop-shortcut.ps1',
    'web/app.css',
    'web/lib/hide-token.js',
    'web/lib/sidebar.css',
    'web/lib/theme-studio.css',
  ];
  const files = [];
  for (const root of roots) { collectFiles(root, files); }
  const brandPattern = new RegExp(metadata.name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'iu');
  for (const relativePath of files) {
    if (brandPattern.test(readFileSync(resolve(projectRoot, relativePath), 'utf8'))) {
      brandLeaks.push(relativePath);
    }
  }
}

updateJson('src-tauri/tauri.conf.json', (config) => {
  config.productName = metadata.name;
  config.mainBinaryName = metadata.name;
  config.version = '../app.manifest.json';
  config.identifier = metadata.identifier;
  config.app.windows[0].title = metadata.name;
  config.bundle.shortDescription = metadata.description;
  config.bundle.longDescription = metadata.description;
  config.bundle.copyright = `Copyright © ${metadata.author}`;
  config.plugins.updater.endpoints = [
    `${metadata.repositoryUrl}/releases/latest/download/latest.json`,
  ];
  return config;
});

let cargoToml = readFileSync(resolve(projectRoot, 'src-tauri/Cargo.toml'), 'utf8');
cargoToml = replaceTomlField(cargoToml, 'package', 'name', JSON.stringify(metadata.name));
cargoToml = replaceTomlField(cargoToml, 'package', 'version', JSON.stringify(metadata.version));
cargoToml = replaceTomlField(
  cargoToml,
  'package',
  'description',
  JSON.stringify(metadata.description),
);
cargoToml = replaceTomlField(cargoToml, 'package', 'authors', JSON.stringify([metadata.author]));
cargoToml = replaceTomlField(cargoToml, 'package', 'license', JSON.stringify(metadata.license));
cargoToml = replaceTomlField(
  cargoToml,
  'package',
  'repository',
  JSON.stringify(metadata.repositoryUrl),
);
updateFile('src-tauri/Cargo.toml', cargoToml);

updateJson('web/manifest.json', (manifest) => {
  manifest.name = metadata.name;
  manifest.short_name = metadata.name;
  manifest.description = metadata.description;
  return manifest;
});

let indexHtml = readFileSync(resolve(projectRoot, 'web/index.html'), 'utf8');
indexHtml = replaceHtmlValue(
  indexHtml,
  /(<meta name="description" content=")[^"]*(">)/u,
  `$1${metadata.description}$2`,
  'description metadata',
);
indexHtml = replaceHtmlValue(
  indexHtml,
  /(<meta name="application-name" content=")[^"]*(">)/u,
  `$1${metadata.name}$2`,
  'application-name metadata',
);
indexHtml = replaceHtmlValue(
  indexHtml,
  /(<meta name="apple-mobile-web-app-title" content=")[^"]*(">)/u,
  `$1${metadata.name}$2`,
  'Apple application title',
);
indexHtml = replaceHtmlValue(
  indexHtml,
  /<title>[^<]*<\/title>/u,
  `<title>${metadata.name}</title>`,
  'document title',
);
updateFile('web/index.html', indexHtml);

let helpMarkdown = readFileSync(resolve(projectRoot, 'Help.md'), 'utf8');
helpMarkdown = helpMarkdown.replace(/^# .*$/mu, `# ${metadata.name}`);
helpMarkdown = helpMarkdown.replace(
  /\(\*Install [^)]+\*\)/u,
  `(*Install ${metadata.name}*)`,
);
helpMarkdown = helpMarkdown.replaceAll(/\.[a-z0-9._-]+\/config\.json/gu, metadata.workspaceConfigPath);
updateFile('Help.md', helpMarkdown);

let readmeMarkdown = readFileSync(resolve(projectRoot, 'README.md'), 'utf8');
readmeMarkdown = readmeMarkdown.replace(/^# .* · v1$/mu, `# ${metadata.name} · v1`);
readmeMarkdown = readmeMarkdown.replaceAll(
  /\.[a-z0-9._-]+\/config\.json/gu,
  metadata.workspaceConfigPath,
);
updateFile('README.md', readmeMarkdown);

let gitignore = readFileSync(resolve(projectRoot, '.gitignore'), 'utf8');
gitignore = gitignore.replace(
  /(?<=^# app-metadata: workspace-config\r?\n)^.*$/mu,
  metadata.workspaceConfigPath,
);
updateFile('.gitignore', gitignore);

let llmsText = readFileSync(resolve(projectRoot, 'web/llms.txt'), 'utf8');
llmsText = llmsText.replace(/^# .*$/mu, `# ${metadata.name} - Workspace Structure`);
llmsText = llmsText.replace(
  /^This document describes .*$/mu,
  `This document describes the file structure of a ${metadata.name} workspace.`,
);
updateFile('web/llms.txt', llmsText);

let offlineScript = readFileSync(resolve(projectRoot, 'web/offline.js'), 'utf8');
offlineScript = offlineScript.replace(
  /const cacheName = `[^`]+`;/u,
  `const cacheName = \`${metadata.name}-v\${COMMIT_HASH}\`;`,
);
updateFile('web/offline.js', offlineScript);

checkBrandNeutralImplementation();

if (0 < brandLeaks.length) {
  console.error('Application name leaked into brand-neutral implementation files:');
  for (const relativePath of brandLeaks) { console.error(`- ${relativePath}`); }
  console.error('Use APP_NAME/WORKSPACE_CONFIG_PATH or neutral app/workspace protocol names.');
  process.exitCode = 1;
} else if (0 < driftedPaths.length) {
  console.error('Application metadata is out of sync:');
  for (const relativePath of driftedPaths) { console.error(`- ${relativePath}`); }
  console.error('Run: npm run sync:app-metadata');
  process.exitCode = 1;
} else if (checkOnly) {
  console.log(`Application metadata check passed (${metadata.name} ${metadata.version}).`);
} else if (0 < changedPaths.length) {
  console.log(`Synchronized application metadata: ${changedPaths.join(', ')}`);
} else {
  console.log(`Application metadata already synchronized (${metadata.name} ${metadata.version}).`);
}
