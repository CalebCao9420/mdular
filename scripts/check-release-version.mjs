import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadAppMetadata } from './app-metadata.mjs';

export function expectedReleaseTag(version) {
  return `v${version}`;
}

export function verifyReleaseTag(releaseTag, version) {
  const expectedTag = expectedReleaseTag(version);
  if (releaseTag !== expectedTag) {
    throw new Error(
      `Release tag ${JSON.stringify(releaseTag)} does not match app.manifest.json version; expected ${expectedTag}`,
    );
  }
  return expectedTag;
}

function runCli() {
  const releaseTag = process.argv[2] ?? process.env.RELEASE_TAG;
  if (!releaseTag) {
    console.error('Missing release tag. Pass it as an argument or set RELEASE_TAG.');
    process.exitCode = 2;
    return;
  }

  try {
    const metadata = loadAppMetadata(process.cwd());
    const verifiedTag = verifyReleaseTag(releaseTag, metadata.version);
    console.log(`Release version check passed (${verifiedTag}).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli();
}
