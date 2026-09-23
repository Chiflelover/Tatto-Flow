import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

export type WhatsAppConfigKey =
  | 'WHATSAPP_ACCESS_TOKEN'
  | 'WHATSAPP_PHONE_NUMBER_ID'
  | 'WHATSAPP_BUSINESS_ACCOUNT_ID'
  | 'WHATSAPP_VERIFY_TOKEN'
  | 'META_APP_SECRET'
  | 'WHATSAPP_GRAPH_API_VERSION';

export function getRequiredWhatsAppValue(config: ConfigService, key: WhatsAppConfigKey): string {
  const value = config.get<string>(key)?.trim();

  if (!value) {
    throw new ServiceUnavailableException('La integración de WhatsApp no está configurada.');
  }

  return value;
}

export function getWhatsAppGraphConfiguration(config: ConfigService) {
  const version = getRequiredWhatsAppValue(config, 'WHATSAPP_GRAPH_API_VERSION');
  const phoneNumberId = getRequiredWhatsAppValue(config, 'WHATSAPP_PHONE_NUMBER_ID');

  if (!/^v\d+\.\d+$/.test(version) || !/^\d+$/.test(phoneNumberId)) {
    throw new ServiceUnavailableException('La integración de WhatsApp no está configurada.');
  }

  return {
    accessToken: getRequiredWhatsAppValue(config, 'WHATSAPP_ACCESS_TOKEN'),
    phoneNumberId,
    version,
  };
}
