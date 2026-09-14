import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertSafeStoragePath } from './storage-path.js';
import {
  StorageService,
  type StorageDeleteResult,
  type StorageUploadInput,
} from './storage.service.js';

const STORAGE_ERROR_MESSAGE = 'La operación de almacenamiento no pudo completarse.';

interface StorageOnlyDatabase {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export class SupabaseStorageService extends StorageService {
  private readonly client: SupabaseClient<StorageOnlyDatabase>;

  constructor(
    supabaseUrl: string,
    secretKey: string,
    private readonly bucket: string,
  ) {
    super();
    this.client = createClient<StorageOnlyDatabase>(supabaseUrl, secretKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
  }

  async verifyPrivateBucket(): Promise<void> {
    const { data, error } = await this.client.storage.getBucket(this.bucket);

    if (error || data.public) {
      throw new Error('El bucket de referencias debe existir y permanecer privado.');
    }
  }

  async upload(input: StorageUploadInput): Promise<void> {
    assertSafeStoragePath(input.path);

    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(input.path, input.content, {
        cacheControl: '3600',
        contentType: input.contentType,
        upsert: false,
      });

    if (error) {
      throw new Error(STORAGE_ERROR_MESSAGE);
    }
  }

  async delete(path: string): Promise<StorageDeleteResult> {
    assertSafeStoragePath(path);

    if (!(await this.exists(path))) {
      return 'missing';
    }

    const { error } = await this.client.storage.from(this.bucket).remove([path]);

    if (error) {
      throw new Error(STORAGE_ERROR_MESSAGE);
    }

    return 'deleted';
  }

  async exists(path: string): Promise<boolean> {
    assertSafeStoragePath(path);
    const { data, error } = await this.client.storage.from(this.bucket).exists(path);

    if (data === false) {
      return false;
    }

    if (error) {
      throw new Error(STORAGE_ERROR_MESSAGE);
    }

    return data;
  }

  async createSignedUrl(path: string, expiresInSeconds: number): Promise<string> {
    assertSafeStoragePath(path);

    if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1) {
      throw new Error('La duración de la URL temporal no es válida.');
    }

    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(path, expiresInSeconds);

    if (error) {
      throw new Error(STORAGE_ERROR_MESSAGE);
    }

    return data.signedUrl;
  }
}
