import { contactUrl, normalizeNitaNumber } from './account.constants.js';

describe('Nita contact URL', () => {
  it('normalizes a number with a country code into wa.me', () => {
    expect(normalizeNitaNumber('+51 999 888 777')).toBe('51999888777');
    expect(contactUrl('+51 999 888 777')).toBe('https://wa.me/51999888777');
  });

  it('rejects numbers without a valid country prefix or length', () => {
    expect(() => contactUrl('0999')).toThrow();
    expect(() => contactUrl('0000000000')).toThrow();
  });
});
