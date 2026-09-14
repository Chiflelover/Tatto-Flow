const DASHBOARD_API_BASE = '/api';

export type LeadStatus =
  'ANALYZING' | 'VERIFIED' | 'REQUIRES_REVIEW' | 'HANDOFF_TO_TATTOO_ARTIST' | 'COMPLETED';

export interface PriceRange {
  minimum: string;
  maximum: string;
}

export interface LeadSummary {
  id: string;
  customerPhoneNumber: string;
  selectedSize: 'SMALL' | 'MEDIUM' | 'LARGE';
  selectedSizeLabel: string;
  selectedDetail: 'LIGHT' | 'MEDIUM' | 'DETAILED';
  selectedDetailLabel: string;
  bodyPart: string;
  status: LeadStatus;
  statusLabel: string;
  createdAt: string;
  price: PriceRange | null;
}

export interface LeadDetail extends LeadSummary {
  analysis: {
    detectedSize: 'SMALL' | 'MEDIUM' | 'LARGE';
    detectedSizeLabel: string;
    sizeConfidence: number;
    detectedDetail: 'LIGHT' | 'MEDIUM' | 'DETAILED';
    detectedDetailLabel: string;
    detailConfidence: number;
  } | null;
  reviewMessages: string[];
  priceSentAt: string | null;
  whatsappUrl: string | null;
}

export interface LeadReferenceAccess {
  available: boolean;
  signedUrl: string | null;
  expiresInSeconds: number | null;
  message: string | null;
}

export interface DashboardMetrics {
  totals: {
    newOrders: number;
    verified: number;
    requiresReview: number;
    completed: number;
  };
  recentLeads: LeadSummary[];
}

export interface PricingRuleView {
  id: string;
  size: 'SMALL' | 'MEDIUM' | 'LARGE';
  sizeLabel: string;
  sizeRange: string;
  detail: 'LIGHT' | 'MEDIUM' | 'DETAILED';
  detailLabel: string;
  minPrice: string;
  maxPrice: string;
}

export interface PricingRuleUpdate {
  pricingRuleId: string;
  minPrice: number;
  maxPrice: number;
}

export interface UpdatePricingRulesResult {
  rules: PricingRuleView[];
  updatedCount: number;
  message: string;
}

export interface TattooArtistSession {
  user: { id: string; email: string };
}

export interface SendPriceResult {
  sent: boolean;
  alreadySent: boolean;
  confirmation: string;
  priceSentAt: string;
}

export class DashboardApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();

    if (typeof body === 'object' && body !== null && 'message' in body) {
      const message = body.message;

      if (typeof message === 'string') {
        return message;
      }

      if (Array.isArray(message) && message.every((item) => typeof item === 'string')) {
        return message.join(' ');
      }
    }
  } catch {
    // A friendly message below avoids exposing transport or server details.
  }

  return 'No pudimos completar la solicitud. Inténtalo nuevamente.';
}

async function dashboardRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${DASHBOARD_API_BASE}/${path}`, {
      ...init,
      credentials: 'include',
      cache: 'no-store',
    });
  } catch {
    throw new DashboardApiError(
      'No pudimos conectar con Tatto Flow. Comprueba que el backend esté activo.',
      0,
    );
  }

  if (!response.ok) {
    throw new DashboardApiError(await readError(response), response.status);
  }

  return (await response.json()) as T;
}

function jsonRequest<T>(path: string, method: 'POST' | 'PATCH', body?: object): Promise<T> {
  return dashboardRequest<T>(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function login(email: string, password: string): Promise<TattooArtistSession> {
  return jsonRequest('auth/login', 'POST', { email, password });
}

export function logout(): Promise<{ success: boolean }> {
  return jsonRequest('auth/logout', 'POST');
}

export function getSession(): Promise<TattooArtistSession> {
  return dashboardRequest('auth/session');
}

export function getDashboardMetrics(): Promise<DashboardMetrics> {
  return dashboardRequest('dashboard/metrics');
}

export function listLeads(filter: string): Promise<{ leads: LeadSummary[] }> {
  return dashboardRequest(`dashboard/leads?filter=${encodeURIComponent(filter)}`);
}

export function getLead(leadId: string): Promise<LeadDetail> {
  return dashboardRequest(`dashboard/leads/${encodeURIComponent(leadId)}`);
}

export function getLeadReference(leadId: string): Promise<LeadReferenceAccess> {
  return dashboardRequest(`dashboard/leads/${encodeURIComponent(leadId)}/reference`);
}

export function saveManualPrice(
  leadId: string,
  minPrice: number,
  maxPrice: number,
): Promise<LeadDetail> {
  return jsonRequest(`dashboard/leads/${encodeURIComponent(leadId)}/price`, 'PATCH', {
    minPrice,
    maxPrice,
  });
}

export function sendPrice(leadId: string): Promise<SendPriceResult> {
  return jsonRequest(`dashboard/leads/${encodeURIComponent(leadId)}/send-price`, 'POST');
}

export function completeLead(leadId: string): Promise<LeadDetail> {
  return jsonRequest(`dashboard/leads/${encodeURIComponent(leadId)}/complete`, 'PATCH');
}

export function getPricingRules(): Promise<{ rules: PricingRuleView[] }> {
  return dashboardRequest('dashboard/pricing');
}

export function updatePricingRules(
  updates: PricingRuleUpdate[],
): Promise<UpdatePricingRulesResult> {
  return jsonRequest('dashboard/pricing', 'PATCH', { updates });
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof DashboardApiError && error.status === 401;
}

export function dashboardErrorMessage(error: unknown): string {
  return error instanceof DashboardApiError
    ? error.message
    : 'Ocurrió un problema inesperado. Inténtalo nuevamente.';
}
