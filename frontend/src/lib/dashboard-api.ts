const DASHBOARD_API_BASE = '/api';

export type LeadStatus =
  | 'ANALYZING'
  | 'VERIFIED'
  | 'REQUIRES_REVIEW'
  | 'HANDOFF_TO_TATTOO_ARTIST'
  | 'COMPLETED'
  | 'AUTO_QUOTED'
  | 'SPECIAL_REVIEW'
  | 'READY_TO_COORDINATE';

export type BookingIntent = 'DIRECT_BOOKING' | 'ARTIST_CONTACT';
export interface V2LeadPreparation {
  style: string | null;
  targetAreaCm2: string | null;
  targetColorCoverage: number | null;
  bookingIntent: BookingIntent | null;
  decision:
    | 'READY_FOR_PRICING'
    | 'HUMAN_REVIEW'
    | 'SPECIAL_REVIEW'
    | 'ASK_TARGET_SIZE_AFTER_ANALYSIS'
    | 'INVALID_REFERENCE'
    | null;
  reviewReasons: string[];
  specialReviewTypes: string[];
}

export type ReadinessStatus = 'LISTO' | 'REVISAR' | 'INCOMPLETO';
export type TattooSize = 'SMALL' | 'MEDIUM' | 'LARGE';
export type DetailLevel = 'LIGHT' | 'MEDIUM' | 'DETAILED';
export type LeadSortField = 'readinessScore' | 'price' | 'createdAt' | 'size' | 'detail' | 'status';
export type SortOrder = 'asc' | 'desc';

export interface LeadScoringContribution {
  ruleId: string;
  points: number;
  reason: string;
}

export interface LeadScoringBlocker {
  ruleId: string;
  reason: string;
}

export interface PriceRange {
  minimum: string;
  maximum: string;
}

export interface LeadSummary {
  id: string;
  customerPhoneNumber: string;
  selectedSize: TattooSize | null;
  selectedSizeLabel: string | null;
  selectedDetail: DetailLevel | null;
  selectedDetailLabel: string | null;
  bodyPart: string | null;
  status: LeadStatus;
  statusLabel: string;
  createdAt: string;
  archivedAt: string | null;
  manualFinalPrice: string | null;
  price: PriceRange | null;
  quote: {
    id: string;
    amount: string;
    currency: string;
    pricingModelVersionId: string;
    algorithmVersion: string;
    createdAt: string;
  } | null;
  v2: V2LeadPreparation | null;
  deletable: boolean;
  readiness: {
    status: ReadinessStatus;
    score: number;
    rawScore: number;
    rulesVersion: number;
  } | null;
  confidence: {
    size: number;
    detail: number;
  } | null;
}

export interface LeadDetail extends LeadSummary {
  visionV2: {
    style: string | null;
    overallConfidence: number | null;
    referenceMainDimensionCm: number | null;
    referenceAreaCm2: number | null;
    scaleReferenceType: 'NONE' | 'BODY_CONTEXT' | 'EXPLICIT_REFERENCE' | null;
    scaleConfidence: number | null;
    colorCoverage: number | null;
  } | null;
  analysis: {
    detectedSize: TattooSize;
    detectedSizeLabel: string;
    sizeConfidence: number;
    detectedDetail: DetailLevel;
    detectedDetailLabel: string;
    detailConfidence: number;
  } | null;
  evaluation: {
    rawScore: number;
    maxPositiveScore: number;
    readinessScore: number;
    status: ReadinessStatus;
    rulesVersion: number;
    contributions: LeadScoringContribution[];
    blockers: LeadScoringBlocker[];
    evaluatedAt: string;
  } | null;
  whatsappUrl: string | null;
}

export interface LeadReferenceAccess {
  available: boolean;
  imageId: string | null;
  signedUrl: string | null;
  expiresInSeconds: number | null;
  message: string | null;
}

export interface ManagedImageView {
  id: string;
  accountId: string;
  accountName: string;
  customerPhoneNumber: string;
  leadId: string;
  createdAt: string;
  previewUrl: string | null;
}

export function listManagedImages(
  filters: { accountId?: string; from?: string; to?: string; phone?: string; page?: number } = {},
): Promise<{ images: ManagedImageView[]; page: number; total: number; totalPages: number }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, String(value));
  const search = params.toString();
  return dashboardRequest(`admin/images${search ? `?${search}` : ''}`);
}

export function deleteManagedImages(ids: string[]): Promise<{
  deletedCount: number;
  results: (
    | { id: string; status: 'deleted' | 'already_deleted' | 'not_found' }
    | { id: string; status: 'retry_required'; stage: 'lookup' | 'storage' | 'metadata' }
  )[];
}> {
  return jsonRequest('admin/images/delete', 'POST', { ids });
}

export function getImageDownload(
  id: string,
): Promise<{ url: string; fileName: string; expiresInSeconds: number }> {
  return dashboardRequest(`dashboard/images/${encodeURIComponent(id)}/download`);
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

export interface CalibrationStyleView {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
  caseCount: number;
  activeVersion: number | null;
}

export interface CalibrationDraftView {
  id: string;
  styleId: string;
  styleName: string;
  version: number;
  answeredCount: number;
  totalCount: number;
  cases: { id: string; imageUrl: string; position: number; pricePen: string | null }[];
}

export interface PricingModelView {
  id: string;
  styleId: string;
  styleName: string;
  styleCode: string;
  version: number;
  status: 'DRAFT' | 'ACTIVE' | 'SUPERSEDED';
  algorithmVersion: string;
  adjustmentPercent: string;
  sourceVersionId: string | null;
  createdAt: string;
  activatedAt: string | null;
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
  user: { id: string; email: string; role: 'ADMIN' | 'TATTOO_ARTIST'; accountId: string | null };
}

export interface ArtistAccountView {
  id: string;
  name: string;
  email: string | null;
  isActive: boolean;
  phoneNumber: string | null;
  phoneNumberId: string | null;
  contactUrl: string | null;
  createdAt: string;
}

export interface CreateArtistAccountInput {
  name: string;
  email: string;
  password: string;
  phoneNumber: string;
  phoneNumberId: string;
  isActive: boolean;
}

export interface UpdateArtistAccountInput {
  name?: string;
  password?: string;
  phoneNumber?: string;
  phoneNumberId?: string;
  isActive?: boolean;
}

export interface LeadListQuery {
  status?: ReadinessStatus;
  archived?: boolean;
  size?: TattooSize;
  detail?: DetailLevel;
  search?: string;
  sortBy?: LeadSortField;
  sortOrder?: SortOrder;
  page?: number;
  pageSize?: number;
}

export interface LeadPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface LeadListResult {
  leads: LeadSummary[];
  pagination: LeadPagination;
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
      'No pudimos conectar con Tatuoflow. Comprueba que el backend esté activo.',
      0,
    );
  }

  if (!response.ok) {
    throw new DashboardApiError(await readError(response), response.status);
  }

  return (await response.json()) as T;
}

function jsonRequest<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?: object,
): Promise<T> {
  return dashboardRequest<T>(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function login(email: string, password: string): Promise<TattooArtistSession> {
  return jsonRequest('auth/login', 'POST', { email, password });
}

export function listArtistAccounts(): Promise<ArtistAccountView[]> {
  return dashboardRequest('admin/accounts');
}

export function createArtistAccount(input: CreateArtistAccountInput): Promise<ArtistAccountView> {
  return jsonRequest('admin/accounts', 'POST', input);
}

export function updateArtistAccount(
  id: string,
  input: UpdateArtistAccountInput,
): Promise<ArtistAccountView> {
  return jsonRequest(`admin/accounts/${encodeURIComponent(id)}`, 'PATCH', input);
}

export function logout(): Promise<{ success: boolean }> {
  return jsonRequest('auth/logout', 'POST');
}

export function getDashboardMetrics(): Promise<DashboardMetrics> {
  return dashboardRequest('dashboard/metrics');
}

export function listLeads(query: LeadListQuery = {}): Promise<LeadListResult> {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '' && value !== false) {
      params.set(key, String(value));
    }
  }

  const search = params.toString();
  return dashboardRequest(`dashboard/leads${search ? `?${search}` : ''}`);
}

export function getLead(leadId: string): Promise<LeadDetail> {
  return dashboardRequest(`dashboard/leads/${encodeURIComponent(leadId)}`);
}

export function getLeadReference(leadId: string): Promise<LeadReferenceAccess> {
  return dashboardRequest(`dashboard/leads/${encodeURIComponent(leadId)}/reference`);
}

export function completeLead(leadId: string): Promise<LeadDetail> {
  return jsonRequest(`dashboard/leads/${encodeURIComponent(leadId)}/complete`, 'PATCH');
}

export function saveManualFinalPrice(leadId: string, price: number): Promise<LeadDetail> {
  return jsonRequest(`dashboard/leads/${encodeURIComponent(leadId)}/final-price`, 'PATCH', {
    price,
  });
}

export function archiveLead(leadId: string): Promise<LeadDetail> {
  return jsonRequest(`dashboard/leads/${encodeURIComponent(leadId)}/archive`, 'PATCH');
}

export function restoreLead(leadId: string): Promise<LeadDetail> {
  return jsonRequest(`dashboard/leads/${encodeURIComponent(leadId)}/restore`, 'PATCH');
}

export function deleteLead(leadId: string): Promise<{ deleted: true; leadId: string }> {
  return jsonRequest(`dashboard/leads/${encodeURIComponent(leadId)}`, 'DELETE');
}

export function getPricingRules(): Promise<{ rules: PricingRuleView[] }> {
  return dashboardRequest('dashboard/pricing');
}

export function updatePricingRules(
  updates: PricingRuleUpdate[],
): Promise<UpdatePricingRulesResult> {
  return jsonRequest('dashboard/pricing', 'PATCH', { updates });
}

export function getCalibrationStyles(): Promise<CalibrationStyleView[]> {
  return dashboardRequest('dashboard/calibration/styles');
}

export function setCalibrationStyle(styleId: string, enabled: boolean): Promise<void> {
  return jsonRequest(`dashboard/calibration/styles/${encodeURIComponent(styleId)}`, 'PATCH', {
    enabled,
  });
}

export function getCalibrationDraft(styleId: string): Promise<CalibrationDraftView | null> {
  return dashboardRequest(`dashboard/calibration/styles/${encodeURIComponent(styleId)}/draft`);
}

export function startCalibrationDraft(styleId: string): Promise<CalibrationDraftView> {
  return jsonRequest(`dashboard/calibration/styles/${encodeURIComponent(styleId)}/draft`, 'POST');
}

export function saveCalibrationAnswer(
  styleId: string,
  caseId: string,
  price: number,
): Promise<CalibrationDraftView> {
  return jsonRequest(
    `dashboard/calibration/styles/${encodeURIComponent(styleId)}/draft/answers/${encodeURIComponent(caseId)}`,
    'PUT',
    { price },
  );
}

export function activateCalibration(styleId: string): Promise<PricingModelView> {
  return jsonRequest(
    `dashboard/calibration/styles/${encodeURIComponent(styleId)}/draft/activate`,
    'POST',
  );
}

export function getPricingModels(): Promise<PricingModelView[]> {
  return dashboardRequest('dashboard/calibration/models');
}

export function getGeneralAdjustment(): Promise<{ percent: string }> {
  return dashboardRequest('dashboard/calibration/adjustment');
}

export function setGeneralAdjustment(
  percent: number,
): Promise<{ percent: string; newVersions: number }> {
  return jsonRequest('dashboard/calibration/adjustment', 'PATCH', { percent });
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof DashboardApiError && error.status === 401;
}

export function dashboardErrorMessage(error: unknown): string {
  return error instanceof DashboardApiError
    ? error.message
    : 'Ocurrió un problema inesperado. Inténtalo nuevamente.';
}
