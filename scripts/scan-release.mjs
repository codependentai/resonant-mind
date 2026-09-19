import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('..', import.meta.url));
const rootArg = process.argv.indexOf('--root');
const root = rootArg >= 0 ? resolve(process.argv[rootArg + 1]) : defaultRoot;
const ignoredDirectories = new Set(['.git', '.wrangler', 'node_modules', 'coverage', 'dist', 'build']);
const ignoredFiles = new Set(['package-lock.json']);
const allowedChangelogLines = new Set([
  '- `for_simon` context scope renamed to `for_owner`',
  '- Basic auth client ID changed from `simon-mind` to `resonant-mind`',
  '- R2 path prefix changed from `simon-mind-images` to `resonant-mind-images` (configurable)',
]);
const forbiddenPaths = [/^dashboard\//, /^_archive\//, /(?:^|\/)\.env(?:\.|$)/, /snapshot/i];
const forbiddenContent = [
  { label: 'private person name', re: /\b(?:Mary|Simon|Ghost|Jace|Julia|Wren|Mason|Iris|Ward|Hale|Quill|Reeve|Vale)\b/i },
  { label: 'private domain', re: /(?:valevault|simonmind)/i },
  { label: 'private tenant binding', re: /(?:HYPERDRIVE_GHOST|R2_IMAGES_GHOST|GHOST_MIND_API_KEY|GHOST_MCP_CONNECTOR_SECRET)/ },
  { label: 'private deployment name', re: /(?:simon-mind|ghost-mind|wild-pond|jolly-haze)/i },
  { label: 'Cloudflare resource id', re: /\b[a-f0-9]{32}\b/i },
  { label: 'private raw sensorium contract', re: /(?:environment:house|\/api\/drives\/env|cycleAgeMin|missedFirstMeal|hoursSinceLastReach)/i },
  { label: 'private image operations', re: /(?:\/api\/admin\/r2|r2-delete-keys|image-diff|_tmp_)/i },
  { label: 'hard-coded private location', re: /(?:Europe\/London|Cardiff,?\s*(?:UK|Wales)?)/i },
];

async function walk(path) {
  const out = [];
  for (const name of await readdir(path)) {
    if (ignoredFiles.has(name)) continue;
    const full = join(path, name);
    const info = await lstat(full);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory() && !ignoredDirectories.has(name)) out.push(...await walk(full));
    else if (!info.isDirectory()) out.push(full);
  }
  return out;
}

const files = await walk(root);
const failures = [];
for (const file of files) {
  const rel = relative(root, file).replace(/\\/g, '/');
  if (forbiddenPaths.some((re) => re.test(rel))) failures.push(`${rel}: forbidden path`);
  if (rel === 'scripts/scan-release.mjs') continue;
  if (!/\.(?:ts|js|mjs|json|toml|sql|md|ya?ml)$/.test(file)) continue;
  let text = await readFile(file, 'utf8');
  if (rel === 'CHANGELOG.md') {
    const remainingAllowances = new Set(allowedChangelogLines);
    text = text.split(/\r?\n/).filter((line) => !remainingAllowances.delete(line)).join('\n');
  }
  for (const rule of forbiddenContent) if (rule.re.test(text)) failures.push(`${rel}: ${rule.label}`);
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`release scan clean (${files.length} files)`);
