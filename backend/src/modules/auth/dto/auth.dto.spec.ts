import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { LoginDto } from './auth.dto.js';

async function validatePassword(password: string) {
  const dto = new LoginDto();
  dto.email = 'tatuador@example.com';
  dto.password = password;

  return validate(dto);
}

describe('LoginDto password policy', () => {
  it.each(['123456789', '12345678901234567890'])(
    'accepts a password within the 9 to 20 character range',
    async (password) => {
      await expect(validatePassword(password)).resolves.toHaveLength(0);
    },
  );

  it.each(['12345678', '123456789012345678901'])(
    'rejects a password outside the 9 to 20 character range',
    async (password) => {
      const errors = await validatePassword(password);

      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('password');
    },
  );
});
