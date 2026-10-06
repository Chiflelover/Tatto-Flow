import assert from 'node:assert/strict';
import test from 'node:test';
import { leadPriceLabel } from './lead-price.ts';

test('prioritizes a manual final price over an automatic quote', () => {
  assert.equal(
    leadPriceLabel({
      manualFinalPrice: '650.00',
      quote: { amount: '500.00' },
    }),
    'S/650.00',
  );
});

test('shows one approximate automatic price when no manual price exists', () => {
  assert.equal(
    leadPriceLabel({
      manualFinalPrice: null,
      quote: { amount: '500.00' },
    }),
    'S/500.00 aprox.',
  );
});

test('shows a dash when the lead has no price', () => {
  assert.equal(leadPriceLabel({ manualFinalPrice: null, quote: null }), '—');
});
