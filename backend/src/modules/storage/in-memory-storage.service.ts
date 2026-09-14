import { assertSafeStoragePath } from './storage-path.js';
import {
  StorageService,
  type StorageDeleteResult,
  type StorageUploadInput,
} from './storage.service.js';

interface StoredObject {
  content: Uint8Array;
  contentType: string;
}

export class InMemoryStorageService extends StorageService {
  private readonly objects = new Map<string, StoredObject>();

  upload(input: StorageUploadInput): Promise<void> {
    assertSafeStoragePath(input.path);

    if (this.objects.has(input.path)) {
      return Promise.reject(new Error('El objeto ya existe.'));
    }

    this.objects.set(input.path, {
      content: new Uint8Array(input.content),
      contentType: input.contentType,
    });

    return Promise.resolve();
  }

  delete(path: string): Promise<StorageDeleteResult> {
    assertSafeStoragePath(path);
    return Promise.resolve(this.objects.delete(path) ? 'deleted' : 'missing');
  }

  exists(path: string): Promise<boolean> {
    assertSafeStoragePath(path);
    return Promise.resolve(this.objects.has(path));
  }

  createSignedUrl(path: string, expiresInSeconds: number): Promise<string> {
    assertSafeStoragePath(path);
    const object = this.objects.get(path);

    if (!object || !Number.isInteger(expiresInSeconds) || expiresInSeconds < 1) {
      return Promise.reject(new Error('No se pudo crear la URL temporal.'));
    }

    const data = Buffer.from(object.content).toString('base64');
    return Promise.resolve(`data:${object.contentType};base64,${data}`);
  }
}
