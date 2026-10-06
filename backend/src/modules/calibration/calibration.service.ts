import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  PricingModelStatus,
  Prisma,
  type PricingModelVersion,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  ALGORITHM_VERSION,
  buildModel,
  type ModelParameters,
  type ModelPoint,
} from './model-interpolation.js';
import {
  freezeCase,
  readCaseSnapshot as snapshot,
  snapshotCatalog,
  type AreaColorSnapshot,
  type CaseSnapshot,
  type CalibrationCatalog,
  type PhasedCaseSnapshot,
} from './calibration-snapshot.js';
import {
  buildCatalogABModel,
  CATALOG_AB_ALGORITHM_VERSION,
  type CatalogABModelParameters,
} from './catalog-ab-interpolation.js';
import { calculateModelPrice } from './pricing-model-dispatch.js';

@Injectable()
export class CalibrationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listStyles(accountId: string) {
    const styles = await this.prisma.tattooStyle.findMany({
      where: { isActive: true },
      include: {
        artistStyles: { where: { accountId }, select: { isEnabled: true } },
        cases: { where: { isActive: true }, select: { id: true, phase: true } },
        modelVersions: {
          where: { accountId, status: PricingModelStatus.ACTIVE },
          select: { id: true, version: true },
        },
      },
      orderBy: { name: 'asc' },
    });
    return styles.map((style) => ({
      id: style.id,
      code: style.code,
      name: style.name,
      enabled: style.artistStyles[0]?.isEnabled ?? false,
      caseCount: style.code === 'FINE_LINE' ? 0 : style.cases.filter((item) => !item.phase).length,
      catalogCaseCount: style.cases.filter((item) => !!item.phase).length,
      activeVersion: style.modelVersions[0]?.version ?? null,
    }));
  }

  async setStyle(accountId: string, styleId: string, enabled: boolean) {
    const style = await this.prisma.tattooStyle.findUnique({ where: { id: styleId } });
    if (!style || (enabled && !style.isActive))
      throw new NotFoundException('Estilo no disponible.');
    await this.prisma.artistStyle.upsert({
      where: { accountId_styleId: { accountId, styleId } },
      create: { accountId, styleId, isEnabled: enabled },
      update: { isEnabled: enabled },
    });
    return { styleId, enabled };
  }

  async listCases(accountId: string, styleId: string, catalog: CalibrationCatalog = 'AREA_COLOR') {
    const style = await this.requireEnabledStyle(this.prisma, accountId, styleId);
    catalog = this.currentCatalog(style.code, catalog);
    const cases = await this.prisma.calibrationCase.findMany({
      where: { styleId, isActive: true, phase: catalog === 'PHASED' ? { not: null } : null },
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
    });
    return cases.map((item) => freezeCase(item, style.code));
  }

  async startDraft(
    accountId: string,
    styleId: string,
    catalog: CalibrationCatalog = 'AREA_COLOR',
    restart = false,
  ) {
    const id = await this.prisma.$transaction(async (tx) => {
      await this.lockAccount(tx, accountId);
      const style = await this.requireEnabledStyle(tx, accountId, styleId);
      catalog = this.currentCatalog(style.code, catalog);
      const existing = await tx.pricingModelVersion.findFirst({
        where: { accountId, styleId, status: PricingModelStatus.DRAFT },
        include: { answers: { select: { caseId: true, pricePen: true } } },
      });
      const retiredDraft =
        existing &&
        style.code === 'FINE_LINE' &&
        snapshotCatalog(snapshot(existing.caseSnapshot)) !== 'PHASED';
      if (existing && !restart && !retiredDraft) {
        const frozen = snapshot(existing.caseSnapshot);
        if (snapshotCatalog(frozen) !== catalog)
          throw new ConflictException('Ya existe un borrador de otro catálogo para este estilo.');
        if (catalog === 'PHASED' && existing.algorithmVersion === 'CATALOG_AB_PENDING') {
          const prices = new Map(
            existing.answers.map((answer) => [answer.caseId, answer.pricePen.toFixed(2)]),
          );
          if (prices.size === frozen.length) {
            let parameters: CatalogABModelParameters | null = null;
            try {
              parameters = this.buildPhased(frozen as PhasedCaseSnapshot[], prices, styleId);
            } catch {
              /* Preserve completed answers when the catalog requires review. */
            }
            if (parameters)
              await tx.pricingModelVersion.update({
                where: { id: existing.id },
                data: {
                  algorithmVersion: CATALOG_AB_ALGORITHM_VERSION,
                  modelParameters: parameters as unknown as Prisma.InputJsonValue,
                },
              });
          }
        }
        return existing.id;
      }
      const cases = await tx.calibrationCase.findMany({
        where: { styleId, isActive: true, phase: catalog === 'PHASED' ? { not: null } : null },
        orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      });
      if (!cases.length)
        throw new ConflictException('Todavía no hay imágenes de calibración para este estilo.');
      if (existing)
        await tx.pricingModelVersion.update({
          where: { id: existing.id },
          data: { status: PricingModelStatus.SUPERSEDED },
        });
      const latest = await tx.pricingModelVersion.findFirst({
        where: { accountId, styleId },
        orderBy: { version: 'desc' },
      });
      const active = await tx.pricingModelVersion.findFirst({
        where: { accountId, styleId, status: PricingModelStatus.ACTIVE },
      });
      const draft = await tx.pricingModelVersion.create({
        data: {
          accountId,
          styleId,
          version: (latest?.version ?? 0) + 1,
          sourceVersionId: active?.id,
          ...(catalog === 'PHASED' ? { algorithmVersion: 'CATALOG_AB_PENDING' } : {}),
          caseSnapshot: cases.map((item) =>
            freezeCase(item, style.code),
          ) as unknown as Prisma.InputJsonValue,
        },
      });
      return draft.id;
    });
    return this.getDraft(accountId, styleId, id);
  }

  async getDraft(accountId: string, styleId: string, id?: string) {
    const draft = await this.prisma.pricingModelVersion.findFirst({
      where: { accountId, styleId, status: PricingModelStatus.DRAFT, ...(id ? { id } : {}) },
      include: {
        answers: { select: { caseId: true, pricePen: true } },
        style: { select: { name: true, code: true } },
      },
    });
    if (!draft) return null;
    const answers = new Map(
      draft.answers.map((answer) => [answer.caseId, answer.pricePen.toFixed(2)]),
    );
    const cases = snapshot(draft.caseSnapshot);
    if (draft.style.code === 'FINE_LINE' && snapshotCatalog(cases) !== 'PHASED') return null;
    let phasedParameters: CatalogABModelParameters | null = null;
    if (snapshotCatalog(cases) === 'PHASED' && answers.size === cases.length) {
      try {
        phasedParameters = this.buildPhased(cases as PhasedCaseSnapshot[], answers, styleId);
      } catch {
        /* The draft remains editable when the catalog cannot build a model. */
      }
    }
    return {
      id: draft.id,
      styleId,
      styleName: draft.style.name,
      version: draft.version,
      answeredCount: answers.size,
      totalCount: cases.length,
      catalogFormat: snapshotCatalog(cases),
      canActivate: snapshotCatalog(cases) === 'AREA_COLOR' || phasedParameters !== null,
      calibrationError:
        snapshotCatalog(cases) === 'PHASED' && answers.size === cases.length && !phasedParameters
          ? 'La calibración requiere revisión antes de activar el modelo. Contacta al administrador.'
          : null,
      cases: cases.map((item, index) => ({
        ...item,
        position: index + 1,
        pricePen: answers.get(item.id) ?? null,
      })),
    };
  }

  async saveAnswer(accountId: string, styleId: string, caseId: string, price: number) {
    if (!Number.isFinite(price) || price <= 0 || price > 99_999_999.99)
      throw new ConflictException('Ingresa un precio válido en PEN.');
    await this.prisma.$transaction(async (tx) => {
      await this.lockAccount(tx, accountId);
      const style = await this.requireEnabledStyle(tx, accountId, styleId);
      const draft = await tx.pricingModelVersion.findFirst({
        where: { accountId, styleId, status: PricingModelStatus.DRAFT },
        include: { answers: { select: { caseId: true, pricePen: true } } },
      });
      if (!draft) throw new NotFoundException('Inicia la calibración de este estilo.');
      this.requireCurrentCatalog(style.code, snapshot(draft.caseSnapshot));
      if (!snapshot(draft.caseSnapshot).some((item) => item.id === caseId))
        throw new NotFoundException('Caso no pertenece a esta calibración.');
      const saved = await tx.calibrationAnswer.upsert({
        where: { modelVersionId_caseId: { modelVersionId: draft.id, caseId } },
        create: { modelVersionId: draft.id, caseId, pricePen: price },
        update: { pricePen: price },
      });
      const frozen = snapshot(draft.caseSnapshot);
      if (snapshotCatalog(frozen) === 'PHASED') {
        const prices = new Map(
          draft.answers.map((answer) => [answer.caseId, answer.pricePen.toFixed(2)]),
        );
        prices.set(caseId, saved.pricePen.toFixed(2));
        let parameters: CatalogABModelParameters | null = null;
        if (prices.size === frozen.length) {
          try {
            parameters = this.buildPhased(frozen as PhasedCaseSnapshot[], prices, styleId);
          } catch {
            /* Keep all artist answers for correction or catalog review. */
          }
        }
        await tx.pricingModelVersion.update({
          where: { id: draft.id },
          data: {
            algorithmVersion: parameters ? CATALOG_AB_ALGORITHM_VERSION : 'CATALOG_AB_PENDING',
            modelParameters: parameters
              ? (parameters as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
          },
        });
      }
    });
    return this.getDraft(accountId, styleId);
  }

  async activate(accountId: string, styleId: string) {
    return this.prisma.$transaction(async (tx) => {
      const account = await this.lockAccount(tx, accountId);
      const style = await this.requireEnabledStyle(tx, accountId, styleId);
      const draft = await tx.pricingModelVersion.findFirst({
        where: { accountId, styleId, status: PricingModelStatus.DRAFT },
        include: { answers: true },
      });
      if (!draft) throw new NotFoundException('No hay calibración pendiente.');
      const frozen = snapshot(draft.caseSnapshot);
      this.requireCurrentCatalog(style.code, frozen);
      const prices = new Map(
        draft.answers.map((answer) => [answer.caseId, answer.pricePen.toFixed(2)]),
      );
      if (
        !frozen.length ||
        prices.size !== frozen.length ||
        frozen.some((item) => !prices.has(item.id))
      )
        throw new ConflictException('Responde todos los casos antes de activar el modelo.');
      let parameters: ModelParameters | CatalogABModelParameters;
      try {
        parameters =
          snapshotCatalog(frozen) === 'PHASED'
            ? this.buildPhased(frozen as PhasedCaseSnapshot[], prices, styleId)
            : buildModel(
                (frozen as AreaColorSnapshot[]).map((item): ModelPoint => ({
                  caseId: item.id,
                  type: item.type,
                  areaCm2: item.areaCm2,
                  colorCoverage: item.colorCoverage,
                  pricePen: prices.get(item.id)!,
                })),
              );
      } catch (error) {
        throw new ConflictException(
          error instanceof Error ? error.message : 'Calibración no aplicable.',
        );
      }
      const active = await tx.pricingModelVersion.findFirst({
        where: { accountId, styleId, status: PricingModelStatus.ACTIVE },
      });
      const latest = await tx.pricingModelVersion.findFirst({
        where: { accountId, styleId },
        orderBy: { version: 'desc' },
      });
      if (active)
        await tx.pricingModelVersion.update({
          where: { id: active.id },
          data: { status: PricingModelStatus.SUPERSEDED },
        });
      const version = latest!.id === draft.id ? draft.version : latest!.version + 1;
      const result = await tx.pricingModelVersion.update({
        where: { id: draft.id },
        data: {
          version,
          status: PricingModelStatus.ACTIVE,
          activatedAt: new Date(),
          modelParameters: parameters as unknown as Prisma.InputJsonValue,
          algorithmVersion: parameters.algorithmVersion,
          adjustmentPercent: account.adjustmentPercent,
          sourceVersionId: active?.id ?? null,
        },
      });
      return this.versionView(result);
    });
  }

  async listModels(accountId: string) {
    const models = await this.prisma.pricingModelVersion.findMany({
      where: { accountId },
      include: { style: { select: { name: true, code: true } } },
      orderBy: [{ styleId: 'asc' }, { version: 'desc' }],
    });
    return models.map((model) => ({
      ...this.versionView(model),
      styleName: model.style.name,
      styleCode: model.style.code,
    }));
  }

  async getAdjustment(accountId: string) {
    const account = await this.prisma.tattooArtistAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    return { percent: account.adjustmentPercent.toFixed(2) };
  }

  async setAdjustment(accountId: string, percent: number) {
    if (!Number.isFinite(percent) || percent <= -100 || percent > 1000)
      throw new ConflictException('Ajuste porcentual no válido.');
    return this.prisma.$transaction(async (tx) => {
      const account = await this.lockAccount(tx, accountId);
      if (account.adjustmentPercent.equals(percent))
        return { percent: account.adjustmentPercent.toFixed(2), newVersions: 0 };
      const active = await tx.pricingModelVersion.findMany({
        where: { accountId, status: PricingModelStatus.ACTIVE },
        include: { answers: true },
      });
      await tx.tattooArtistAccount.update({
        where: { id: accountId },
        data: { adjustmentPercent: percent },
      });
      for (const previous of active) {
        const latest = await tx.pricingModelVersion.findFirst({
          where: { accountId, styleId: previous.styleId },
          orderBy: { version: 'desc' },
        });
        await tx.pricingModelVersion.update({
          where: { id: previous.id },
          data: { status: PricingModelStatus.SUPERSEDED },
        });
        await tx.pricingModelVersion.create({
          data: {
            accountId,
            styleId: previous.styleId,
            version: (latest?.version ?? 0) + 1,
            status: PricingModelStatus.ACTIVE,
            activatedAt: new Date(),
            sourceVersionId: previous.id,
            adjustmentPercent: percent,
            caseSnapshot: previous.caseSnapshot as Prisma.InputJsonValue,
            modelParameters: previous.modelParameters as Prisma.InputJsonValue,
            algorithmVersion: previous.algorithmVersion,
            answers: {
              create: previous.answers.map((answer) => ({
                caseId: answer.caseId,
                pricePen: answer.pricePen,
              })),
            },
          },
        });
      }
      return { percent: percent.toFixed(2), newVersions: active.length };
    });
  }

  async calculatePrice(
    accountId: string,
    styleId: string,
    measurements:
      number | { targetSizeCm: number; colorCoverage: number; estimatedDensity: number },
    colorCoverage?: number,
  ) {
    const model = await this.prisma.pricingModelVersion.findFirst({
      where: {
        accountId,
        styleId,
        status: PricingModelStatus.ACTIVE,
        style: { isActive: true, artistStyles: { some: { accountId, isEnabled: true } } },
      },
    });
    if (!model || !model.modelParameters)
      return { applicable: false as const, reason: 'NO_ACTIVE_MODEL' as const };
    if (
      model.algorithmVersion !== ALGORITHM_VERSION &&
      model.algorithmVersion !== CATALOG_AB_ALGORITHM_VERSION
    )
      return {
        applicable: false as const,
        reason: 'MODEL_NOT_APPLICABLE' as const,
        modelVersionId: model.id,
      };
    const result = calculateModelPrice(
      model.algorithmVersion,
      model.modelParameters,
      typeof measurements === 'number'
        ? { styleId, areaCm2: measurements, colorCoverage: colorCoverage ?? NaN }
        : { styleId, ...measurements },
      model.adjustmentPercent.toString(),
    );
    return { ...result, modelVersionId: model.id };
  }

  private buildPhased(cases: PhasedCaseSnapshot[], prices: Map<string, string>, styleId: string) {
    const parameters = buildCatalogABModel(
      cases.map((item) => ({ ...item, pricePen: prices.get(item.id)! })),
    );
    if (parameters.styleId !== styleId)
      throw new Error('Las referencias no pertenecen a este estilo.');
    return parameters;
  }

  private currentCatalog(styleCode: string, catalog: CalibrationCatalog): CalibrationCatalog {
    return styleCode === 'FINE_LINE' ? 'PHASED' : catalog;
  }

  private requireCurrentCatalog(styleCode: string, cases: CaseSnapshot[]) {
    if (styleCode === 'FINE_LINE' && snapshotCatalog(cases) !== 'PHASED')
      throw new ConflictException(
        'Fine Line usa las referencias actuales. Inicia una nueva calibración.',
      );
  }

  private async lockAccount(tx: Prisma.TransactionClient, accountId: string) {
    await tx.$queryRaw`SELECT id FROM tattoo_artist_accounts WHERE id = ${accountId}::uuid FOR UPDATE`;
    const account = await tx.tattooArtistAccount.findUnique({ where: { id: accountId } });
    if (!account || !account.isActive) throw new NotFoundException('Cuenta no disponible.');
    return account;
  }

  private async requireEnabledStyle(
    tx: Prisma.TransactionClient,
    accountId: string,
    styleId: string,
  ) {
    const selection = await tx.artistStyle.findUnique({
      where: { accountId_styleId: { accountId, styleId } },
      include: { style: true },
    });
    if (!selection?.isEnabled || !selection.style.isActive)
      throw new NotFoundException('Este estilo no está habilitado para tu cuenta.');
    return selection.style;
  }

  private versionView(model: PricingModelVersion) {
    return {
      id: model.id,
      styleId: model.styleId,
      version: model.version,
      status: model.status,
      algorithmVersion: model.algorithmVersion,
      adjustmentPercent: model.adjustmentPercent.toFixed(2),
      sourceVersionId: model.sourceVersionId,
      createdAt: model.createdAt.toISOString(),
      activatedAt: model.activatedAt?.toISOString() ?? null,
    };
  }
}
