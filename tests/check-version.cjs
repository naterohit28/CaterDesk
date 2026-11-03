// Fails when the release number differs between the files that carry it, and prints it otherwise.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const version = JSON.parse(read('package.json')).version;
const sources = [
  ['public/app.js', /const APP_BUILD = '([^']+)'/],
  ['public/db.js', /export const APP_VERSION = '([^']+)'/],
  ['public/sw.js', /const RELEASE = '([^']+)'/],
  ['public/error-reporter.js', /const RELEASE = '([^']+)'/],
  ['desktop/README.txt', /CATERDESK DESKTOP TEST v(\S+)/]
];

const mismatches = sources
  .map(([file, pattern]) => [file, (read(file).match(pattern) || [])[1]])
  .filter(([, found]) => found !== version);

if (mismatches.length) {
  console.error(`package.json is ${version}, but these files differ:`);
  mismatches.forEach(([file, found]) => console.error(`  ${file}: ${found || 'version not found'}`));
  process.exit(1);
}
console.log(version);
