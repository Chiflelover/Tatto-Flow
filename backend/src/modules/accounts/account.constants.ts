export const LEGACY_ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';

export function normalizeNitaNumber(value: string): string {
  const digits = value.replace(/[^0-9]/g, '');
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) {
    throw new Error('El número de Nita debe incluir código de país y tener entre 8 y 15 dígitos.');
  }
  return digits;
}

export function contactUrl(phoneNumber: string): string {
  return `https://wa.me/${normalizeNitaNumber(phoneNumber)}`;
}
