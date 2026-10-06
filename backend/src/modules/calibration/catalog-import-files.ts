import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { parseCatalogManifest } from './catalog-manifest.js';

export async function readCatalogImport(manifestPath: string, imageFolder: string) {
  const manifest = parseCatalogManifest(
    JSON.parse(await readFile(manifestPath, 'utf8')) as unknown,
  );
  const root = await realpath(imageFolder);
  if (!(await stat(root)).isDirectory())
    throw new Error('La carpeta de imágenes no es un directorio.');
  for (const item of manifest.cases) {
    const path = await realpath(resolve(root, ...item.image.split('/')));
    const fromRoot = relative(root, path);
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot))
      throw new Error(`La imagen ${item.image} sale de la carpeta del catálogo.`);
    const file = await stat(path);
    if (!file.isFile() || file.size === 0)
      throw new Error(`La imagen ${item.image} debe ser un archivo no vacío.`);
  }
  return manifest;
}
