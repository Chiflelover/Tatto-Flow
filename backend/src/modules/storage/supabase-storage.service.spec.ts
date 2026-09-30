const supabaseMocks = vi.hoisted(() => ({
  getBucket: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  exists: vi.fn(),
  createSignedUrl: vi.fn(),
  download: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    storage: {
      getBucket: supabaseMocks.getBucket,
      from: vi.fn(() => ({
        upload: supabaseMocks.upload,
        remove: supabaseMocks.remove,
        exists: supabaseMocks.exists,
        createSignedUrl: supabaseMocks.createSignedUrl,
        download: supabaseMocks.download,
      })),
    },
  })),
}));

import { SupabaseStorageService } from './supabase-storage.service.js';

const PATH = 'leads/290f2044-e63c-4e49-8847-067cd62426e4/bf3b934c-8338-45f3-992f-3ad65c3ce537.png';

describe('SupabaseStorageService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploads to the private bucket with overwrite disabled', async () => {
    supabaseMocks.upload.mockResolvedValue({ data: { path: PATH }, error: null });
    const storage = new SupabaseStorageService(
      'https://project-ref.supabase.co',
      'backend-secret',
      'tattoo-references',
    );
    const content = new Uint8Array([1, 2, 3]);

    await storage.upload({ path: PATH, content, contentType: 'image/png' });

    expect(supabaseMocks.upload).toHaveBeenCalledWith(PATH, content, {
      cacheControl: '3600',
      contentType: 'image/png',
      upsert: false,
    });
  });

  it('refuses to initialize against a public bucket', async () => {
    supabaseMocks.getBucket.mockResolvedValue({
      data: { id: 'tattoo-references', public: true },
      error: null,
    });
    const storage = new SupabaseStorageService(
      'https://project-ref.supabase.co',
      'backend-secret',
      'tattoo-references',
    );

    await expect(storage.verifyPrivateBucket()).rejects.toThrow(
      'El bucket de referencias debe existir y permanecer privado.',
    );
  });

  it('treats the SDK not-found response as a missing object', async () => {
    supabaseMocks.exists.mockResolvedValue({
      data: false,
      error: new Error('not found'),
    });
    const storage = new SupabaseStorageService(
      'https://project-ref.supabase.co',
      'backend-secret',
      'tattoo-references',
    );

    await expect(storage.exists(PATH)).resolves.toBe(false);
  });

  it('downloads bytes with the backend credentials, bounded time and no signed URL', async () => {
    const content = new Uint8Array([1, 2, 3]);
    supabaseMocks.download.mockResolvedValue({
      data: new Blob([content], { type: 'image/png' }),
      error: null,
    });
    const storage = new SupabaseStorageService(
      'https://project-ref.supabase.co',
      'backend-secret',
      'tattoo-references',
    );
    expect(await storage.download(PATH)).toEqual({ content, mimeType: 'image/png' });
    expect(supabaseMocks.download).toHaveBeenCalledWith(
      PATH,
      {},
      { signal: expect.any(AbortSignal) as unknown },
    );
    expect(supabaseMocks.createSignedUrl).not.toHaveBeenCalled();
  });

  it('rejects an unavailable private object without returning empty bytes', async () => {
    supabaseMocks.download.mockResolvedValue({ data: null, error: new Error('not found') });
    const storage = new SupabaseStorageService(
      'https://project-ref.supabase.co',
      'backend-secret',
      'tattoo-references',
    );
    await expect(storage.download(PATH)).rejects.toThrow(
      'La operación de almacenamiento no pudo completarse.',
    );
  });
});
