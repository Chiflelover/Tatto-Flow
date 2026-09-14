import type { Request } from 'express';

export interface AuthenticatedTattooArtist {
  id: string;
  email: string;
}

export interface AuthenticatedRequest extends Request {
  sessionToken: string;
  tattooArtist: AuthenticatedTattooArtist;
}
