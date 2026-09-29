import type { Request } from 'express';
import type { UserRole } from '../../generated/prisma/client.js';

export interface AuthenticatedTattooArtist {
  id: string;
  email: string;
  role: UserRole;
  accountId: string | null;
}

export interface AuthenticatedRequest extends Request {
  sessionToken: string;
  tattooArtist: AuthenticatedTattooArtist;
}
