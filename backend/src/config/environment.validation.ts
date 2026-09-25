export type AiFallbackProvider = 'none' | 'openai';
export type StorageMode = 'memory' | 'supabase';

const DEFAULT_AI_FALLBACK_PROVIDER: AiFallbackProvider = 'none';
const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
const DEFAULT_OPENAI_MODEL = 'gpt-5.6-luna';
const DEFAULT_SESSION_TTL_HOURS = 168;
const DEFAULT_STORAGE_MODE: StorageMode = 'supabase';
const DEFAULT_STORAGE_BUCKET = 'tattoo-references';

function parseString(name: string, value: unknown, defaultValue: string): string {
  const parsedValue = value ?? defaultValue;

  if (typeof parsedValue !== 'string') {
    throw new Error(`${name} debe ser texto.`);
  }

  return parsedValue.trim();
}

function parseAiFallbackProvider(value: unknown): AiFallbackProvider {
  const provider = parseString(
    'AI_FALLBACK_PROVIDER',
    value,
    DEFAULT_AI_FALLBACK_PROVIDER,
  ).toLowerCase();

  if (provider !== 'none' && provider !== 'openai') {
    throw new Error('AI_FALLBACK_PROVIDER debe ser "none" u "openai".');
  }

  return provider;
}

function parseStorageMode(value: unknown): StorageMode {
  const mode = parseString('STORAGE_MODE', value, DEFAULT_STORAGE_MODE).toLowerCase();

  if (mode !== 'memory' && mode !== 'supabase') {
    throw new Error('STORAGE_MODE debe ser "memory" o "supabase".');
  }

  return mode;
}

function parseRequiredString(name: string, value: unknown): string {
  const parsedValue = parseString(name, value, '');

  if (!parsedValue) {
    throw new Error(`${name} es obligatorio cuando STORAGE_MODE=supabase.`);
  }

  return parsedValue;
}

function parseSupabaseUrl(value: unknown): string {
  const parsedValue = parseRequiredString('SUPABASE_URL', value);

  try {
    const url = new URL(parsedValue);

    if (url.protocol !== 'https:') {
      throw new Error();
    }
  } catch {
    throw new Error('SUPABASE_URL debe ser una URL HTTPS válida.');
  }

  return parsedValue;
}

function parsePositiveInteger(name: string, value: unknown, defaultValue: number): number {
  const parsedValue = Number(value ?? defaultValue);

  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    throw new Error(`${name} debe ser un número entero positivo.`);
  }

  return parsedValue;
}

export function validateEnvironment(environment: Record<string, unknown>): Record<string, unknown> {
  const aiFallbackProvider = parseAiFallbackProvider(environment.AI_FALLBACK_PROVIDER);
  const storageMode = parseStorageMode(environment.STORAGE_MODE);

  return {
    ...environment,
    AI_FALLBACK_PROVIDER: aiFallbackProvider,
    GEMINI_API_KEY: parseRequiredProviderString(
      'GEMINI_API_KEY',
      environment.GEMINI_API_KEY,
      'Gemini es el proveedor principal obligatorio.',
    ),
    GEMINI_MODEL: parseString('GEMINI_MODEL', environment.GEMINI_MODEL, DEFAULT_GEMINI_MODEL),
    OPENAI_MODEL: parseString('OPENAI_MODEL', environment.OPENAI_MODEL, DEFAULT_OPENAI_MODEL),
    ...(aiFallbackProvider === 'openai'
      ? {
          OPENAI_API_KEY: parseRequiredProviderString(
            'OPENAI_API_KEY',
            environment.OPENAI_API_KEY,
            'Es obligatorio cuando AI_FALLBACK_PROVIDER=openai.',
          ),
        }
      : {}),
    SESSION_TTL_HOURS: parsePositiveInteger(
      'SESSION_TTL_HOURS',
      environment.SESSION_TTL_HOURS,
      DEFAULT_SESSION_TTL_HOURS,
    ),
    STORAGE_MODE: storageMode,
    SUPABASE_STORAGE_BUCKET: parseString(
      'SUPABASE_STORAGE_BUCKET',
      environment.SUPABASE_STORAGE_BUCKET,
      DEFAULT_STORAGE_BUCKET,
    ),
    ...(storageMode === 'supabase'
      ? {
          SUPABASE_URL: parseSupabaseUrl(environment.SUPABASE_URL),
          SUPABASE_SECRET_KEY: parseRequiredString(
            'SUPABASE_SECRET_KEY',
            environment.SUPABASE_SECRET_KEY,
          ),
        }
      : {}),
  };
}

function parseRequiredProviderString(name: string, value: unknown, reason: string): string {
  const parsedValue = parseString(name, value, '');

  if (!parsedValue) {
    throw new Error(`${name} es obligatorio. ${reason}`);
  }

  return parsedValue;
}
