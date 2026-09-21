import { DetailLevel, TattooSize } from '../generated/prisma/client.js';

export type AiMode = 'mock' | 'gemini';
export type StorageMode = 'memory' | 'supabase';

const DEFAULT_AI_MODE: AiMode = 'mock';
const DEFAULT_MOCK_SIZE = TattooSize.MEDIUM;
const DEFAULT_MOCK_SIZE_CONFIDENCE = 0.95;
const DEFAULT_MOCK_DETAIL = DetailLevel.DETAILED;
const DEFAULT_MOCK_DETAIL_CONFIDENCE = 0.96;
const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
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

function parseAiMode(value: unknown): AiMode {
  const mode = parseString('AI_MODE', value, DEFAULT_AI_MODE).toLowerCase();

  if (mode !== 'mock' && mode !== 'gemini') {
    throw new Error('AI_MODE debe ser "mock" o "gemini".');
  }

  return mode;
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

function parseEnumValue<TValue extends string>(
  name: string,
  value: unknown,
  allowedValues: readonly TValue[],
  defaultValue: TValue,
): TValue {
  const normalizedValue = parseString(name, value, defaultValue).toUpperCase();
  const parsedValue = allowedValues.find((allowedValue) => allowedValue === normalizedValue);

  if (!parsedValue) {
    throw new Error(`${name} debe ser uno de: ${allowedValues.join(', ')}.`);
  }

  return parsedValue;
}

function parseConfidence(name: string, value: unknown, defaultValue: number): number {
  const rawValue = value ?? defaultValue;

  if (typeof rawValue !== 'string' && typeof rawValue !== 'number') {
    throw new Error(`${name} debe ser un número entre 0 y 1.`);
  }

  const parsedValue = Number(rawValue);

  if (!Number.isFinite(parsedValue) || parsedValue < 0 || parsedValue > 1) {
    throw new Error(`${name} debe ser un número entre 0 y 1.`);
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
  const aiMode = parseAiMode(environment.AI_MODE);
  const storageMode = parseStorageMode(environment.STORAGE_MODE);

  return {
    ...environment,
    AI_MODE: aiMode,
    AI_MOCK_SIZE: parseEnumValue(
      'AI_MOCK_SIZE',
      environment.AI_MOCK_SIZE,
      Object.values(TattooSize),
      DEFAULT_MOCK_SIZE,
    ),
    AI_MOCK_SIZE_CONFIDENCE: parseConfidence(
      'AI_MOCK_SIZE_CONFIDENCE',
      environment.AI_MOCK_SIZE_CONFIDENCE,
      DEFAULT_MOCK_SIZE_CONFIDENCE,
    ),
    AI_MOCK_DETAIL: parseEnumValue(
      'AI_MOCK_DETAIL',
      environment.AI_MOCK_DETAIL,
      Object.values(DetailLevel),
      DEFAULT_MOCK_DETAIL,
    ),
    AI_MOCK_DETAIL_CONFIDENCE: parseConfidence(
      'AI_MOCK_DETAIL_CONFIDENCE',
      environment.AI_MOCK_DETAIL_CONFIDENCE,
      DEFAULT_MOCK_DETAIL_CONFIDENCE,
    ),
    GEMINI_MODEL: parseString('GEMINI_MODEL', environment.GEMINI_MODEL, DEFAULT_GEMINI_MODEL),
    ...(aiMode === 'gemini'
      ? {
          GEMINI_API_KEY: parseRequiredAiString('GEMINI_API_KEY', environment.GEMINI_API_KEY),
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

function parseRequiredAiString(name: string, value: unknown): string {
  const parsedValue = parseString(name, value, '');

  if (!parsedValue) {
    throw new Error(`${name} es obligatorio cuando AI_MODE=gemini.`);
  }

  return parsedValue;
}
