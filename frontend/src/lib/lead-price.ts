import type { LeadSummary } from './dashboard-api';

export function leadPriceLabel(lead: Pick<LeadSummary, 'manualFinalPrice' | 'price'>): string {
  if (lead.manualFinalPrice !== null) {
    return `S/${lead.manualFinalPrice}`;
  }

  return lead.price ? `S/${lead.price.minimum}–${lead.price.maximum}` : '—';
}
