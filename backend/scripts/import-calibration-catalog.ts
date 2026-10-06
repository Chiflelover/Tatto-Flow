import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';
import { readCatalogImport } from '../src/modules/calibration/catalog-import-files.js';
import { CatalogImportService } from '../src/modules/calibration/catalog-import.service.js';

async function main() {
  const [manifestPath, imageFolder, option] = process.argv.slice(2);
  if (!manifestPath || !imageFolder || process.argv.length > 5 || (option && option !== '--apply'))
    throw new Error(
      'Uso: npm run catalog:import -- <manifest.json> <carpeta-imagenes> [--apply]. Sin --apply solo valida.',
    );
  const manifest = await readCatalogImport(manifestPath, imageFolder);
  if (option !== '--apply') {
    console.log(
      JSON.stringify({
        valid: true,
        catalogVersion: manifest.catalogVersion,
        caseCount: manifest.cases.length,
        persisted: false,
      }),
    );
    return;
  }
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }));
  try {
    console.log(JSON.stringify(await new CatalogImportService(prisma).import(manifest)));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'No se pudo importar el catálogo.');
  process.exitCode = 1;
});
