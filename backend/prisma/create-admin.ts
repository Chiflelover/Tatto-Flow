import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '../src/generated/prisma/client.js';
import { hashPassword } from '../src/modules/auth/password-hasher.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../src/modules/auth/password-policy.js';

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (
  !connectionString ||
  !email ||
  !email.includes('@') ||
  !password ||
  password.length < PASSWORD_MIN_LENGTH ||
  password.length > PASSWORD_MAX_LENGTH
) {
  throw new Error(
    'Configure DIRECT_URL, ADMIN_EMAIL y ADMIN_PASSWORD válido antes de crear el administrador.',
  );
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
try {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.role !== UserRole.ADMIN) {
    throw new Error('El correo ya pertenece a un tatuador.');
  }
  const passwordHash = await hashPassword(password);
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash, role: UserRole.ADMIN },
  });
  console.info('Administrador global preparado.');
} finally {
  await prisma.$disconnect();
}
