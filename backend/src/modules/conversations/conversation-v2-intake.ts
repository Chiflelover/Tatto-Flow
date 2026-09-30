import type { Conversation } from '../../generated/prisma/client.js';

export function v2IntakeSnapshot(conversation: Conversation) {
  return {
    firstTattoo: conversation.firstTattoo,
    sameSizeAsReference: conversation.sameSizeAsReference,
    targetSizeCm: conversation.targetSizeCm,
    colorDeclaration: conversation.colorDeclaration,
    bodyPart: conversation.bodyPart,
  };
}

export function hasCompleteV2Intake(conversation: Conversation): boolean {
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
