import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { Prisma, type CalibrationCase } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { catalogImageUrl, parseCatalogManifest, stableJson } from './catalog-manifest.js';

@Injectable()
export class CatalogImportService {
  constructor(
    @Inject(PrismaService) private readonly prisma: Pick<PrismaService, '$transaction'>,
  ) {}

  async import(input: unknown) {
    const manifest = parseCatalogManifest(input);
    return this.prisma.$transaction(
      async (tx) => {
        // One global import at a time; no artist account owns these cases.
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(7321, 3)`;
        const styles = await tx.tattooStyle.findMany({
          where: { code: { in: [...new Set(manifest.cases.map((item) => item.style))] } },
        });
        const styleIds = new Map(styles.map((style) => [style.code, style.id]));
        const existing = await tx.calibrationCase.findMany({ where: { phase: { not: null } } });
        const byKey = new Map(existing.map((item) => [item.caseKey!, item]));
        const incoming = manifest.cases.map((item) => {
          const styleId = styleIds.get(item.style);
          if (!styleId) throw new ConflictException(`Estilo desconocido: ${item.style}.`);
          const data = {
            caseKey: item.caseId,
            styleId,
            phase: item.phase,
            imageKey: item.image,
            imageUrl: catalogImageUrl(manifest, item.image),
            sizeCm: item.sizeCm,
            colorCoverage: new Prisma.Decimal(item.color.coverage),
            density: item.density.value,
            colorMetadata: item.color.metadata,
            densityMetadata: item.density.metadata,
            catalogVersion: manifest.catalogVersion,
            baseCaseKey: item.baseCaseId,
            displayOrder: item.sortOrder,
            isActive: item.active,
            type: null,
            areaCm2: null,
          } satisfies Prisma.CalibrationCaseUncheckedCreateInput;
          const previous = byKey.get(item.caseId);
          if (previous && (previous.styleId !== styleId || previous.phase !== item.phase))
            throw new ConflictException(
              `No puedes cambiar el estilo o fase del identificador ${item.caseId}.`,
            );
          if (previous?.catalogVersion === manifest.catalogVersion) {
            for (const field of Object.keys(data) as (keyof typeof data)[]) {
              if (stableJson(previous[field]) !== stableJson(data[field]))
                throw new ConflictException(
                  `El caso ${item.caseId} cambió: usa una nueva catalogVersion.`,
                );
            }
          }
          return {
            data,
            isNew: !previous,
            unchanged: !!previous && previous.catalogVersion === manifest.catalogVersion,
          };
        });
        const finalCases = new Map<
          string,
          Pick<
            CalibrationCase,
            | 'caseKey'
            | 'phase'
            | 'styleId'
            | 'imageKey'
            | 'sizeCm'
            | 'colorCoverage'
            | 'colorMetadata'
            | 'baseCaseKey'
          >
        >(existing.map((item) => [item.caseKey!, item]));
        for (const item of incoming) finalCases.set(item.data.caseKey, item.data);
        const filenames = new Set<string>();
        for (const item of finalCases.values()) {
          const imageKey = item.imageKey!.toLowerCase();
          if (filenames.has(imageKey))
            throw new ConflictException(
              `La imagen ${item.imageKey} ya pertenece a otro caso global.`,
            );
          filenames.add(imageKey);
          if (item.phase !== 'B') continue;
          const base = finalCases.get(item.baseCaseKey!);
          if (
            !base ||
            base.phase !== 'A' ||
            base.styleId !== item.styleId ||
            base.sizeCm !== item.sizeCm ||
            !base.colorCoverage.equals(item.colorCoverage) ||
            stableJson(base.colorMetadata) !== stableJson(item.colorMetadata)
          )
            throw new ConflictException(
              `El caso B ${item.caseKey} debe conservar estilo, tamaño y color de su caso A.`,
            );
        }
        // Parents first, independent of the presentation order in the manifest.
        for (const phase of ['A', 'B'] as const) {
          const changed = incoming.filter((item) => item.data.phase === phase && !item.unchanged);
          const additions = changed.filter((item) => item.isNew);
          if (additions.length) {
            await tx.calibrationCase.createMany({ data: additions.map((item) => item.data) });
          }
          for (const item of changed.filter((item) => !item.isNew)) {
            await tx.calibrationCase.update({
              where: { caseKey: item.data.caseKey },
              data: item.data,
            });
          }
        }
        return {
          catalogVersion: manifest.catalogVersion,
          caseCount: incoming.length,
          changedCount: incoming.filter((item) => !item.unchanged).length,
        };
      },
      { timeout: 120_000 },
    );
  }
}
