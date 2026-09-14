import { Injectable } from '@nestjs/common';

export const NITA_TIME_ZONE = 'America/Lima';
export const NITA_OPENING_HOUR = 6;
export const NITA_CLOSING_HOUR = 22;

interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const limaDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: NITA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function isWithinNitaBusinessHours(at: Date): boolean {
  const { hour } = getZonedDateParts(at);

  return hour >= NITA_OPENING_HOUR && hour < NITA_CLOSING_HOUR;
}

export function getNitaClosedPeriodKey(at: Date): string {
  const parts = getZonedDateParts(at);

  if (isWithinNitaBusinessHours(at)) {
    throw new Error('No existe una franja cerrada durante el horario de atención.');
  }

  const closedPeriodDate = parts.hour < NITA_OPENING_HOUR ? shiftLocalDate(parts, -1) : parts;

  return formatLocalDate(closedPeriodDate);
}

export function getNitaBusinessInactivityCutoff(at: Date, inactivityMs: number): Date {
  if (!Number.isFinite(at.getTime()) || !Number.isFinite(inactivityMs) || inactivityMs < 0) {
    throw new Error('No fue posible calcular la inactividad de Nita.');
  }

  let remainingMs = inactivityMs;
  let cursorMs = at.getTime();
  let localDate = getZonedDateParts(at);

  while (true) {
    const openingMs = zonedLocalTimeToInstant(localDate, NITA_OPENING_HOUR).getTime();
    const closingMs = zonedLocalTimeToInstant(localDate, NITA_CLOSING_HOUR).getTime();
    const intervalEndMs = Math.min(cursorMs, closingMs);
    const availableMs = Math.max(0, intervalEndMs - openingMs);

    if (remainingMs <= availableMs) {
      return new Date(intervalEndMs - remainingMs);
    }

    remainingMs -= availableMs;
    localDate = shiftLocalDate(localDate, -1);
    cursorMs = zonedLocalTimeToInstant(localDate, NITA_CLOSING_HOUR).getTime();
  }
}

@Injectable()
export class NitaBusinessHoursService {
  isOpen(at = new Date()): boolean {
    return isWithinNitaBusinessHours(at);
  }

  getClosedPeriodKey(at = new Date()): string {
    return getNitaClosedPeriodKey(at);
  }
}

function getZonedDateParts(at: Date): ZonedDateParts {
  if (!Number.isFinite(at.getTime())) {
    throw new Error('La fecha de Nita no es válida.');
  }

  const values = new Map(
    limaDateTimeFormatter
      .formatToParts(at)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)]),
  );

  return {
    year: values.get('year')!,
    month: values.get('month')!,
    day: values.get('day')!,
    hour: values.get('hour')!,
    minute: values.get('minute')!,
    second: values.get('second')!,
  };
}

function shiftLocalDate(parts: ZonedDateParts, days: number): ZonedDateParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  };
}

function formatLocalDate(parts: ZonedDateParts): string {
  return [
    parts.year.toString().padStart(4, '0'),
    parts.month.toString().padStart(2, '0'),
    parts.day.toString().padStart(2, '0'),
  ].join('-');
}

function zonedLocalTimeToInstant(parts: ZonedDateParts, hour: number): Date {
  const desiredAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour);
  let instantMs = desiredAsUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = getZonedDateParts(new Date(instantMs));
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const adjustmentMs = desiredAsUtc - actualAsUtc;

    instantMs += adjustmentMs;

    if (adjustmentMs === 0) {
      break;
    }
  }

  return new Date(instantMs);
}
