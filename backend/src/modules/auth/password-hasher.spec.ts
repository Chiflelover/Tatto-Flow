import { hashPassword, verifyPassword } from './password-hasher.js';

describe('password hasher', () => {
  it('stores a salted scrypt hash and verifies the original password', async () => {
    const firstHash = await hashPassword('Una-clave-segura-123');
    const secondHash = await hashPassword('Una-clave-segura-123');

    expect(firstHash).toMatch(/^scrypt\$/);
    expect(secondHash).not.toBe(firstHash);
    await expect(verifyPassword('Una-clave-segura-123', firstHash)).resolves.toBe(true);
    await expect(verifyPassword('otra-clave', firstHash)).resolves.toBe(false);
  });
});
