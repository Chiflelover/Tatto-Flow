export const TEMPORARY_IMAGE_STORAGE = Symbol('TEMPORARY_IMAGE_STORAGE');

export interface TemporaryImageStorage {
  deleteForConversation(conversationId: string): Promise<void>;
}
