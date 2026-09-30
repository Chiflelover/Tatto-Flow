import {
  V2_ADVANCE_QUESTION,
  V2_REVIEW_MESSAGE,
  v2BookingSelection,
  v2PriceMessage,
} from './nita-v2-messages.js';

describe('Nita V2 result and intent messages', () => {
  it('communicates exactly one approximate price without technical calculations', () => {
    const text = v2PriceMessage('850.00');
    expect(text.match(/S\/\s*\d+\.\d{2}/g)).toEqual(['S/ 850.00']);
    expect(text).toContain('aproximado');
    expect(text).not.toMatch(/cm²|confidence|algoritmo|curva|factor|–/i);
  });
  it('keeps review human and short without price or a booking question', () => {
    expect(V2_REVIEW_MESSAGE).toContain('revisará tu solicitud');
    expect(V2_REVIEW_MESSAGE).not.toMatch(/S\/|cita|confianza|cobertura/i);
  });
  it('uses stable booking IDs and valid WhatsApp button titles', () => {
    if (V2_ADVANCE_QUESTION.type !== 'interactive_buttons') throw new Error();
    expect(V2_ADVANCE_QUESTION.buttons.map((button) => button.id)).toEqual([
      'nita_v2_direct_booking',
      'nita_v2_artist_contact',
    ]);
    expect(V2_ADVANCE_QUESTION.buttons.every((button) => button.title.length <= 20)).toBe(true);
    expect(v2BookingSelection({ type: 'text', value: 'Separar cita' })).toBe('DIRECT_BOOKING');
    expect(
      v2BookingSelection({ type: 'text', value: 'Prefiero que me contacte el tatuador' }),
    ).toBe('ARTIST_CONTACT');
    expect(v2BookingSelection({ type: 'text', value: 'hola' })).toBeNull();
    expect(v2BookingSelection({ type: 'option', stage: 'firstTattoo', value: true })).toBeNull();
  });
});
