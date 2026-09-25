import { IMAGE_ANALYSIS_PROMPT, IMAGE_ANALYSIS_PROMPT_VERSION } from './image-analysis.prompt.js';

describe('shared image-analysis prompt', () => {
  it('defines LIGHT using observable simple line-art characteristics', () => {
    expect(IMAGE_ANALYSIS_PROMPT).toContain('contornos simples o line art');
    expect(IMAGE_ANALYSIS_PROMPT).toContain('pocos trazos internos');
    expect(IMAGE_ANALYSIS_PROMPT).toContain('sin sombreado o con sombreado mínimo');
    expect(IMAGE_ANALYSIS_PROMPT).toContain('sin texturas complejas');
    expect(IMAGE_ANALYSIS_PROMPT).toContain('sin realismo');
    expect(IMAGE_ANALYSIS_PROMPT).toContain('símbolos, palabras, siluetas');
  });

  it('distinguishes MEDIUM and DETAILED by visual work instead of subject semantics', () => {
    expect(IMAGE_ANALYSIS_PROMPT).toContain('complejidad interna claramente superior');
    expect(IMAGE_ANALYSIS_PROMPT).toContain('alta densidad de líneas');
    expect(IMAGE_ANALYSIS_PROMPT).toContain('sombreado complejo');
    expect(IMAGE_ANALYSIS_PROMPT).toContain('degradados');
    expect(IMAGE_ANALYSIS_PROMPT).toContain('texturas finas');
    expect(IMAGE_ANALYSIS_PROMPT).toContain('ornamentación o microdetalle');
    expect(IMAGE_ANALYSIS_PROMPT).toContain(
      'Evalúa el trabajo visual requerido, no la complejidad semántica',
    );
  });

  it('contains every anti-overclassification rule for detectedDetail', () => {
    expect(IMAGE_ANALYSIS_PROMPT).toContain(
      'El tamaño físico del tatuaje NO determina el nivel de detalle',
    );
    expect(IMAGE_ANALYSIS_PROMPT).toContain(
      'No clasifiques MEDIUM solo porque el sujeto representado tenga varias partes',
    );
    expect(IMAGE_ANALYSIS_PROMPT).toContain(
      'Un line art sin sombreado, texturas o microdetalle normalmente debe clasificarse como LIGHT',
    );
    expect(IMAGE_ANALYSIS_PROMPT).toContain(
      'Si existe duda real entre LIGHT y MEDIUM, prefiere LIGHT',
    );
    expect(IMAGE_ANALYSIS_PROMPT).toMatch(/reduciendo\s+detailConfidence/);
  });

  it('keeps the exact supported detail labels in the versioned prompt', () => {
    expect(IMAGE_ANALYSIS_PROMPT_VERSION).toBe(2);
    expect(IMAGE_ANALYSIS_PROMPT).toContain('- LIGHT:');
    expect(IMAGE_ANALYSIS_PROMPT).toContain('- MEDIUM:');
    expect(IMAGE_ANALYSIS_PROMPT).toContain('- DETAILED:');
  });
});
