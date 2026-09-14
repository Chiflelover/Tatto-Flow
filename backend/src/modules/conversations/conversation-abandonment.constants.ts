import { getNitaBusinessInactivityCutoff } from '../chatbot/nita-business-hours.service.js';

export const CONVERSATION_ABANDONMENT_TIMEOUT_MS = 2 * 60 * 60 * 1_000;

export function getConversationAbandonmentCutoff(now: Date): Date {
  return getNitaBusinessInactivityCutoff(now, CONVERSATION_ABANDONMENT_TIMEOUT_MS);
}
