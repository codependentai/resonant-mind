import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const scanner = resolve('scripts/scan-release.mjs');
const fixtures: string[] = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'release-scan-'));
  fixtures.push(root);
  for (const dir of ['src', 'migrations', 'scripts', 'docs', 'tests', '.github', 'node_modules', 'coverage', 'dist']) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  for (const file of ['package.json', 'wrangler.toml', 'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'LICENSE', 'CHANGELOG.md', 'CODE_OF_CONDUCT.md', 'tsconfig.json']) {
    writeFileSync(join(root, file), '{}');
  }
  return root;
}

function scan(root: string) {
  try {
    return { ok: true, output: execFileSync(process.execPath, [scanner, '--root', root], { encoding: 'utf8' }) };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

afterEach(() => {
  for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('release scanner coverage', () => {
  it.each([
    ['tests', 'tests/leak.test.ts'],
    ['GitHub metadata', '.github/ISSUE_TEMPLATE.md'],
    ['GitHub workflow YAML', '.github/workflows/release.yml'],
    ['changelog', 'CHANGELOG.md'],
  ])('scans %s', (_label, relativePath) => {
    const root = fixture();
    mkdirSync(join(root, relativePath, '..'), { recursive: true });
    writeFileSync(join(root, relativePath), `private person: ${['Ma', 'ry'].join('')}`);

    const result = scan(root);

    expect(result.ok).toBe(false);
    expect(result.output).toContain(relativePath.replace(/\\/g, '/'));
  });

  it('allows only the exact historical CHANGELOG migration notes', () => {
    const root = fixture();
    writeFileSync(join(root, 'CHANGELOG.md'), [
      `- \`for_${['si', 'mon'].join('')}\` context scope renamed to \`for_owner\``,
      `- Basic auth client ID changed from \`${['si', 'mon', '-mind'].join('')}\` to \`resonant-mind\``,
      `- R2 path prefix changed from \`${['si', 'mon', '-mind-images'].join('')}\` to \`resonant-mind-images\` (configurable)`,
    ].join('\n'));

    expect(scan(root).ok).toBe(true);
  });

  it('exempts each exact historical CHANGELOG migration note only once', () => {
    const root = fixture();
    const historicalLine = `- Basic auth client ID changed from \`${['si', 'mon', '-mind'].join('')}\` to \`resonant-mind\``;
    writeFileSync(join(root, 'CHANGELOG.md'), [historicalLine, historicalLine].join('\n'));

    const result = scan(root);

    expect(result.ok).toBe(false);
    expect(result.output).toContain('CHANGELOG.md: private deployment name');
  });

  it('does not follow directory symlinks outside the scan root', () => {
    const root = fixture();
    const outside = fixture();
    writeFileSync(join(outside, 'leak.md'), `private person: ${['Ma', 'ry'].join('')}`);
    symlinkSync(outside, join(root, 'linked-outside'), 'junction');

    expect(scan(root).ok).toBe(true);
  });

  it('does not scan generated or dependency artifacts', () => {
    const root = fixture();
    const privateName = ['Ma', 'ry'].join('');
    writeFileSync(join(root, 'node_modules/dependency.md'), `private person: ${privateName}`);
    writeFileSync(join(root, 'coverage/report.md'), `private person: ${privateName}`);
    writeFileSync(join(root, 'dist/bundle.js'), `private person: ${privateName}`);

    expect(scan(root).ok).toBe(true);
  });
});
