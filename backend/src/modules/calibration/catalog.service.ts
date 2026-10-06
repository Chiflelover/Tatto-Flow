import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type {
  CreateCaseDto,
  CreateStyleDto,
  UpdateCaseDto,
  UpdateStyleDto,
} from './calibration.dto.js';

@Injectable()
export class CatalogService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  listStyles() {
    return this.prisma.tattooStyle.findMany({ orderBy: { code: 'asc' } });
  }

  async createStyle(dto: CreateStyleDto) {
    const name = dto.name.trim();
    if (!name) throw new ConflictException('El estilo necesita un nombre.');
    try {
      return await this.prisma.tattooStyle.create({ data: { code: dto.code, name } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Ese código de estilo ya existe.');
      throw error;
    }
  }

  async updateStyle(id: string, dto: UpdateStyleDto) {
    const name = dto.name?.trim();
    if (dto.name !== undefined && !name)
      throw new ConflictException('El estilo necesita un nombre.');
    const existing = await this.prisma.tattooStyle.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Estilo no encontrado.');
    return this.prisma.tattooStyle.update({
      where: { id },
      data: { name, isActive: dto.isActive },
    });
  }

  async listCases(styleId: string) {
    await this.requireStyle(styleId);
    return this.prisma.calibrationCase.findMany({
      where: { styleId },
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
    });
  }

  async createCase(styleId: string, dto: CreateCaseDto) {
    await this.requireStyle(styleId);
    return this.prisma.calibrationCase.create({ data: { styleId, ...dto } });
  }

  async updateCase(id: string, dto: UpdateCaseDto) {
    const existing = await this.prisma.calibrationCase.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Caso no encontrado.');
    if (
      existing.phase &&
      Object.keys(dto).some((key) => key !== 'isActive' && key !== 'displayOrder')
    )
      throw new ConflictException(
        'La metadata de un caso A/B se actualiza con un manifest versionado.',
      );
    return this.prisma.calibrationCase.update({ where: { id }, data: dto });
  }

  private async requireStyle(id: string) {
    const style = await this.prisma.tattooStyle.findUnique({ where: { id } });
    if (!style) throw new NotFoundException('Estilo no encontrado.');
    return style;
  }
}
