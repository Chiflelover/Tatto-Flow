import type { Conversation } from '../../generated/prisma/client.js';

export type V2Intake = Pick<
  Conversation,
  'firstTattoo' | 'sameSizeAsReference' | 'targetSizeCm' | 'colorDeclaration' | 'bodyPart'
>;

export function v2IntakeSnapshot(conversation: V2Intake) {
  return {
    firstTattoo: conversation.firstTattoo,
    sameSizeAsReference: conversation.sameSizeAsReference,
    targetSizeCm: conversation.targetSizeCm,
    colorDeclaration: conversation.colorDeclaration,
    bodyPart: conversation.bodyPart,
  };
}

export function hasCompleteV2Intake(conversation: V2Intake): boolean {
  return (
    typeof conversation.firstTattoo === 'boolean' &&
    typeof conversation.sameSizeAsReference === 'boolean' &&
    (conversation.sameSizeAsReference
      ? conversation.targetSizeCm === null
      : typeof conversation.targetSizeCm === 'number' &&
        Number.isFinite(conversation.targetSizeCm) &&
        conversation.targetSizeCm > 0) &&
    conversation.colorDeclaration !== null &&
    Boolean(conversation.bodyPart?.trim()) &&
    (conversation.bodyPart?.length ?? 0) <= 120
  );
}
