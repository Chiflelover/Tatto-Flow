import type { LeadSummary } from './dashboard-api';

export function leadPriceLabel(
  lead: Pick<LeadSummary, 'manualFinalPrice' | 'price'> & Partial<Pick<LeadSummary, 'quote'>>,
): string {
  if (lead.manualFinalPrice !== null) {
    return `S/${lead.manualFinalPrice}`;
  }

  if (lead.quote) return `S/${lead.quote.amount} aprox.`;

  return lead.price ? `S/${lead.price.minimum}–${lead.price.maximum}` : '—';
}
