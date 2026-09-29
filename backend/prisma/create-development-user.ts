import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from '../src/modules/auth/password-hasher.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../src/modules/auth/password-policy.js';
import { PrismaClient, UserRole } from '../src/generated/prisma/client.js';
import { LEGACY_ACCOUNT_ID } from '../src/modules/accounts/account.constants.js';

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const email = process.env.TATTOO_ARTIST_EMAIL?.trim().toLowerCase();
const password = process.env.TATTOO_ARTIST_PASSWORD;

if (!connectionString) {
  throw new Error('DIRECT_URL or DATABASE_URL is required to create the development user.');
}

if (!email || !email.includes('@')) {
  throw new Error('TATTOO_ARTIST_EMAIL must contain a valid email.');
}

if (!password || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
  throw new Error(
    `TATTOO_ARTIST_PASSWORD must contain between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`,
  );
}

const tattooArtistEmail = email;
const tattooArtistPassword = password;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main(): Promise<void> {
  try {
    const existing = await prisma.user.findUnique({ where: { email: tattooArtistEmail } });
    if (existing?.role === UserRole.ADMIN) {
      throw new Error('El correo ya pertenece a un administrador.');
    }
    if (existing?.accountId && existing.accountId !== LEGACY_ACCOUNT_ID) {
      throw new Error('El correo ya pertenece a otra cuenta de tatuador.');
    }
    const legacyOwner = await prisma.user.findUnique({ where: { accountId: LEGACY_ACCOUNT_ID } });
    if (legacyOwner && legacyOwner.email !== tattooArtistEmail) {
      throw new Error('La cuenta heredada ya tiene otro usuario.');
    }
    const passwordHash = await hashPassword(tattooArtistPassword);

    await prisma.user.upsert({
      where: { email: tattooArtistEmail },
      update: { passwordHash, role: UserRole.TATTOO_ARTIST, accountId: LEGACY_ACCOUNT_ID },
      create: {
        email: tattooArtistEmail,
        passwordHash,
        role: UserRole.TATTOO_ARTIST,
        accountId: LEGACY_ACCOUNT_ID,
      },
    });

    console.info('Development tattoo artist user is ready.');
  } finally {
    await prisma.$disconnect();
  }
}

void main();
