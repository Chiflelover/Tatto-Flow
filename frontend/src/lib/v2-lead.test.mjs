import assert from 'node:assert/strict';
import test from 'node:test';
import { bookingIntentLabel, v2ReviewLabel } from './v2-lead.ts';

test('booking labels describe intent without claiming a reserved appointment', () => {
  assert.equal(bookingIntentLabel('DIRECT_BOOKING'), 'Quiere coordinar una cita');
  assert.equal(bookingIntentLabel('ARTIST_CONTACT'), 'Prefiere contacto del tatuador');
  assert.equal(bookingIntentLabel(null), 'Sin elección de cita');
});
test('ordinary pricing review and both special cases have readable descriptions', () => {
  assert.match(v2ReviewLabel('PRICING_MODEL_NOT_AVAILABLE'), /modelo de precios activo/);
  assert.match(v2ReviewLabel('MODEL_NOT_APPLICABLE'), /sin extrapolar/);
  assert.match(v2ReviewLabel('SPECIAL_REVIEW_COLOR_MODIFICATION'), /añadir color/);
  assert.match(v2ReviewLabel('EXTENSIVE_BODY_COVERAGE'), /extensa/);
});
