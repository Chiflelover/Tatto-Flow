import { BadRequestException } from '@nestjs/common';
import { MAX_CHAT_IMAGE_SIZE_BYTES } from '../chatbot/chatbot.constants.js';
import { validateLeadImageFile } from './lead-image-file.js';
import { assertSafeStoragePath, createLeadImageStoragePath } from './storage-path.js';

const LEAD_ID = '290f2044-e63c-4e49-8847-067cd62426e4';
const IMAGE_ID = 'bf3b934c-8338-45f3-992f-3ad65c3ce537';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

describe('lead image file validation', () => {
  it.each([
    ['JPEG', 'image/jpeg', JPEG, 'jpg'],
    ['PNG', 'image/png', PNG, 'png'],
    ['WEBP', 'image/webp', WEBP, 'webp'],
  ] as const)('accepts a valid %s signature', (_label, mimeType, content, extension) => {
    expect(validateLeadImageFile({ content, mimeType })).toEqual({
      contentType: mimeType,
      extension,
    });
  });

  it('rejects an image larger than 5 MB', () => {
    expect(() =>
      validateLeadImageFile({
        content: new Uint8Array(MAX_CHAT_IMAGE_SIZE_BYTES + 1),
        mimeType: 'image/png',
      }),
    ).toThrow(new BadRequestException('La imagen no puede superar los 5 MB.'));
  });

  it('rejects an unsupported MIME even when the bytes are a valid PNG', () => {
    expect(() => validateLeadImageFile({ content: PNG, mimeType: 'image/gif' })).toThrow(
      'La referencia debe ser una imagen JPG, PNG o WebP válida.',
    );
  });

  it('rejects a declared MIME that does not match the file signature', () => {
    expect(() => validateLeadImageFile({ content: PNG, mimeType: 'image/jpeg' })).toThrow(
      'La referencia debe ser una imagen JPG, PNG o WebP válida.',
    );
  });

  it('builds a UUID-only path under the expected lead', () => {
    const path = createLeadImageStoragePath(LEAD_ID, 'png', IMAGE_ID);

    expect(path).toBe(`leads/${LEAD_ID}/${IMAGE_ID}.png`);
    expect(path).not.toContain('archivo-del-cliente');
  });

  it('rejects path traversal and arbitrary storage paths', () => {
    expect(() => assertSafeStoragePath(`leads/${LEAD_ID}/../secret.png`)).toThrow();
    expect(() => assertSafeStoragePath('other-folder/image.png')).toThrow();
  });
});
