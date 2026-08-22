import assert from 'node:assert/strict';
import test from 'node:test';

import {
  expectedReleaseTag,
  verifyReleaseTag,
} from '../check-release-version.mjs';

test('derives the release tag from the canonical app version', () => {
  assert.equal(expectedReleaseTag('1.2.3'), 'v1.2.3');
});

test('accepts a release tag that matches the app version', () => {
  assert.equal(verifyReleaseTag('v1.2.3', '1.2.3'), 'v1.2.3');
});

test('rejects a release tag that differs from the app version', () => {
  assert.throws(
    () => verifyReleaseTag('v1.2.2', '1.2.3'),
    /expected v1\.2\.3/u,
  );
});
