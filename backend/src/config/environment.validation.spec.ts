import { validateEnvironment } from './environment.validation.js';

describe('AI environment validation', () => {
  it('rejects a mock confidence lower than zero', () => {
    expect(() =>
      validateEnvironment({
        AI_MODE: 'mock',
        AI_MOCK_SIZE_CONFIDENCE: '-0.01',
      }),
    ).toThrow('AI_MOCK_SIZE_CONFIDENCE debe ser un número entre 0 y 1.');
  });

  it('rejects a mock confidence higher than one', () => {
    expect(() =>
      validateEnvironment({
        AI_MODE: 'mock',
        AI_MOCK_DETAIL_CONFIDENCE: '1.01',
      }),
    ).toThrow('AI_MOCK_DETAIL_CONFIDENCE debe ser un número entre 0 y 1.');
  });
});

describe('storage environment validation', () => {
  it('uses memory storage only when it is selected explicitly', () => {
    expect(validateEnvironment({ STORAGE_MODE: 'memory' }).STORAGE_MODE).toBe('memory');
  });

  it('requires backend Supabase credentials in supabase mode', () => {
    expect(() => validateEnvironment({ STORAGE_MODE: 'supabase' })).toThrow(
      'SUPABASE_URL es obligatorio cuando STORAGE_MODE=supabase.',
    );
  });

  it('accepts the private bucket backend configuration without exposing its secret', () => {
    const result = validateEnvironment({
      STORAGE_MODE: 'supabase',
      SUPABASE_URL: 'https://project-ref.supabase.co',
      SUPABASE_SECRET_KEY: 'backend-secret',
      SUPABASE_STORAGE_BUCKET: 'tattoo-references',
    });

    expect(result.STORAGE_MODE).toBe('supabase');
    expect(result.SUPABASE_STORAGE_BUCKET).toBe('tattoo-references');
  });
});
