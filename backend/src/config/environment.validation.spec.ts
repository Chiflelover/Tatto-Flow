import { validateEnvironment } from './environment.validation.js';

const BASE_ENVIRONMENT = {
  GEMINI_API_KEY: 'test-only-gemini-key',
  STORAGE_MODE: 'memory',
};

describe('AI environment validation', () => {
  it('requires Gemini credentials because Gemini is always the primary provider', () => {
    expect(() => validateEnvironment({ STORAGE_MODE: 'memory' })).toThrow(
      'GEMINI_API_KEY es obligatorio. Gemini es el proveedor principal obligatorio.',
    );
  });

  it('defaults to Gemini without a fallback and uses the documented models', () => {
    const result = validateEnvironment(BASE_ENVIRONMENT);

    expect(result.AI_FALLBACK_PROVIDER).toBe('none');
    expect(result.GEMINI_MODEL).toBe('gemini-3.8-flash');
    expect(result.OPENAI_MODEL).toBe('gpt-5.6-luna');
  });

  it('accepts configurable Gemini and OpenAI models', () => {
    const result = validateEnvironment({
      ...BASE_ENVIRONMENT,
      GEMINI_MODEL: 'gemini-test-model',
      OPENAI_MODEL: 'openai-test-model',
    });

    expect(result.GEMINI_MODEL).toBe('gemini-test-model');
    expect(result.OPENAI_MODEL).toBe('openai-test-model');
  });

  it('requires an OpenAI key only when the fallback is enabled', () => {
    expect(() =>
      validateEnvironment({
        ...BASE_ENVIRONMENT,
        AI_FALLBACK_PROVIDER: 'openai',
      }),
    ).toThrow('OPENAI_API_KEY es obligatorio. Es obligatorio cuando AI_FALLBACK_PROVIDER=openai.');

    expect(
      validateEnvironment({
        ...BASE_ENVIRONMENT,
        AI_FALLBACK_PROVIDER: 'openai',
        OPENAI_API_KEY: 'test-only-openai-key',
      }).AI_FALLBACK_PROVIDER,
    ).toBe('openai');
  });

  it('does not require an OpenAI key when the fallback is disabled', () => {
    expect(validateEnvironment(BASE_ENVIRONMENT).OPENAI_API_KEY).toBeUndefined();
  });

  it('rejects unsupported fallback providers', () => {
    expect(() =>
      validateEnvironment({
        ...BASE_ENVIRONMENT,
        AI_FALLBACK_PROVIDER: 'mock',
      }),
    ).toThrow('AI_FALLBACK_PROVIDER debe ser "none" u "openai".');
  });
});

describe('storage environment validation', () => {
  it('uses memory storage only when it is selected explicitly', () => {
    expect(validateEnvironment(BASE_ENVIRONMENT).STORAGE_MODE).toBe('memory');
  });

  it('requires backend Supabase credentials in supabase mode', () => {
    expect(() =>
      validateEnvironment({
        GEMINI_API_KEY: BASE_ENVIRONMENT.GEMINI_API_KEY,
        STORAGE_MODE: 'supabase',
      }),
    ).toThrow('SUPABASE_URL es obligatorio cuando STORAGE_MODE=supabase.');
  });

  it('accepts the private bucket backend configuration without exposing its secret', () => {
    const result = validateEnvironment({
      GEMINI_API_KEY: BASE_ENVIRONMENT.GEMINI_API_KEY,
      STORAGE_MODE: 'supabase',
      SUPABASE_URL: 'https://project-ref.supabase.co',
      SUPABASE_SECRET_KEY: 'backend-secret',
      SUPABASE_STORAGE_BUCKET: 'tattoo-references',
    });

    expect(result.STORAGE_MODE).toBe('supabase');
    expect(result.SUPABASE_STORAGE_BUCKET).toBe('tattoo-references');
  });
});

describe('business-hours test phone environment validation', () => {
  it('keeps the bypass disabled when the optional value is absent or empty', () => {
    expect(validateEnvironment(BASE_ENVIRONMENT).BUSINESS_HOURS_TEST_PHONE).toBeUndefined();
    expect(
      validateEnvironment({
        ...BASE_ENVIRONMENT,
        BUSINESS_HOURS_TEST_PHONE: '   ',
      }).BUSINESS_HOURS_TEST_PHONE,
    ).toBeUndefined();
  });

  it('trims and preserves the configured test phone for exact matching', () => {
    expect(
      validateEnvironment({
        ...BASE_ENVIRONMENT,
        BUSINESS_HOURS_TEST_PHONE: ' test-phone-authorized ',
      }).BUSINESS_HOURS_TEST_PHONE,
    ).toBe('test-phone-authorized');
  });
});
