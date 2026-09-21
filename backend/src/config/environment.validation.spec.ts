import { validateEnvironment } from './environment.validation.js';

describe('AI environment validation', () => {
  it('keeps mock as the default without requiring a Gemini key', () => {
    const result = validateEnvironment({ STORAGE_MODE: 'memory' });

    expect(result.AI_MODE).toBe('mock');
    expect(result.GEMINI_MODEL).toBe('gemini-3.8-flash');
    expect(result.GEMINI_API_KEY).toBeUndefined();
  });

  it('requires a backend-only Gemini key when gemini mode is selected', () => {
    expect(() => validateEnvironment({ AI_MODE: 'gemini', STORAGE_MODE: 'memory' })).toThrow(
      'GEMINI_API_KEY es obligatorio cuando AI_MODE=gemini.',
    );
  });

  it('accepts Gemini mode and a configurable model', () => {
    const result = validateEnvironment({
      AI_MODE: 'gemini',
      GEMINI_API_KEY: 'test-only-key',
      GEMINI_MODEL: 'gemini-test-model',
      STORAGE_MODE: 'memory',
    });

    expect(result.AI_MODE).toBe('gemini');
    expect(result.GEMINI_MODEL).toBe('gemini-test-model');
  });

  it('rejects unsupported providers', () => {
    expect(() => validateEnvironment({ AI_MODE: 'openai', STORAGE_MODE: 'memory' })).toThrow(
      'AI_MODE debe ser "mock" o "gemini".',
    );
  });

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
