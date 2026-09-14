import { randomUUID } from 'node:crypto';

const LEAD_IMAGE_PATH_PATTERN =
  /^leads\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/i;

export type LeadImageExtension = 'jpg' | 'png' | 'webp';

export function createLeadImageStoragePath(
  leadId: string,
  extension: LeadImageExtension,
  imageId = randomUUID(),
): string {
  const path = `leads/${leadId}/${imageId}.${extension}`;
  assertSafeStoragePath(path);

  return path;
}

export function assertSafeStoragePath(path: string): void {
  if (!LEAD_IMAGE_PATH_PATTERN.test(path) || path.includes('..') || path.includes('\\')) {
    throw new Error('La ruta interna de almacenamiento no es válida.');
  }
}
