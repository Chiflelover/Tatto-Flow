import assert from 'node:assert/strict';
import test from 'node:test';
import { leadPriceLabel } from './lead-price.ts';

test('prioritizes a manual final price over an automatic range', () => {
  assert.equal(
    leadPriceLabel({
      manualFinalPrice: '650.00',
      price: { minimum: '500', maximum: '700' },
    }),
    'S/650.00',
  );
});

test('keeps showing an automatic range when no manual price exists', () => {
  assert.equal(
    leadPriceLabel({
      manualFinalPrice: null,
      price: { minimum: '500', maximum: '700' },
    }),
    'S/500–700',
  );
});

test('shows a dash when the lead has no price', () => {
  assert.equal(leadPriceLabel({ manualFinalPrice: null, price: null }), '—');
});
