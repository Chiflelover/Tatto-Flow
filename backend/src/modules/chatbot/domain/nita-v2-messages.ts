import type { BookingIntent } from '../../../generated/prisma/client.js';
import type { ChatbotInput } from './chatbot.types.js';
import type { WhatsAppOutboundMessage } from '../whatsapp/whatsapp.adapter.js';

export const V2_BOOKING_BUTTON_IDS = {
  DIRECT_BOOKING: 'nita_v2_direct_booking',
  ARTIST_CONTACT: 'nita_v2_artist_contact',
} as const;
export const V2_REVIEW_MESSAGE =
  'Muchas gracias por la información. Un tatuador del estudio revisará tu solicitud y se pondrá en contacto contigo próximamente.';
export const V2_ADVANCE_QUESTION: WhatsAppOutboundMessage = {
  type: 'interactive_buttons',
  body: '¿Deseas coordinar para separar una cita?\n\n- Sí, quiero separar una cita\n- Prefiero que me contacte el tatuador',
  buttons: [
    { id: V2_BOOKING_BUTTON_IDS.DIRECT_BOOKING, title: 'Separar cita' },
    { id: V2_BOOKING_BUTTON_IDS.ARTIST_CONTACT, title: 'Contactarme' },
  ],
};

export function v2PriceMessage(amount: string): string {
  return `He revisado la información. El precio aproximado para tu tatuaje sería de S/ ${amount}.\nEl precio final puede ser confirmado por el tatuador.`;
}

export function v2BookingSelection(input: ChatbotInput): BookingIntent | null {
  if (input.type === 'option' && input.stage === 'bookingIntent') return input.value;
  if (input.type !== 'text') return null;
  const text = input.value.trim().toLocaleLowerCase('es-PE');
  if (['sí, quiero separar una cita', 'si, quiero separar una cita', 'separar cita'].includes(text))
    return 'DIRECT_BOOKING';
  if (['prefiero que me contacte el tatuador', 'contactarme'].includes(text))
    return 'ARTIST_CONTACT';
  return null;
}
