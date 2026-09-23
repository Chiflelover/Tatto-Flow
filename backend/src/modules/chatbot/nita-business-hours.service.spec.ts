import {
  getNitaBusinessInactivityCutoff,
  getNitaClosedPeriodKey,
  isWithinNitaBusinessHours,
} from './nita-business-hours.service.js';

describe('Nita business hours in America/Lima', () => {
  it.each([
    ['05:59', '2026-09-14T10:59:00.000Z', false],
    ['06:00', '2026-09-14T11:00:00.000Z', true],
    ['21:59', '2026-09-15T02:59:00.000Z', true],
    ['22:00', '2026-09-15T03:00:00.000Z', false],
  ])('treats %s (%s) in Lima as open=%s', (_label, isoDate, expected) => {
    expect(isWithinNitaBusinessHours(new Date(isoDate))).toBe(expected);
  });

  it('uses one closed-period key throughout the same night', () => {
    expect(getNitaClosedPeriodKey(new Date('2026-09-15T04:00:00.000Z'))).toBe('2026-09-14');
    expect(getNitaClosedPeriodKey(new Date('2026-09-15T10:59:00.000Z'))).toBe('2026-09-14');
  });

  it('subtracts only open time when calculating the two-hour inactivity cutoff', () => {
    const nextMorningAt0630 = new Date('2026-09-15T11:30:00.000Z');

    expect(getNitaBusinessInactivityCutoff(nextMorningAt0630, 2 * 60 * 60 * 1_000)).toEqual(
      new Date('2026-09-15T01:30:00.000Z'),
    );
  });
});
