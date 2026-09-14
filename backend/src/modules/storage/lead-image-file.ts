import { BadRequestException } from '@nestjs/common';
import { MAX_CHAT_IMAGE_SIZE_BYTES } from '../chatbot/chatbot.constants.js';
import type { TattooImageInput } from '../image-analysis/domain/image-analysis.types.js';
import type { LeadImageExtension } from './storage-path.js';

const INVALID_IMAGE_MESSAGE = 'La referencia debe ser una imagen JPG, PNG o WebP válida.';

interface ValidatedLeadImage {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  extension: LeadImageExtension;
}

export function validateLeadImageFile(image: TattooImageInput): ValidatedLeadImage {
  if (image.content.byteLength === 0) {
    throw new BadRequestException(INVALID_IMAGE_MESSAGE);
  }

  if (image.content.byteLength > MAX_CHAT_IMAGE_SIZE_BYTES) {
    throw new BadRequestException('La imagen no puede superar los 5 MB.');
  }

  const mimeType = image.mimeType.toLowerCase();
  const detectedMimeType = detectMimeType(image.content);

  if (mimeType !== detectedMimeType) {
    throw new BadRequestException(INVALID_IMAGE_MESSAGE);
  }

  switch (detectedMimeType) {
    case 'image/jpeg':
      return { contentType: detectedMimeType, extension: 'jpg' };
    case 'image/png':
      return { contentType: detectedMimeType, extension: 'png' };
    case 'image/webp':
      return { contentType: detectedMimeType, extension: 'webp' };
    default:
      throw new BadRequestException(INVALID_IMAGE_MESSAGE);
  }
}

function detectMimeType(content: Uint8Array): ValidatedLeadImage['contentType'] | null {
  if (
    content.length >= 4 &&
    content[0] === 0xff &&
    content[1] === 0xd8 &&
    content[2] === 0xff &&
    content.at(-2) === 0xff &&
    content.at(-1) === 0xd9
  ) {
    return 'image/jpeg';
  }

  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  if (
    content.length >= pngSignature.length &&
    pngSignature.every((byte, index) => content[index] === byte)
  ) {
    return 'image/png';
  }

  if (content.length >= 12 && ascii(content, 0, 4) === 'RIFF' && ascii(content, 8, 12) === 'WEBP') {
    return 'image/webp';
  }

  return null;
}

function ascii(content: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...content.slice(start, end));
}
