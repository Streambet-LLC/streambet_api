/**
 * Switch the local .env between environments:
 *
 *   npm run env:staging   → .env.staging    copied to .env
 *   npm run env:prod      → .env.production copied to .env
 *
 * .env is what the app, the TypeORM CLI and the scripts all load, so this is
 * the one switch. Edit .env.staging / .env.production, not .env — it's
 * overwritten on every switch (a .env with hand edits is first saved to
 * .env.previous so nothing is lost).
 */
const fs = require('fs');
const path = require('path');

const SOURCES = {
  staging: '.env.staging',
  production: '.env.production',
  prod: '.env.production',
};
const HEADER = '# GENERATED from ';

const name = process.argv[2];
const source = SOURCES[name];
if (!source) {
  console.error('Usage: node scripts/use-env.js <staging|production>');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const sourcePath = path.join(root, source);
const envPath = path.join(root, '.env');
if (!fs.existsSync(sourcePath)) {
  console.error(`${source} not found in ${root}`);
  process.exit(1);
}
const body = fs.readFileSync(sourcePath, 'utf8');

// Don't silently lose hand edits made directly to .env.
if (fs.existsSync(envPath)) {
  const current = fs.readFileSync(envPath, 'utf8');
  const withoutHeader = current.startsWith(HEADER)
    ? current.slice(current.indexOf('\n') + 1)
    : current;
  const matchesASource = Object.values(SOURCES).some((f) => {
    const p = path.join(root, f);
    return fs.existsSync(p) && fs.readFileSync(p, 'utf8') === withoutHeader;
  });
  if (!matchesASource) {
    fs.copyFileSync(envPath, path.join(root, '.env.previous'));
    console.log('Your .env had changes not in either source file; saved a copy to .env.previous');
  }
}

fs.writeFileSync(
  envPath,
  `${HEADER}${source} by \`npm run env:${name}\` — edit ${source}, not this file.\n${body}`,
);
const db = (body.match(/^DB_DATABASE=(.*)$/m) || [])[1];
console.log(`.env is now ${name.toUpperCase()} (database: ${db ? db.trim() : 'unset'})`);
