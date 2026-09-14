import { Injectable } from '@nestjs/common';
import type { TemporaryImageStorage } from '../ports/temporary-image-storage.port.js';

@Injectable()
export class NoopTemporaryImageStorageService implements TemporaryImageStorage {
  deleteForConversation(): Promise<void> {
    return Promise.resolve();
  }
}
