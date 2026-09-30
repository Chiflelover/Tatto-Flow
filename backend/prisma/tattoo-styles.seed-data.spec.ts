import { describe, expect, it } from 'vitest';
import { INITIAL_TATTOO_STYLES } from './tattoo-styles.seed-data.js';

describe('initial tattoo styles', () => {
  it('contains the eight stable MVP codes without a Prisma style enum', () => {
    expect(INITIAL_TATTOO_STYLES.map((style) => style.code)).toEqual([
      'FINE_LINE',
      'BLACKWORK',
      'REALISM',
      'AMERICAN_TRADITIONAL',
      'NEO_TRADITIONAL',
      'JAPANESE',
      'GEOMETRIC',
      'WATERCOLOR',
    ]);
    expect(new Set(INITIAL_TATTOO_STYLES.map((style) => style.code)).size).toBe(8);
  });
});
