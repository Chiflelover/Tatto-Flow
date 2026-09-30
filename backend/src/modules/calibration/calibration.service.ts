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
  interpolatePrice,
  type ModelParameters,
  type ModelPoint,
} from './model-interpolation.js';

interface CaseSnapshot {
  id: string;
  imageUrl: string;
  type: 'AREA' | 'COLOR';
  areaCm2: number;
  colorCoverage: number;
  displayOrder: number;
}

function snapshot(value: Prisma.JsonValue): CaseSnapshot[] {
  return value as unknown as CaseSnapshot[];
}

@Injectable()
export class CalibrationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listStyles(accountId: string) {
    const styles = await this.prisma.tattooStyle.findMany({
      where: { isActive: true },
      include: {
        artistStyles: { where: { accountId }, select: { isEnabled: true } },
        cases: { where: { isActive: true }, select: { id: true } },
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
      caseCount: style.cases.length,
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

  async startDraft(accountId: string, styleId: string) {
    const id = await this.prisma.$transaction(async (tx) => {
      await this.lockAccount(tx, accountId);
      await this.requireEnabledStyle(tx, accountId, styleId);
      const existing = await tx.pricingModelVersion.findFirst({
        where: { accountId, styleId, status: PricingModelStatus.DRAFT },
      });
      if (existing) return existing.id;
      const cases = await tx.calibrationCase.findMany({
        where: { styleId, isActive: true },
        orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      });
      if (!cases.length)
        throw new ConflictException('Todavía no hay imágenes de calibración para este estilo.');
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
          caseSnapshot: cases.map((item) => ({
            id: item.id,
            imageUrl: item.imageUrl,
            type: item.type,
            areaCm2: Number(item.areaCm2),
            colorCoverage: Number(item.colorCoverage),
            displayOrder: item.displayOrder,
          })),
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
        style: { select: { name: true } },
      },
    });
    if (!draft) return null;
    const answers = new Map(
      draft.answers.map((answer) => [answer.caseId, answer.pricePen.toFixed(2)]),
    );
    const cases = snapshot(draft.caseSnapshot);
    return {
      id: draft.id,
      styleId,
      styleName: draft.style.name,
      version: draft.version,
      answeredCount: answers.size,
      totalCount: cases.length,
      cases: cases.map((item, index) => ({
        id: item.id,
        imageUrl: item.imageUrl,
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
      await this.requireEnabledStyle(tx, accountId, styleId);
      const draft = await tx.pricingModelVersion.findFirst({
        where: { accountId, styleId, status: PricingModelStatus.DRAFT },
      });
      if (!draft) throw new NotFoundException('Inicia la calibración de este estilo.');
      if (!snapshot(draft.caseSnapshot).some((item) => item.id === caseId))
        throw new NotFoundException('Caso no pertenece a esta calibración.');
      await tx.calibrationAnswer.upsert({
        where: { modelVersionId_caseId: { modelVersionId: draft.id, caseId } },
        create: { modelVersionId: draft.id, caseId, pricePen: price },
        update: { pricePen: price },
      });
    });
    return this.getDraft(accountId, styleId);
  }

  async activate(accountId: string, styleId: string) {
    return this.prisma.$transaction(async (tx) => {
      const account = await this.lockAccount(tx, accountId);
      await this.requireEnabledStyle(tx, accountId, styleId);
      const draft = await tx.pricingModelVersion.findFirst({
        where: { accountId, styleId, status: PricingModelStatus.DRAFT },
        include: { answers: true },
      });
      if (!draft) throw new NotFoundException('No hay calibración pendiente.');
      const cases = snapshot(draft.caseSnapshot);
      const prices = new Map(
        draft.answers.map((answer) => [answer.caseId, answer.pricePen.toFixed(2)]),
      );
      if (
        !cases.length ||
        prices.size !== cases.length ||
        cases.some((item) => !prices.has(item.id))
      )
        throw new ConflictException('Responde todos los casos antes de activar el modelo.');
      let parameters: ModelParameters;
      try {
        parameters = buildModel(
          cases.map((item): ModelPoint => ({
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
          algorithmVersion: ALGORITHM_VERSION,
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

  async calculatePrice(accountId: string, styleId: string, areaCm2: number, colorCoverage: number) {
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
    if (model.algorithmVersion !== ALGORITHM_VERSION)
      return {
        applicable: false as const,
        reason: 'MODEL_NOT_APPLICABLE' as const,
        modelVersionId: model.id,
      };
    const result = interpolatePrice(
      model.modelParameters as unknown as ModelParameters,
      areaCm2,
      colorCoverage,
      model.adjustmentPercent.toString(),
    );
    return { ...result, modelVersionId: model.id };
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
