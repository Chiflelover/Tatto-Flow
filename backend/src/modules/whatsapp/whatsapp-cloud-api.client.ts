import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SafeStructuredLogger } from '../../infrastructure/observability/safe-structured-logger.js';
import { MAX_CHAT_IMAGE_SIZE_BYTES } from '../chatbot/chatbot.constants.js';
import type { ChatbotImageInput } from '../chatbot/domain/chatbot.types.js';
import type { WhatsAppOutboundMessage } from '../chatbot/whatsapp/whatsapp.adapter.js';
import { validateLeadImageFile } from '../storage/lead-image-file.js';
import { getWhatsAppGraphConfiguration } from './whatsapp.config.js';

interface MetaMediaMetadata {
  url: string;
  mime_type?: string;
  file_size?: number;
}

interface MetaApiErrorDetails {
  message: string | null;
  type: string | null;
  code: number | null;
  errorSubcode: number | null;
  fbtraceId: string | null;
}

class WhatsAppCloudApiError extends Error {
  constructor(readonly status: number) {
    super('WhatsApp Cloud API rechazó la solicitud.');
  }
}

@Injectable()
export class WhatsAppCloudApiClient {
  private readonly logger = new SafeStructuredLogger(WhatsAppCloudApiClient.name);

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async sendMessage(recipient: string, message: WhatsAppOutboundMessage): Promise<void> {
    const normalizedRecipient = this.normalizeRecipient(recipient);

    if (message.type === 'text') {
      await this.sendText(normalizedRecipient, message.text);
      return;
    }

    if (message.headerImageUrl) {
      try {
        await this.sendButtons(
          normalizedRecipient,
          message.body,
          message.buttons,
          message.headerImageUrl,
        );
        return;
      } catch {
        this.logger.warn('whatsapp.visual_guide.unavailable');
      }
    }

    try {
      await this.sendButtons(normalizedRecipient, message.body, message.buttons);
    } catch (error) {
      if (!(error instanceof WhatsAppCloudApiError) || error.status !== 400) {
        throw error;
      }

      await this.sendText(
        normalizedRecipient,
        `${message.body}\n\n${message.buttons.map(({ title }) => `- ${title}`).join('\n')}`,
      );
    }
  }

  async downloadImage(mediaId: string): Promise<ChatbotImageInput> {
    if (!mediaId || mediaId.length > 255) {
      throw new BadRequestException('La imagen de WhatsApp no contiene un media ID válido.');
    }

    const configuration = getWhatsAppGraphConfiguration(this.config);
    const metadataUrl = new URL(
      `${this.graphBaseUrl(configuration.version)}/${encodeURIComponent(mediaId)}`,
    );
    metadataUrl.searchParams.set('phone_number_id', configuration.phoneNumberId);
    const metadata = await this.requestJson<MetaMediaMetadata>(metadataUrl, {
      headers: this.authorizationHeaders(configuration.accessToken),
    });

    const mediaUrl = this.parseMediaDownloadUrl(metadata.url);

    if (
      (typeof metadata.file_size === 'number' && metadata.file_size < 0) ||
      (typeof metadata.file_size === 'number' && metadata.file_size > MAX_CHAT_IMAGE_SIZE_BYTES)
    ) {
      throw new BadRequestException('La imagen de WhatsApp no es válida o supera los 5 MB.');
    }

    const response = await this.safeFetch(mediaUrl, {
      headers: this.authorizationHeaders(configuration.accessToken),
      redirect: 'error',
    });

    if (!response.ok) {
      throw await this.createApiError(response);
    }

    const declaredLength = Number(response.headers.get('content-length'));

    if (Number.isFinite(declaredLength) && declaredLength > MAX_CHAT_IMAGE_SIZE_BYTES) {
      throw new BadRequestException('La imagen de WhatsApp no puede superar los 5 MB.');
    }

    const content = await this.readLimitedBody(response);
    const mimeType = (response.headers.get('content-type') ?? metadata.mime_type ?? '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    const image: ChatbotImageInput = { content, mimeType };
    const validated = validateLeadImageFile(image);

    return {
      ...image,
      fileName: `whatsapp-reference.${validated.extension}`,
    };
  }

  private async sendText(recipient: string, text: string): Promise<void> {
    if (!text.trim()) {
      return;
    }

    await this.postMessage({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'text',
      text: { preview_url: false, body: text },
    });
  }

  private async sendButtons(
    recipient: string,
    body: string,
    buttons: Array<{ id: string; title: string }>,
    headerImageUrl?: string,
  ): Promise<void> {
    if (
      !body.trim() ||
      buttons.length < 1 ||
      buttons.length > 3 ||
      buttons.some(({ id, title }) => !id || id.length > 256 || !title || title.length > 20)
    ) {
      throw new BadRequestException('El mensaje interactivo de WhatsApp no es válido.');
    }

    if (headerImageUrl && !this.isPublicHttpsUrl(headerImageUrl)) {
      throw new BadRequestException('La imagen del mensaje interactivo no es válida.');
    }

    await this.postMessage({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'interactive',
      interactive: {
        type: 'button',
        ...(headerImageUrl ? { header: { type: 'image', image: { link: headerImageUrl } } } : {}),
        body: { text: body },
        action: {
          buttons: buttons.map(({ id, title }) => ({
            type: 'reply',
            reply: { id, title },
          })),
        },
      },
    });
  }

  private async postMessage(body: object): Promise<void> {
    const configuration = getWhatsAppGraphConfiguration(this.config);
    const url = `${this.graphBaseUrl(configuration.version)}/${configuration.phoneNumberId}/messages`;
    const response = await this.safeFetch(url, {
      method: 'POST',
      headers: {
        ...this.authorizationHeaders(configuration.accessToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw await this.createApiError(response);
    }
  }

  private async requestJson<T>(url: URL, init: RequestInit): Promise<T> {
    const response = await this.safeFetch(url, init);

    if (!response.ok) {
      throw await this.createApiError(response);
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new ServiceUnavailableException('WhatsApp Cloud API devolvió una respuesta inválida.');
    }
  }

  private async safeFetch(input: string | URL, init: RequestInit): Promise<Response> {
    try {
      return await fetch(input, init);
    } catch {
      throw new ServiceUnavailableException('No fue posible conectar con WhatsApp Cloud API.');
    }
  }

  private async readLimitedBody(response: Response): Promise<Uint8Array> {
    if (!response.body) {
      throw new BadRequestException('La imagen de WhatsApp está vacía.');
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      size += value.byteLength;

      if (size > MAX_CHAT_IMAGE_SIZE_BYTES) {
        await reader.cancel();
        throw new BadRequestException('La imagen de WhatsApp no puede superar los 5 MB.');
      }

      chunks.push(value);
    }

    const content = new Uint8Array(size);
    let offset = 0;

    for (const chunk of chunks) {
      content.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return content;
  }

  private authorizationHeaders(accessToken: string): Record<string, string> {
    return { Authorization: `Bearer ${accessToken}` };
  }

  private async createApiError(response: Response): Promise<WhatsAppCloudApiError> {
    const details = await this.readMetaApiError(response);
    const diagnostic = {
      httpStatus: response.status,
      metaErrorMessage: details.message,
      metaErrorType: details.type,
      metaErrorCode: details.code,
      metaErrorSubcode: details.errorSubcode,
      fbtraceId: details.fbtraceId,
    };

    this.logger.error('whatsapp.meta.error', diagnostic);

    return new WhatsAppCloudApiError(response.status);
  }

  private async readMetaApiError(response: Response): Promise<MetaApiErrorDetails> {
    const empty: MetaApiErrorDetails = {
      message: null,
      type: null,
      code: null,
      errorSubcode: null,
      fbtraceId: null,
    };

    try {
      const payload = (await response.json()) as unknown;

      if (!this.isRecord(payload) || !this.isRecord(payload.error)) {
        return empty;
      }

      const metaError = payload.error;
      const accessToken = this.config.get<string>('WHATSAPP_ACCESS_TOKEN')?.trim() ?? '';

      return {
        message: this.safeMetaErrorText(metaError.message, accessToken, 1_000),
        type: this.safeMetaErrorText(metaError.type, accessToken, 255),
        code: this.safeMetaErrorNumber(metaError.code),
        errorSubcode: this.safeMetaErrorNumber(metaError.error_subcode),
        fbtraceId: this.safeMetaErrorText(metaError.fbtrace_id, accessToken, 255),
      };
    } catch {
      return empty;
    }
  }

  private safeMetaErrorText(value: unknown, accessToken: string, maxLength: number): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    let sanitized = value.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');

    if (accessToken) {
      sanitized = sanitized.replaceAll(accessToken, '[REDACTED]');
    }

    return sanitized.slice(0, maxLength);
  }

  private safeMetaErrorNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private graphBaseUrl(version: string): string {
    return `https://graph.facebook.com/${version}`;
  }

  private isPublicHttpsUrl(value: string): boolean {
    if (value.length > 2_048) {
      return false;
    }

    try {
      const url = new URL(value);

      return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      return false;
    }
  }

  private parseMediaDownloadUrl(value: unknown): URL {
    if (typeof value !== 'string' || value.length > 4_096) {
      throw new BadRequestException('La imagen de WhatsApp no es válida o supera los 5 MB.');
    }

    let url: URL;

    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException('La imagen de WhatsApp no es válida o supera los 5 MB.');
    }

    const allowedHosts = ['facebook.com', 'fbcdn.net', 'fbsbx.com'];
    const isAllowedHost = allowedHosts.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    );

    if (url.protocol !== 'https:' || !isAllowedHost || url.username || url.password) {
      throw new BadRequestException('La imagen de WhatsApp no es válida o supera los 5 MB.');
    }

    return url;
  }

  private normalizeRecipient(recipient: string): string {
    const normalized = recipient.replace(/\D/g, '');

    if (!/^\d{5,20}$/.test(normalized)) {
      throw new BadRequestException('El destinatario de WhatsApp no es válido.');
    }

    return normalized;
  }
}
