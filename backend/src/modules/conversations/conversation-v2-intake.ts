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

function hasV2IntakeContext(conversation: V2Intake): boolean {
  return (
    typeof conversation.firstTattoo === 'boolean' &&
    typeof conversation.sameSizeAsReference === 'boolean' &&
    conversation.colorDeclaration !== null &&
    Boolean(conversation.bodyPart?.trim()) &&
    (conversation.bodyPart?.length ?? 0) <= 120
  );
}

export function hasCompleteV2Intake(conversation: V2Intake): boolean {
  return (
    hasV2IntakeContext(conversation) &&
    typeof conversation.targetSizeCm === 'number' &&
    Number.isFinite(conversation.targetSizeCm) &&
    conversation.targetSizeCm > 0
  );
}

// Only the former SAME_SIZE path can reach the end of intake without a client dimension.
// This is pending recovery, never a complete intake or an inferred target size.
export function hasV2IntakeAwaitingTargetSize(conversation: V2Intake): boolean {
  return (
    hasV2IntakeContext(conversation) &&
    conversation.sameSizeAsReference === true &&
    conversation.targetSizeCm === null
  );
}
