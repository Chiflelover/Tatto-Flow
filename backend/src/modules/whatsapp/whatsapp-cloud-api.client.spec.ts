import { BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAX_CHAT_IMAGE_SIZE_BYTES } from '../chatbot/chatbot.constants.js';
import { WHATSAPP_BUTTON_IDS } from '../chatbot/whatsapp/whatsapp.adapter.js';
import {
  isConfirmedWhatsAppSendFailure,
  WhatsAppCloudApiClient,
} from './whatsapp-cloud-api.client.js';

const TEST_CONFIGURATION = {
  WHATSAPP_ACCESS_TOKEN: 'test-access-token',
  WHATSAPP_PHONE_NUMBER_ID: '1234567890',
  WHATSAPP_BUSINESS_ACCOUNT_ID: '0987654321',
  WHATSAPP_GRAPH_API_VERSION: 'v99.0',
};
const SIZE_GUIDE_URL = 'https://tatuoflow.example/test-header.png';
const DETAIL_GUIDE_URL = 'https://tatuoflow.example/test-header.png';

function createClient() {
  return new WhatsAppCloudApiClient(new ConfigService(TEST_CONFIGURATION));
}

function successfulResponse(): Response {
  return new Response('{"messages":[{"id":"wamid.sent"}]}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseRequestBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== 'string') {
    throw new Error('Expected a JSON request body.');
  }

  return JSON.parse(init.body) as unknown;
}

describe('WhatsAppCloudApiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends a text message through the configured Graph API version and phone number', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(successfulResponse());
    vi.stubGlobal('fetch', fetchMock);

    await createClient().sendMessage('1234567890', '+51 999-999-999', {
      type: 'text',
      text: 'Hola desde Nita',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://graph.facebook.com/v99.0/1234567890/messages');
    expect(url).not.toContain(TEST_CONFIGURATION.WHATSAPP_BUSINESS_ACCOUNT_ID);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      Authorization: 'Bearer test-access-token',
      'Content-Type': 'application/json',
    });
    expect(parseRequestBody(init)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '51999999999',
      type: 'text',
      text: { preview_url: false, body: 'Hola desde Nita' },
    });
    expect(JSON.stringify(init?.headers)).not.toContain('META_APP_SECRET');
  });

  it('logs only safe Meta error fields when Graph API rejects a message', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: 'Invalid OAuth access token: test-access-token',
            type: 'OAuthException',
            code: 190,
            error_subcode: 463,
            fbtrace_id: 'safe-trace-id',
            access_token: 'test-access-token',
          },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const loggerError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createClient().sendMessage('1234567890', '51999999999', {
        type: 'text',
        text: 'Hola desde Nita',
      }),
    ).rejects.toMatchObject({ status: 401 });

    expect(loggerError).toHaveBeenCalledOnce();
    const logged = String(loggerError.mock.calls[0]?.[0]);
    expect(logged).toContain('"httpStatus":401');
    expect(logged).toContain('"event":"whatsapp.meta.error"');
    expect(logged).toContain('"metaErrorMessage":"Invalid OAuth access token: [REDACTED]"');
    expect(logged).toContain('"metaErrorType":"OAuthException"');
    expect(logged).toContain('"metaErrorCode":190');
    expect(logged).toContain('"metaErrorSubcode":463');
    expect(logged).toContain('"fbtraceId":"safe-trace-id"');
    expect(logged).not.toContain('test-access-token');
    expect(logged).not.toContain('access_token');
    expect(logged).not.toContain('Authorization');
    expect(logged).not.toContain('META_APP_SECRET');
  });

  it('sends three stable reply buttons as an interactive WhatsApp message', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(successfulResponse());
    vi.stubGlobal('fetch', fetchMock);

    await createClient().sendMessage('1234567890', '51999999999', {
      type: 'interactive_buttons',
      body: '¿Qué tamaño aproximado tendrá tu tatuaje?\n\n(Las imágenes son solo ejemplos para comparar tamaños)',
      headerImageUrl: SIZE_GUIDE_URL,
      buttons: [
        { id: WHATSAPP_BUTTON_IDS.COLOR_BLACK_ONLY, title: 'Pequeño' },
        { id: WHATSAPP_BUTTON_IDS.COLOR_SOME, title: 'Mediano' },
        { id: WHATSAPP_BUTTON_IDS.COLOR_MOSTLY, title: 'Grande' },
      ],
    });

    const body = parseRequestBody(fetchMock.mock.calls[0]?.[1]) as {
      type: string;
      interactive: {
        type: string;
        header: { type: string; image: { link: string } };
        action: { buttons: unknown[] };
      };
    };
    expect(body.type).toBe('interactive');
    expect(body.interactive.type).toBe('button');
    expect(body.interactive.header).toEqual({
      type: 'image',
      image: { link: SIZE_GUIDE_URL },
    });
    expect(body.interactive.action.buttons).toEqual([
      { type: 'reply', reply: { id: WHATSAPP_BUTTON_IDS.COLOR_BLACK_ONLY, title: 'Pequeño' } },
      { type: 'reply', reply: { id: WHATSAPP_BUTTON_IDS.COLOR_SOME, title: 'Mediano' } },
      { type: 'reply', reply: { id: WHATSAPP_BUTTON_IDS.COLOR_MOSTLY, title: 'Grande' } },
    ]);
  });

  it('identifies a configuration failure before any request as confirmed not sent', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const client = new WhatsAppCloudApiClient(new ConfigService({}));
    const error = await client
      .sendMessage('1234567890', '51999999999', { type: 'text', text: 'Precio' })
      .catch((value: unknown) => value);
    expect(isConfirmedWhatsAppSendFailure(error)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  const colorList = {
    type: 'interactive_list' as const,
    body: '¿Qué nivel de color quieres para tu tatuaje?',
    button: 'Elegir color',
    rows: [
      { id: WHATSAPP_BUTTON_IDS.COLOR_BLACK_ONLY, title: 'Negro' },
      { id: WHATSAPP_BUTTON_IDS.COLOR_LOW, title: 'Poco color' },
      { id: WHATSAPP_BUTTON_IDS.COLOR_MEDIUM, title: 'Color medio' },
      { id: WHATSAPP_BUTTON_IDS.COLOR_FULL, title: 'Full color' },
    ],
  };
  it('sends the four client colors through an interactive list', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(successfulResponse());
    vi.stubGlobal('fetch', fetchMock);
    await createClient().sendMessage('1234567890', '51999999999', colorList);
    expect(parseRequestBody(fetchMock.mock.calls[0]?.[1])).toMatchObject({
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: colorList.body },
        action: { button: 'Elegir color', sections: [{ rows: colorList.rows }] },
      },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('preserves all four choices in text after a confirmed list rejection', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 400 }))
      .mockResolvedValueOnce(successfulResponse());
    vi.stubGlobal('fetch', fetchMock);
    await createClient().sendMessage('1234567890', '51999999999', colorList);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(parseRequestBody(fetchMock.mock.calls[1]?.[1])).toMatchObject({
      type: 'text',
      text: { body: `${colorList.body}\n\n- Negro\n- Poco color\n- Color medio\n- Full color` },
    });
  });
  it('does not retry a list after an ambiguous transport failure', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('Connection lost'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      createClient().sendMessage('1234567890', '51999999999', colorList),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([400, 429, 408, 500])(
    'classifies HTTP %s without assuming server timeouts failed',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status })),
      );
      const error = await createClient()
        .sendMessage('1234567890', '51999999999', { type: 'text', text: 'Precio' })
        .catch((value: unknown) => value);
      expect(isConfirmedWhatsAppSendFailure(error)).toBe(status === 400 || status === 429);
    },
  );

  it('does not retry an interactive message without its image after an ambiguous transport failure', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('Connection lost'));
    vi.stubGlobal('fetch', fetchMock);
    const error = await createClient()
      .sendMessage('1234567890', '51999999999', {
        type: 'interactive_buttons',
        body: 'Pregunta',
        headerImageUrl: SIZE_GUIDE_URL,
        buttons: [{ id: 'option', title: 'Elegir' }],
      })
      .catch((value: unknown) => value);
    expect(isConfirmedWhatsAppSendFailure(error)).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('retries the same size buttons without the image when its delivery fails', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 400 }))
      .mockResolvedValueOnce(successfulResponse());
    vi.stubGlobal('fetch', fetchMock);

    await createClient().sendMessage('1234567890', '51999999999', {
      type: 'interactive_buttons',
      body: '¿Qué tamaño aproximado tendrá tu tatuaje?\n\n(Las imágenes son solo ejemplos para comparar tamaños)',
      headerImageUrl: SIZE_GUIDE_URL,
      buttons: [
        { id: WHATSAPP_BUTTON_IDS.COLOR_BLACK_ONLY, title: 'Pequeño' },
        { id: WHATSAPP_BUTTON_IDS.COLOR_SOME, title: 'Mediano' },
        { id: WHATSAPP_BUTTON_IDS.COLOR_MOSTLY, title: 'Grande' },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retriedBody = parseRequestBody(fetchMock.mock.calls[1]?.[1]) as {
      interactive: {
        header?: unknown;
        body: { text: string };
        action: { buttons: unknown[] };
      };
    };
    expect(retriedBody.interactive.header).toBeUndefined();
    expect(retriedBody.interactive.body.text).toContain('¿Qué tamaño aproximado tendrá');
    expect(retriedBody.interactive.action.buttons).toHaveLength(3);
  });

  it('retries the same detail buttons without the image when its delivery fails', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 400 }))
      .mockResolvedValueOnce(successfulResponse());
    vi.stubGlobal('fetch', fetchMock);

    await createClient().sendMessage('1234567890', '51999999999', {
      type: 'interactive_buttons',
      body: '¿Qué nivel de detalle buscas para tu tatuaje?\n\n(Piensa en cuánto detalle, líneas, sombras y tinta quieres que tenga.)',
      headerImageUrl: DETAIL_GUIDE_URL,
      buttons: [
        { id: WHATSAPP_BUTTON_IDS.COLOR_BLACK_ONLY, title: 'Ligero' },
        { id: WHATSAPP_BUTTON_IDS.COLOR_SOME, title: 'Medio' },
        { id: WHATSAPP_BUTTON_IDS.COLOR_MOSTLY, title: 'Detallado' },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = parseRequestBody(fetchMock.mock.calls[0]?.[1]) as {
      interactive: { header?: unknown; action: { buttons: unknown[] } };
    };
    const retriedBody = parseRequestBody(fetchMock.mock.calls[1]?.[1]) as {
      interactive: {
        header?: unknown;
        body: { text: string };
        action: { buttons: unknown[] };
      };
    };
    expect(firstBody.interactive.header).toEqual({
      type: 'image',
      image: { link: DETAIL_GUIDE_URL },
    });
    expect(retriedBody.interactive.header).toBeUndefined();
    expect(retriedBody.interactive.body.text).toContain('¿Qué nivel de detalle buscas');
    expect(retriedBody.interactive.action.buttons).toEqual(firstBody.interactive.action.buttons);
  });

  it('falls back to an equivalent text list after a deterministic button rejection', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 400 }))
      .mockResolvedValueOnce(successfulResponse());
    vi.stubGlobal('fetch', fetchMock);

    await createClient().sendMessage('1234567890', '51999999999', {
      type: 'interactive_buttons',
      body: '¿Qué nivel de detalle buscas para tu tatuaje?\n\n(Piensa en cuánto detalle, líneas, sombras y tinta quieres que tenga.)',
      buttons: [
        { id: WHATSAPP_BUTTON_IDS.COLOR_BLACK_ONLY, title: 'Ligero' },
        { id: WHATSAPP_BUTTON_IDS.COLOR_SOME, title: 'Medio' },
        { id: WHATSAPP_BUTTON_IDS.COLOR_MOSTLY, title: 'Detallado' },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const fallback = parseRequestBody(fetchMock.mock.calls[1]?.[1]) as {
      type: string;
      text: { body: string };
    };
    expect(fallback.type).toBe('text');
    expect(fallback.text.body).toBe(
      '¿Qué nivel de detalle buscas para tu tatuaje?\n\n(Piensa en cuánto detalle, líneas, sombras y tinta quieres que tenga.)\n\n- Ligero\n- Medio\n- Detallado',
    );
  });

  it('resolves a Meta media ID and securely downloads a valid image', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            url: 'https://lookaside.fbsbx.com/whatsapp-test-image',
            mime_type: 'image/png',
            file_size: png.byteLength,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(png, {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'Content-Length': String(png.byteLength),
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(createClient().downloadImage('1234567890', '987654321')).resolves.toEqual({
      content: new Uint8Array(png),
      mimeType: 'image/png',
      fileName: 'whatsapp-reference.png',
    });
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(
      new URL('https://graph.facebook.com/v99.0/987654321?phone_number_id=1234567890'),
    );
    expect(fetchMock.mock.calls[1]?.[0]).toEqual(
      new URL('https://lookaside.fbsbx.com/whatsapp-test-image'),
    );
  });

  it('rejects oversized media metadata before downloading the file', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          url: 'https://lookaside.fbsbx.com/oversized',
          mime_type: 'image/png',
          file_size: MAX_CHAT_IMAGE_SIZE_BYTES + 1,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(createClient().downloadImage('1234567890', '987654321')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not forward the access token to a media URL outside Meta domains', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          url: 'https://attacker.example/collect-token',
          mime_type: 'image/png',
          file_size: 8,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(createClient().downloadImage('1234567890', '987654321')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
