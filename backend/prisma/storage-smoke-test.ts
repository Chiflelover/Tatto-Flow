import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { validateEnvironment } from '../src/config/environment.validation.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';
import { LeadImageService } from '../src/modules/storage/lead-image.service.js';
import { SupabaseStorageService } from '../src/modules/storage/supabase-storage.service.js';

const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const environment = validateEnvironment(process.env);
const connectionString = environment.DATABASE_URL;

if (typeof connectionString !== 'string' || !connectionString) {
  throw new Error('DATABASE_URL no está configurada.');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});
const storage = new SupabaseStorageService(
  environment.SUPABASE_URL as string,
  environment.SUPABASE_SECRET_KEY as string,
  environment.SUPABASE_STORAGE_BUCKET as string,
);
const leadImages = new LeadImageService(prisma as unknown as PrismaService, storage);
let customerId: string | undefined;
let leadId: string | undefined;
let storagePath: string | undefined;

try {
  await storage.verifyPrivateBucket();

  const customer = await prisma.customer.create({
    data: { phoneNumber: `test-${randomUUID().slice(0, 15)}` },
  });
  customerId = customer.id;

  const lead = await prisma.lead.create({
    data: {
      customerId,
      selectedSize: 'SMALL',
      selectedDetail: 'LIGHT',
      bodyPart: 'Prueba',
    },
  });
  leadId = lead.id;

  const image = await leadImages.ensureStored(leadId, {
    content: ONE_PIXEL_PNG,
    mimeType: 'image/png',
    fileName: 'ignored-client-name.png',
  });
  storagePath = image.storagePath;

  const persistedImage = await prisma.leadImage.findUnique({ where: { id: image.id } });

  if (!persistedImage || persistedImage.leadId !== leadId || persistedImage.deletedAt !== null) {
    throw new Error('LeadImage no quedó persistido correctamente.');
  }

  if (persistedImage.expiresAt.getTime() - persistedImage.createdAt.getTime() !== FIFTEEN_DAYS_MS) {
    throw new Error('La retención de LeadImage no es exactamente de 15 días.');
  }

  if (!(await storage.exists(storagePath))) {
    throw new Error('El objeto de prueba no existe después del upload.');
  }

  const signedUrl = await storage.createSignedUrl(storagePath, 5 * 60);
  const response = await fetch(signedUrl, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error('La URL firmada no permitió descargar la imagen.');
  }

  await storage.delete(storagePath);

  if (await storage.exists(storagePath)) {
    throw new Error('El objeto de prueba no pudo eliminarse.');
  }

  storagePath = undefined;
  console.info('Supabase Storage smoke test: OK; test artifacts removed.');
} finally {
  if (storagePath) {
    try {
      await storage.delete(storagePath);
    } catch {
      console.error('No se pudo confirmar la limpieza del objeto aislado de prueba.');
    }
  }

  if (leadId) {
    await prisma.lead.deleteMany({ where: { id: leadId } });
  }

  if (customerId) {
    await prisma.customer.deleteMany({ where: { id: customerId } });
  }

  await prisma.$disconnect();
}
