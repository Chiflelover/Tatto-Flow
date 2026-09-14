export interface StorageUploadInput {
  path: string;
  content: Uint8Array;
  contentType: string;
}

export type StorageDeleteResult = 'deleted' | 'missing';

export abstract class StorageService {
  abstract upload(input: StorageUploadInput): Promise<void>;

  abstract delete(path: string): Promise<StorageDeleteResult>;

  abstract exists(path: string): Promise<boolean>;

  abstract createSignedUrl(path: string, expiresInSeconds: number): Promise<string>;
}
