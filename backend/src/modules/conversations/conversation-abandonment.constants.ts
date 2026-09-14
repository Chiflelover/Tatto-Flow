export const CONVERSATION_ABANDONMENT_TIMEOUT_MS = 2 * 60 * 60 * 1_000;

export function getConversationAbandonmentCutoff(now: Date): Date {
  return new Date(now.getTime() - CONVERSATION_ABANDONMENT_TIMEOUT_MS);
}
