import { Logger } from '@nestjs/common';

type SafeLogPrimitive = boolean | number | string | null;
export type SafeLogFields = Record<string, SafeLogPrimitive | SafeLogPrimitive[]>;

interface LogSink {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const SENSITIVE_FIELD =
  /(?:api.?key|authorization|binary|content|cron.?secret|database.?url|direct.?url|image.?bytes|image.?content|meta.?app.?secret|password|payload|phone|prompt|recipient|secret|signed.?url|storage.?path|token|webhook.?body)/i;
const SECRET_ENV_NAMES = [
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'WHATSAPP_ACCESS_TOKEN',
  'META_APP_SECRET',
  'CRON_SECRET',
  'DATABASE_URL',
  'DIRECT_URL',
  'TATTOO_ARTIST_PASSWORD',
] as const;

export class SafeStructuredLogger {
  private readonly sink: LogSink;

  constructor(context: string, sink?: LogSink) {
    this.sink = sink ?? new Logger(context);
  }

  info(event: string, fields: SafeLogFields = {}): void {
    this.write('log', event, fields);
  }

  warn(event: string, fields: SafeLogFields = {}): void {
    this.write('warn', event, fields);
  }

  error(event: string, fields: SafeLogFields = {}): void {
    this.write('error', event, fields);
  }

  private write(level: keyof LogSink, event: string, fields: SafeLogFields): void {
    try {
      const safeFields = Object.fromEntries(
        Object.entries(fields)
          .filter(([key]) => !SENSITIVE_FIELD.test(key))
          .map(([key, value]) => [key, this.sanitizeValue(value)]),
      );

      this.sink[level](JSON.stringify({ event, ...safeFields }));
    } catch {
      // Observability must never alter the application flow.
    }
  }

  private sanitizeValue(
    value: SafeLogPrimitive | SafeLogPrimitive[],
  ): SafeLogPrimitive | SafeLogPrimitive[] {
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizePrimitive(item));
    }

    return this.sanitizePrimitive(value);
  }

  private sanitizePrimitive(value: SafeLogPrimitive): SafeLogPrimitive {
    if (typeof value !== 'string') {
      return value;
    }

    let sanitized = value
      .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
      .replace(/postgres(?:ql)?:\/\/\S+/gi, '[REDACTED_DATABASE_URL]')
      .replace(/(?<![A-Za-z0-9])\+?\d{9,20}(?![A-Za-z0-9])/g, '[REDACTED_PHONE]');

    for (const name of SECRET_ENV_NAMES) {
      const secret = process.env[name];

      if (secret?.trim()) {
        sanitized = sanitized.replaceAll(secret, '[REDACTED]');
      }
    }

    return sanitized;
  }
}
