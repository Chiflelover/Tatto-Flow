import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';

export interface CatalogManifestCase {
  caseId: string;
  image: string;
  style: string;
  phase: 'A' | 'B';
  sizeCm: number;
  color: { coverage: number; metadata: Prisma.JsonObject };
  density: { value: number; metadata: Prisma.JsonObject };
  sortOrder: number;
  active: boolean;
  baseCaseId: string | null;
}

export interface CatalogManifest {
  catalogVersion: string;
  imageBaseUrl: string;
  cases: CatalogManifestCase[];
}

function invalid(message: string): never {
  throw new BadRequestException(`Manifest de calibración no válido: ${message}`);
}

function record(value: unknown, fields: string[], context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(`${context} debe ser un objeto.`);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !fields.includes(key)))
    invalid(`${context} contiene campos desconocidos.`);
  return result;
}

function identifier(value: unknown, context: string): string {
  if (typeof value !== 'string' || !/^[A-Z][A-Z0-9_]{1,63}$/.test(value))
    invalid(`${context} debe ser un identificador estable en mayúsculas.`);
  return value;
}

function number(
  value: unknown,
  context: string,
  min: number,
  max: number,
  positive = false,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (positive && value <= 0)
  )
    invalid(`${context} está fuera del rango permitido.`);
  return value;
}

function isJson(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  return !!value && typeof value === 'object' && Object.values(value).every(isJson);
}

function metadata(value: unknown, context: string): Prisma.JsonObject {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || !isJson(value))
    invalid(`${context} debe ser metadata JSON de objeto.`);
  return value;
}

export function catalogImageUrl(manifest: CatalogManifest, image: string): string {
  const path = image.split('/').map(encodeURIComponent).join('/');
  return manifest.imageBaseUrl.startsWith('/')
    ? `${manifest.imageBaseUrl}${path}`
    : new URL(path, manifest.imageBaseUrl).toString();
}

function parseImageBaseUrl(value: unknown): string {
  if (typeof value !== 'string')
    invalid('imageBaseUrl debe ser una URL HTTPS o un path público relativo.');
  if (value.startsWith('/')) {
    if (!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\/?$/.test(value))
      invalid(
        'imageBaseUrl debe ser un path público relativo sin host, traversal, query ni fragmento.',
      );
    return value.endsWith('/') ? value : `${value}/`;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    invalid('imageBaseUrl debe ser una URL HTTPS o un path público relativo.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    invalid('imageBaseUrl debe ser HTTPS sin credenciales, query ni fragmento.');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.toString();
}

export function parseCatalogManifest(input: unknown): CatalogManifest {
  const root = record(input, ['catalogVersion', 'imageBaseUrl', 'cases'], 'manifest');
  if (
    typeof root.catalogVersion !== 'string' ||
    !root.catalogVersion.trim() ||
    root.catalogVersion.length > 64 ||
    root.catalogVersion !== root.catalogVersion.trim()
  )
    invalid('catalogVersion es obligatorio (máximo 64 caracteres).');
  const imageBaseUrl = parseImageBaseUrl(root.imageBaseUrl);
  if (!Array.isArray(root.cases) || !root.cases.length)
    invalid('cases debe contener al menos un caso.');
  const keys = new Set<string>(),
    images = new Set<string>();
  const cases = root.cases.map((entry: unknown, index: number): CatalogManifestCase => {
    const context = `cases[${index}]`;
    const item = record(
      entry,
      [
        'caseId',
        'image',
        'style',
        'phase',
        'sizeCm',
        'color',
        'density',
        'sortOrder',
        'active',
        'baseCaseId',
      ],
      context,
    );
    const caseId = identifier(item.caseId, `${context}.caseId`);
    if (keys.has(caseId)) invalid(`caseId duplicado: ${caseId}.`);
    keys.add(caseId);
    if (
      typeof item.image !== 'string' ||
      !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.(?:png|jpe?g|webp)$/i.test(item.image)
    )
      invalid(`${context}.image debe ser un path relativo de imagen sin traversal.`);
    if (images.has(item.image.toLowerCase())) invalid(`filename duplicado: ${item.image}.`);
    images.add(item.image.toLowerCase());
    if (item.phase !== 'A' && item.phase !== 'B') invalid(`${context}.phase debe ser A o B.`);
    const color = record(item.color, ['coverage', 'metadata'], `${context}.color`);
    const coverage = number(color.coverage, `${context}.color.coverage`, 0, 1);
    if (new Prisma.Decimal(coverage).decimalPlaces() > 3)
      invalid(`${context}.color.coverage admite hasta tres decimales, como el contrato existente.`);
    const density = record(item.density, ['value', 'metadata'], `${context}.density`);
    if (
      !Number.isInteger(item.sortOrder) ||
      typeof item.sortOrder !== 'number' ||
      item.sortOrder < 0 ||
      item.sortOrder > 2_147_483_647
    )
      invalid(`${context}.sortOrder debe ser un entero no negativo.`);
    if (typeof item.active !== 'boolean') invalid(`${context}.active debe ser booleano.`);
    const baseCaseId =
      item.baseCaseId === undefined || item.baseCaseId === null
        ? null
        : identifier(item.baseCaseId, `${context}.baseCaseId`);
    if (
      (item.phase === 'A' && baseCaseId !== null) ||
      (item.phase === 'B' && (!baseCaseId || baseCaseId === caseId))
    )
      invalid(`${context} necesita una referencia Fase A válida únicamente para Fase B.`);
    return {
      caseId,
      image: item.image,
      style: identifier(item.style, `${context}.style`),
      phase: item.phase,
      sizeCm: number(item.sizeCm, `${context}.sizeCm`, 0, Number.MAX_VALUE, true),
      color: { coverage, metadata: metadata(color.metadata, `${context}.color.metadata`) },
      density: {
        value: number(density.value, `${context}.density.value`, 0, 100),
        metadata: metadata(density.metadata, `${context}.density.metadata`),
      },
      sortOrder: item.sortOrder,
      active: item.active,
      baseCaseId,
    };
  });
  return { catalogVersion: root.catalogVersion, imageBaseUrl, cases };
}

export function stableJson(value: unknown): string {
  if (value instanceof Prisma.Decimal) return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
