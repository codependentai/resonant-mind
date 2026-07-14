import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const roots = ['src', 'migrations', 'scripts', 'docs'];
const configFiles = ['package.json', 'wrangler.toml', 'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'LICENSE'];
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
    const full = join(path, name);
    const info = await stat(full);
    if (info.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

const files = [...configFiles.map((name) => join(root, name))];
for (const dir of roots) files.push(...await walk(join(root, dir)));
const failures = [];
for (const file of files) {
  const rel = relative(root, file).replace(/\\/g, '/');
  if (forbiddenPaths.some((re) => re.test(rel))) failures.push(`${rel}: forbidden path`);
  if (rel === 'scripts/scan-release.mjs') continue;
  if (!/\.(?:ts|js|mjs|json|toml|sql|md)$/.test(file)) continue;
  const text = await readFile(file, 'utf8');
  for (const rule of forbiddenContent) if (rule.re.test(text)) failures.push(`${rel}: ${rule.label}`);
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`release scan clean (${files.length} files)`);
