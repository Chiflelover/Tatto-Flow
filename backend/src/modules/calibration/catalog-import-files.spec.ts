import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { catalogManifestFixture } from '../../../test/fixtures/calibration-catalog.js';
import { readCatalogImport } from './catalog-import-files.js';

describe('catalog image folder validation', () => {
  let folder: string | undefined;
  afterEach(async () => {
    if (folder) await rm(folder, { recursive: true, force: true });
    folder = undefined;
  });

  async function fixture() {
    folder = await mkdtemp(join(tmpdir(), 'tatto-catalog-test-'));
    const manifest = catalogManifestFixture();
    const path = join(folder, 'manifest.json');
    await writeFile(path, JSON.stringify(manifest));
    for (const item of manifest.cases)
      await writeFile(join(folder, item.image), 'test fixture only');
    return { manifest, path, root: folder };
  }

  it('associates all manifest filenames with existing nonempty files', async () => {
    const { path, root, manifest } = await fixture();
    await expect(readCatalogImport(path, root)).resolves.toEqual(manifest);
  });

  it('validates local files independently of their frontend public URL', async () => {
    const { path, root, manifest } = await fixture();
    manifest.imageBaseUrl = '/calibration-assets/v1/Fine_Line/';
    await writeFile(path, JSON.stringify(manifest));
    await expect(readCatalogImport(path, root)).resolves.toEqual(manifest);
  });

  it('runs the CLI in validation mode without importing or uploading', async () => {
    const { path, root } = await fixture();
    const { stdout } = await promisify(execFile)(process.execPath, [
      '../node_modules/tsx/dist/cli.mjs',
      'scripts/import-calibration-catalog.ts',
      path,
      root,
    ]);
    expect(stdout).toContain('"valid":true');
    expect(stdout).toContain('"persisted":false');
  });

  it('rejects a missing image', async () => {
    const { path, root, manifest } = await fixture();
    await rm(join(root, manifest.cases[0].image));
    await expect(readCatalogImport(path, root)).rejects.toThrow();
  });

  it('rejects an empty image', async () => {
    const { path, root, manifest } = await fixture();
    await writeFile(join(root, manifest.cases[0].image), '');
    await expect(readCatalogImport(path, root)).rejects.toThrow(/no vacío/);
  });

  it('rejects a directory masquerading as a filename', async () => {
    const { path, root, manifest } = await fixture();
    const imagePath = join(root, manifest.cases[0].image);
    await rm(imagePath);
    await mkdir(imagePath);
    await expect(readCatalogImport(path, root)).rejects.toThrow(/archivo/);
  });
});
