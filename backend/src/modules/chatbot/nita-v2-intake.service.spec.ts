import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { Conversation, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { LeadImageService, LeadImageStorageException } from '../storage/lead-image.service.js';
import { StorageService } from '../storage/storage.service.js';
import { VISION_IMAGE } from '../../../test/fixtures/vision-v2.js';
import { NitaV2IntakeService } from './nita-v2-intake.service.js';

function fixture(overrides: Partial<Conversation> = {}) {
  const conversation = {
    id: crypto.randomUUID(),
    accountId: crypto.randomUUID(),
    customerId: crypto.randomUUID(),
    flowVersion: 'V2',
    v2AnalysisClaimId: null,
    v2AnalysisLeaseUntil: null,
    currentState: 'WAITING_IMAGE',
    status: 'ACTIVE',
    firstTattoo: false,
    sameSizeAsReference: null,
    targetSizeCm: null,
    colorDeclaration: null,
    bodyPart: null,
    selectedSize: null,
    selectedDetail: null,
    lastActivityAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } satisfies Conversation;
  const lead = {
    id: crypto.randomUUID(),
    accountId: conversation.accountId,
    customerId: conversation.customerId,
    images: [{ id: 'reference' }],
  };
  const updateConversation = vi.fn(({ data }: { data: Partial<Conversation> }) =>
    Promise.resolve({ ...conversation, ...data }),
  );
  const updateLead = vi.fn().mockResolvedValue(lead);
  const findFirst = vi.fn().mockResolvedValue({ ...conversation, account: { isActive: true } });
  const upsert = vi.fn().mockResolvedValue(lead);
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    conversation: { findFirst, update: updateConversation },
    lead: { upsert, update: updateLead, findUnique: vi.fn().mockResolvedValue(lead) },
    leadImage: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  const runTransaction = vi.fn(
    async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
      callback(transaction as unknown as Prisma.TransactionClient),
  );
  const ensureStored = vi.fn().mockResolvedValue({ storagePath: 'leads/test/reference.png' });
  const deleteFile = vi.fn().mockResolvedValue('deleted');
  const service = new NitaV2IntakeService(
    { $transaction: runTransaction } as unknown as PrismaService,
    { ensureStored } as unknown as LeadImageService,
    { delete: deleteFile } as unknown as StorageService,
  );
  return {
    conversation,
    lead,
    transaction,
    runTransaction,
    ensureStored,
    deleteFile,
    service,
    updateConversation,
    updateLead,
    upsert,
    findFirst,
  };
}

describe('Nita V2 reference and intake persistence', () => {
  it('persists the follow-up size with the existing intake and checkpoints before commit', async () => {
    const f = fixture({
      currentState: 'ASK_TARGET_SIZE_AFTER_ANALYSIS',
      firstTattoo: false,
      sameSizeAsReference: true,
      colorDeclaration: 'BLACK_ONLY',
      bodyPart: 'Antebrazo',
    });
    const checkpoint = vi.fn().mockResolvedValue(undefined);
    const result = await f.service.applyTransition(
      f.conversation.accountId,
      f.conversation.id,
      'ASK_TARGET_SIZE_AFTER_ANALYSIS',
      { targetSizeCm: 10, currentState: 'READY_FOR_ANALYSIS' },
      checkpoint,
    );
    expect(result).toMatchObject({
      applied: true,
      conversation: {
        currentState: 'READY_FOR_ANALYSIS',
        sameSizeAsReference: true,
        targetSizeCm: 10,
      },
    });
    expect(f.updateLead).toHaveBeenCalledWith({
      where: { id: f.lead.id },
      data: {
        firstTattoo: false,
        sameSizeAsReference: true,
        targetSizeCm: 10,
        colorDeclaration: 'BLACK_ONLY',
        bodyPart: 'Antebrazo',
      },
    });
    expect(checkpoint).toHaveBeenCalledWith(f.transaction, result.conversation);
    expect(f.upsert).not.toHaveBeenCalled();
    expect(f.ensureStored).not.toHaveBeenCalled();
  });
  it('locks the conversation, reuses a candidate and stores privately before advancing', async () => {
    const f = fixture();
    const result = await f.service.storeReference(
      f.conversation.accountId,
      f.conversation.id,
      VISION_IMAGE,
    );
    expect(result).toMatchObject({
      applied: true,
      conversation: { currentState: 'ASK_SAME_SIZE' },
    });
    expect(f.transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(f.ensureStored).toHaveBeenCalledWith(f.lead.id, VISION_IMAGE, f.transaction);
    expect(f.updateConversation.mock.invocationCallOrder[0]).toBeGreaterThan(
      f.ensureStored.mock.invocationCallOrder[0],
    );
    expect(f.upsert.mock.calls[0]?.[0]).toMatchObject({
      update: {},
      create: {
        accountId: f.conversation.accountId,
        customerId: f.conversation.customerId,
        conversationId: f.conversation.id,
      },
    });
    expect(f.updateLead).not.toHaveBeenCalled();
  });
  it('does not upload a duplicate image after the reference state', async () => {
    const f = fixture({ currentState: 'ASK_SAME_SIZE' });
    expect(
      await f.service.storeReference(f.conversation.accountId, f.conversation.id, VISION_IMAGE),
    ).toMatchObject({ applied: false });
    expect(f.ensureStored).not.toHaveBeenCalled();
    expect(f.upsert).not.toHaveBeenCalled();
  });
  it('does not advance if private storage fails', async () => {
    const f = fixture();
    f.ensureStored.mockRejectedValue(new LeadImageStorageException());
    await expect(
      f.service.storeReference(f.conversation.accountId, f.conversation.id, VISION_IMAGE),
    ).rejects.toBeInstanceOf(LeadImageStorageException);
    expect(f.updateConversation).not.toHaveBeenCalled();
  });
  it('compensates the uploaded file if the outer transaction fails', async () => {
    const f = fixture();
    f.runTransaction.mockImplementationOnce(async (callback) => {
      await callback(f.transaction as unknown as Prisma.TransactionClient);
      throw new Error('commit failed');
    });
    await expect(
      f.service.storeReference(f.conversation.accountId, f.conversation.id, VISION_IMAGE),
    ).rejects.toThrow('commit failed');
    expect(f.deleteFile).toHaveBeenCalledWith('leads/test/reference.png');
  });
  it.each([true, false])('consolidates only complete intake with sameSize=%s', async (sameSize) => {
    const f = fixture({
      currentState: 'ASK_BODY_PART',
      sameSizeAsReference: sameSize,
      targetSizeCm: sameSize ? null : 12.5,
      colorDeclaration: 'MOSTLY_COLOR',
    });
    const result = await f.service.applyTransition(
      f.conversation.accountId,
      f.conversation.id,
      'ASK_BODY_PART',
      { bodyPart: 'Antebrazo izquierdo', currentState: 'READY_FOR_ANALYSIS' },
    );
    expect(result.conversation.currentState).toBe('READY_FOR_ANALYSIS');
    expect(f.updateLead).toHaveBeenCalledWith({
      where: { id: f.lead.id },
      data: {
        firstTattoo: false,
        sameSizeAsReference: sameSize,
        targetSizeCm: sameSize ? null : 12.5,
        colorDeclaration: 'MOSTLY_COLOR',
        bodyPart: 'Antebrazo izquierdo',
      },
    });
  });
  it('rejects incomplete intake and missing reference', async () => {
    const f = fixture({ currentState: 'ASK_BODY_PART' });
    await expect(
      f.service.applyTransition(f.conversation.accountId, f.conversation.id, 'ASK_BODY_PART', {
        bodyPart: 'brazo',
        currentState: 'READY_FOR_ANALYSIS',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    const complete = fixture({
      currentState: 'ASK_BODY_PART',
      sameSizeAsReference: true,
      colorDeclaration: 'BLACK_ONLY',
    });
    complete.transaction.lead.findUnique.mockResolvedValue(null);
    await expect(
      complete.service.applyTransition(
        complete.conversation.accountId,
        complete.conversation.id,
        'ASK_BODY_PART',
        { bodyPart: 'brazo', currentState: 'READY_FOR_ANALYSIS' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(f.updateLead).not.toHaveBeenCalled();
    expect(complete.updateLead).not.toHaveBeenCalled();
  });
  it('ignores a transition for an earlier state', async () => {
    const f = fixture({ currentState: 'ASK_COLOR' });
    expect(
      await f.service.applyTransition(
        f.conversation.accountId,
        f.conversation.id,
        'ASK_SAME_SIZE',
        { sameSizeAsReference: true },
      ),
    ).toMatchObject({ applied: false });
    expect(f.updateConversation).not.toHaveBeenCalled();
  });
  it('rejects another account or a V1 conversation', async () => {
    const f = fixture();
    f.findFirst.mockResolvedValue(null);
    await expect(
      f.service.storeReference(f.conversation.accountId, f.conversation.id, VISION_IMAGE),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(f.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: f.conversation.id, accountId: f.conversation.accountId, flowVersion: 'V2' },
      }),
    );
    expect(f.ensureStored).not.toHaveBeenCalled();
  });
  it('rejects a disabled account before any write', async () => {
    const f = fixture();
    f.findFirst.mockResolvedValue({ ...f.conversation, account: { isActive: false } });
    await expect(
      f.service.storeReference(f.conversation.accountId, f.conversation.id, VISION_IMAGE),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.ensureStored).not.toHaveBeenCalled();
    expect(f.upsert).not.toHaveBeenCalled();
  });
});
