'use strict';
// Runs every feature suite in order and summarizes. Exit code 0 = all green.
// Run this before merging any change to the app.

const { spawnSync } = require('child_process');
const path = require('path');

const suites = [
  'test-auth.js',
  'test-profile.js',
  'test-discovery.js',
  'test-filters.js',
  'test-matching.js',
  'test-chat.js',
  'test-safety.js',
  'test-settings.js',
];

const failed = [];
for (const s of suites) {
  const r = spawnSync(process.execPath, [path.join(__dirname, s)], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(s);
}

console.log('\n================================');
if (failed.length) {
  console.log(`${failed.length}/${suites.length} suite(s) FAILED: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`All ${suites.length} suites passed`);
