import { buildWhatsappUrl } from './dashboard-labels.js';

describe('dashboard labels', () => {
  it('builds a WhatsApp URL using only the normalized customer number', () => {
    expect(buildWhatsappUrl('+51 999-999-999')).toBe('https://wa.me/51999999999');
    expect(buildWhatsappUrl('not-a-phone')).toBeNull();
  });
});
