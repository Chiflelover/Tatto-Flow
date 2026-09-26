import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationState, DetailLevel, TattooSize } from '../../../generated/prisma/client.js';
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

const SIZE_OPTIONS: ChatbotOption[] = [
  { value: TattooSize.SMALL, label: 'Pequeño' },
  { value: TattooSize.MEDIUM, label: 'Mediano' },
  { value: TattooSize.LARGE, label: 'Grande' },
];
const DETAIL_OPTIONS: ChatbotOption[] = [
  { value: DetailLevel.LIGHT, label: 'Ligero' },
  { value: DetailLevel.MEDIUM, label: 'Medio' },
  { value: DetailLevel.DETAILED, label: 'Detallado' },
];
const SIZE_GUIDE_URL = 'https://tatuoflow.example/nita-size-guide.png';
const DETAIL_GUIDE_URL = 'https://tatuoflow.example/nita-detail-guide.png';

describe('WhatsAppAdapter', () => {
  const processOptionSelection = vi.fn<ChatbotService['processOptionSelection']>();
  const processTextMessage = vi.fn<ChatbotService['processTextMessage']>();
  const processImageMessage = vi.fn<ChatbotService['processImageMessage']>();
  const adapter = new WhatsAppAdapter(
    {
      processOptionSelection,
      processTextMessage,
      processImageMessage,
    } as unknown as ChatbotService,
    new ConfigService({ FRONTEND_URL: 'https://tatuoflow.example' }),
  );

  beforeEach(() => {
    vi.clearAllMocks();
    processOptionSelection.mockResolvedValue(response(ConversationState.ASK_BODY_PART));
    processTextMessage.mockResolvedValue(response(ConversationState.ASK_BODY_PART));
    processImageMessage.mockResolvedValue(response(ConversationState.HANDOFF_TO_TATTOO_ARTIST));
  });

  it('renders the exact size question as three interactive buttons with stable IDs', async () => {
    processTextMessage.mockResolvedValue(
      response(
        ConversationState.ASK_SIZE,
        [
          'Hola, soy Nita, la secretaria virtual. Te haré unas preguntas rápidas para conocer mejor tu idea y poder atenderte.',
          '¿Qué tamaño aproximado tendrá tu tatuaje?\n\n(Las imágenes son solo ejemplos para comparar tamaños)',
        ],
        SIZE_OPTIONS,
      ),
    );

    await expect(
      adapter.handleIncoming({
        type: 'text',
        customerIdentifier: '+51911111111',
        text: 'Hola',
      }),
    ).resolves.toEqual([
      {
        type: 'text',
        text: 'Hola, soy Nita, la secretaria virtual. Te haré unas preguntas rápidas para conocer mejor tu idea y poder atenderte.',
      },
      {
        type: 'interactive_buttons',
        body: '¿Qué tamaño aproximado tendrá tu tatuaje?\n\n(Las imágenes son solo ejemplos para comparar tamaños)',
        headerImageUrl: SIZE_GUIDE_URL,
        buttons: [
          { id: WHATSAPP_BUTTON_IDS.SMALL, title: 'Pequeño' },
          { id: WHATSAPP_BUTTON_IDS.MEDIUM, title: 'Mediano' },
          { id: WHATSAPP_BUTTON_IDS.LARGE, title: 'Grande' },
        ],
      },
    ]);
  });

  it('renders the exact detail question as three interactive buttons with stable IDs', async () => {
    processOptionSelection.mockResolvedValue(
      response(
        ConversationState.ASK_DETAIL,
        [
          '¿Qué nivel de detalle buscas para tu tatuaje?\n\n(Piensa en cuánto detalle, líneas, sombras y tinta quieres que tenga.)',
        ],
        DETAIL_OPTIONS,
      ),
    );

    await expect(
      adapter.handleIncoming({
        type: 'button_reply',
        customerIdentifier: '+51911111111',
        buttonId: WHATSAPP_BUTTON_IDS.SMALL,
      }),
    ).resolves.toEqual([
      {
        type: 'interactive_buttons',
        body: '¿Qué nivel de detalle buscas para tu tatuaje?\n\n(Piensa en cuánto detalle, líneas, sombras y tinta quieres que tenga.)',
        headerImageUrl: DETAIL_GUIDE_URL,
        buttons: [
          { id: WHATSAPP_BUTTON_IDS.LIGHT, title: 'Ligero' },
          { id: WHATSAPP_BUTTON_IDS.MEDIUM, title: 'Medio' },
          { id: WHATSAPP_BUTTON_IDS.DETAILED, title: 'Detallado' },
        ],
      },
    ]);
  });

  it('keeps the existing transition after a detail button selection', async () => {
    processOptionSelection.mockResolvedValue(
      response(ConversationState.ASK_BODY_PART, [
        '¿En qué parte del cuerpo te gustaría hacerte el tatuaje?',
      ]),
    );

    await expect(
      adapter.handleIncoming({
        type: 'button_reply',
        customerIdentifier: '+51911111111',
        buttonId: WHATSAPP_BUTTON_IDS.LIGHT,
      }),
    ).resolves.toEqual([
      {
        type: 'text',
        text: '¿En qué parte del cuerpo te gustaría hacerte el tatuaje?',
      },
    ]);
    expect(processOptionSelection).toHaveBeenCalledOnce();
    expect(processOptionSelection).toHaveBeenCalledWith('+51911111111', DetailLevel.LIGHT);
  });

  it('keeps the size question and buttons available when no public guide URL is configured', async () => {
    processTextMessage.mockResolvedValue(
      response(
        ConversationState.ASK_SIZE,
        [
          '¿Qué tamaño aproximado tendrá tu tatuaje?\n\n(Las imágenes son solo ejemplos para comparar tamaños)',
        ],
        SIZE_OPTIONS,
      ),
    );
    const adapterWithoutGuide = new WhatsAppAdapter(
      {
        processOptionSelection,
        processTextMessage,
        processImageMessage,
      } as unknown as ChatbotService,
      new ConfigService(),
    );

    await expect(
      adapterWithoutGuide.handleIncoming({
        type: 'text',
        customerIdentifier: '+51911111111',
        text: 'Hola',
      }),
    ).resolves.toEqual([
      {
        type: 'interactive_buttons',
        body: '¿Qué tamaño aproximado tendrá tu tatuaje?\n\n(Las imágenes son solo ejemplos para comparar tamaños)',
        buttons: [
          { id: WHATSAPP_BUTTON_IDS.SMALL, title: 'Pequeño' },
          { id: WHATSAPP_BUTTON_IDS.MEDIUM, title: 'Mediano' },
          { id: WHATSAPP_BUTTON_IDS.LARGE, title: 'Grande' },
        ],
      },
    ]);
  });

  it.each([
    [WHATSAPP_BUTTON_IDS.SMALL, TattooSize.SMALL],
    [WHATSAPP_BUTTON_IDS.MEDIUM, TattooSize.MEDIUM],
    [WHATSAPP_BUTTON_IDS.LARGE, TattooSize.LARGE],
  ])('maps size button %s to the internal value %s', async (buttonId, value) => {
    await adapter.handleIncoming({
      type: 'button_reply',
      customerIdentifier: '+51911111111',
      buttonId,
    });

    expect(processOptionSelection).toHaveBeenCalledWith('+51911111111', value);
  });

  it.each([
    [WHATSAPP_BUTTON_IDS.LIGHT, DetailLevel.LIGHT],
    [WHATSAPP_BUTTON_IDS.MEDIUM, DetailLevel.MEDIUM],
    [WHATSAPP_BUTTON_IDS.DETAILED, DetailLevel.DETAILED],
  ])('maps detail button %s to the internal value %s', async (buttonId, value) => {
    await adapter.handleIncoming({
      type: 'button_reply',
      customerIdentifier: '+51911111111',
      buttonId,
    });

    expect(processOptionSelection).toHaveBeenCalledWith('+51911111111', value);
  });

  it('passes free body text to ChatbotService without trimming or state logic', async () => {
    await adapter.handleIncoming({
      type: 'text',
      customerIdentifier: '+51911111111',
      text: '  brazo  ',
    });

    expect(processTextMessage).toHaveBeenCalledWith('+51911111111', '  brazo  ');
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
      customerIdentifier: '+51911111111',
      image,
    });

    expect(processImageMessage).toHaveBeenCalledWith('+51911111111', image);
  });

  it('uses an equivalent text list and maps its reply when buttons are unavailable', async () => {
    processTextMessage.mockResolvedValue(
      response(
        ConversationState.ASK_SIZE,
        [
          '¿Qué tamaño aproximado tendrá tu tatuaje?\n\n(Las imágenes son solo ejemplos para comparar tamaños)',
        ],
        SIZE_OPTIONS,
      ),
    );

    const fallback = { interactiveButtons: false };
    const outgoing = await adapter.handleIncoming(
      { type: 'text', customerIdentifier: '+51911111111', text: 'Hola' },
      fallback,
    );

    expect(outgoing).toEqual([
      {
        type: 'text',
        text: '¿Qué tamaño aproximado tendrá tu tatuaje?\n\n(Las imágenes son solo ejemplos para comparar tamaños)\n\n- Pequeño\n- Mediano\n- Grande',
      },
    ]);

    await adapter.handleIncoming(
      { type: 'text', customerIdentifier: '+51911111111', text: '  Pequeño ' },
      fallback,
    );
    expect(processOptionSelection).toHaveBeenCalledWith('+51911111111', TattooSize.SMALL);
  });

  it('rejects stale or unknown button IDs before reaching ChatbotService', async () => {
    await expect(
      adapter.handleIncoming({
        type: 'button_reply',
        customerIdentifier: '+51911111111',
        buttonId: 'stale-button',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(processOptionSelection).not.toHaveBeenCalled();
  });

  it('keeps simultaneous replies from different customers separate', async () => {
    await Promise.all([
      adapter.handleIncoming({
        type: 'button_reply',
        customerIdentifier: '+51911111111',
        buttonId: WHATSAPP_BUTTON_IDS.SMALL,
      }),
      adapter.handleIncoming({
        type: 'button_reply',
        customerIdentifier: '+51922222222',
        buttonId: WHATSAPP_BUTTON_IDS.LARGE,
      }),
    ]);

    expect(processOptionSelection).toHaveBeenCalledWith('+51911111111', TattooSize.SMALL);
    expect(processOptionSelection).toHaveBeenCalledWith('+51922222222', TattooSize.LARGE);
  });
});
