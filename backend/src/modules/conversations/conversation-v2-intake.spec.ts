import type { V2Intake } from './conversation-v2-intake.js';
import { hasCompleteV2Intake, hasV2IntakeAwaitingTargetSize } from './conversation-v2-intake.js';

const intake: V2Intake = {
  firstTattoo: false,
  sameSizeAsReference: true,
  targetSizeCm: 12.5,
  colorDeclaration: 'BLACK_ONLY',
  bodyPart: 'Antebrazo',
};

describe('V2 client target size completeness', () => {
  it.each([true, false])('requires a finite positive client size with sameSize=%s', (sameSize) => {
    for (const targetSizeCm of [null, 0, -1, Number.NaN, Infinity, -Infinity, '8', undefined]) {
      expect(
        hasCompleteV2Intake({
          ...intake,
          sameSizeAsReference: sameSize,
          targetSizeCm: targetSizeCm as V2Intake['targetSizeCm'],
        }),
      ).toBe(false);
    }
    expect(hasCompleteV2Intake({ ...intake, sameSizeAsReference: sameSize })).toBe(true);
  });

  it('keeps a historical missing size pending without calling it complete', () => {
    const historical = { ...intake, targetSizeCm: null };
    expect(hasCompleteV2Intake(historical)).toBe(false);
    expect(hasV2IntakeAwaitingTargetSize(historical)).toBe(true);
    expect(hasV2IntakeAwaitingTargetSize({ ...historical, sameSizeAsReference: false })).toBe(
      false,
    );
    expect(hasV2IntakeAwaitingTargetSize({ ...historical, firstTattoo: null })).toBe(false);
    expect(hasV2IntakeAwaitingTargetSize({ ...historical, targetSizeCm: 0 })).toBe(false);
  });
});
