const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
import { ConversationState } from '../../../generated/prisma/client.js';
import { ChatbotService } from '../chatbot.service.js';
import type { ChatbotOption, ChatbotResponse } from '../domain/chatbot.types.js';
import { WHATSAPP_BUTTON_IDS, WhatsAppAdapter } from './whatsapp.adapter.js';

function response(
  state: ConversationState,
  messages: string[] = [],
  options: ChatbotOption[] = [],
): ChatbotResponse {
  return {
    state,
    messages: messages.map((text) => ({ type: 'text', text })),
    options,
  };
}

describe('WhatsAppAdapter', () => {
  const processOptionSelection = vi.fn<ChatbotService['processOptionSelection']>();
  const processTextMessage = vi.fn<ChatbotService['processTextMessage']>();
  const processImageMessage = vi.fn<ChatbotService['processImageMessage']>();
  const adapter = new WhatsAppAdapter({
    processOptionSelection,
    processTextMessage,
    processImageMessage,
  } as unknown as ChatbotService);

  beforeEach(() => {
    vi.clearAllMocks();
    processOptionSelection.mockResolvedValue(response(ConversationState.ASK_BODY_PART));
    processTextMessage.mockResolvedValue(response(ConversationState.ASK_BODY_PART));
    processImageMessage.mockResolvedValue(response(ConversationState.HANDOFF_TO_TATTOO_ARTIST));
  });

  it.each([
    [WHATSAPP_BUTTON_IDS.FIRST_TATTOO_YES, { stage: 'firstTattoo', value: true }],
    [WHATSAPP_BUTTON_IDS.FIRST_TATTOO_NO, { stage: 'firstTattoo', value: false }],
    [WHATSAPP_BUTTON_IDS.SAME_SIZE_YES, { stage: 'sameSize', value: true }],
    [WHATSAPP_BUTTON_IDS.SAME_SIZE_NO, { stage: 'sameSize', value: false }],
    [WHATSAPP_BUTTON_IDS.COLOR_BLACK_ONLY, { stage: 'color', value: 'BLACK_ONLY' }],
    [WHATSAPP_BUTTON_IDS.COLOR_LOW, { stage: 'color', value: 'LOW_COLOR' }],
    [WHATSAPP_BUTTON_IDS.COLOR_MEDIUM, { stage: 'color', value: 'MEDIUM_COLOR' }],
    [WHATSAPP_BUTTON_IDS.COLOR_FULL, { stage: 'color', value: 'FULL_COLOR' }],
    [WHATSAPP_BUTTON_IDS.COLOR_SOME, { stage: 'color', value: 'BLACK_WITH_SOME_COLOR' }],
    [WHATSAPP_BUTTON_IDS.COLOR_MOSTLY, { stage: 'color', value: 'MOSTLY_COLOR' }],
  ])('maps stable V2 button %s to its own stage', async (buttonId, selection) => {
    await adapter.handleIncoming({
      type: 'button_reply',
      accountId: ACCOUNT_ID,
      customerIdentifier: '51911111111',
      buttonId: String(buttonId),
    });
    expect(processOptionSelection).toHaveBeenCalledWith(ACCOUNT_ID, '51911111111', selection);
  });

  it('renders all four explicit colors in one WhatsApp list and in the text fallback', async () => {
    processTextMessage.mockResolvedValue(
      response(
        ConversationState.ASK_COLOR,
        ['¿Qué nivel de color quieres para tu tatuaje?'],
        [
          { value: 'BLACK_ONLY', label: 'Negro' },
          { value: 'LOW_COLOR', label: 'Poco color' },
          { value: 'MEDIUM_COLOR', label: 'Color medio' },
          { value: 'FULL_COLOR', label: 'Full color' },
        ],
      ),
    );
    const outbound = await adapter.handleIncoming({
      type: 'text',
      accountId: ACCOUNT_ID,
      customerIdentifier: '51911111111',
      text: 'sí',
    });
    expect(outbound[0]).toMatchObject({
      type: 'interactive_list',
      body: '¿Qué nivel de color quieres para tu tatuaje?',
      button: 'Elegir color',
      rows: [
        { id: WHATSAPP_BUTTON_IDS.COLOR_BLACK_ONLY, title: 'Negro' },
        { id: WHATSAPP_BUTTON_IDS.COLOR_LOW, title: 'Poco color' },
        { id: WHATSAPP_BUTTON_IDS.COLOR_MEDIUM, title: 'Color medio' },
        { id: WHATSAPP_BUTTON_IDS.COLOR_FULL, title: 'Full color' },
      ],
    });
    const fallback = await adapter.handleIncoming(
      { type: 'text', accountId: ACCOUNT_ID, customerIdentifier: '51911111111', text: 'sí' },
      { interactiveButtons: false },
    );
    expect(fallback[0]).toMatchObject({
      type: 'text',
      text: '¿Qué nivel de color quieres para tu tatuaje?\n\n- Negro\n- Poco color\n- Color medio\n- Full color',
    });
    expect(processTextMessage).toHaveBeenLastCalledWith(ACCOUNT_ID, '51911111111', 'sí');
  });

  it('passes free body text to ChatbotService without trimming or state logic', async () => {
    await adapter.handleIncoming({
      type: 'text',
      accountId: ACCOUNT_ID,
      customerIdentifier: '+51911111111',
      text: '  brazo  ',
    });

    expect(processTextMessage).toHaveBeenCalledWith(ACCOUNT_ID, '+51911111111', '  brazo  ');
    expect(processOptionSelection).not.toHaveBeenCalled();
  });

  it('passes an image to the existing ChatbotService workflow', async () => {
    const image = {
      content: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      mimeType: 'image/png',
      fileName: 'referencia.png',
    };

    await adapter.handleIncoming({
      type: 'image',
      accountId: ACCOUNT_ID,
      customerIdentifier: '+51911111111',
      image,
    });

    expect(processImageMessage).toHaveBeenCalledWith(ACCOUNT_ID, '+51911111111', image);
  });

  it.each(['stale-button', 'unknown-button'])(
    'silently ignores unknown button ID %s',
    async (buttonId) => {
      await expect(
        adapter.handleIncoming({
          type: 'button_reply',
          accountId: ACCOUNT_ID,
          customerIdentifier: '+51911111111',
          buttonId,
        }),
      ).resolves.toEqual([]);

      expect(processOptionSelection).not.toHaveBeenCalled();
    },
  );
});
