export const IMAGE_ANALYSIS_PROMPT_VERSION = 2;

export const IMAGE_ANALYSIS_PROMPT = `
Analiza exclusivamente la imagen de referencia de tatuaje y responde usando el schema JSON indicado.

Clasificación de tamaño visual para Tatto Flow:
- SMALL: referencia visualmente compatible con la categoría pequeña.
- MEDIUM: referencia visualmente compatible con la categoría mediana.
- LARGE: referencia visualmente compatible con la categoría grande.

No inventes centímetros ni una medida física exacta. Si la imagen no ofrece suficiente información
para estimar el tamaño físico, selecciona la categoría visual más probable y reduce sizeConfidence.

Clasificación del nivel de detalle según el trabajo visual requerido:
- LIGHT: contornos simples o line art, pocos trazos internos, sin sombreado o con sombreado mínimo,
  sin texturas complejas, sin realismo y con pocos elementos pequeños. Ejemplos conceptuales:
  símbolos, palabras, siluetas y dibujos lineales simples.
- MEDIUM: cantidad moderada de líneas internas, varios elementos visuales, sombreado parcial o
  rellenos, algunas texturas y una complejidad interna claramente superior a un simple contorno.
- DETAILED: alta densidad de líneas, sombreado complejo, degradados, texturas finas, realismo,
  muchos elementos pequeños, ornamentación o microdetalle.

Reglas obligatorias para detectedDetail:
1. El tamaño físico del tatuaje NO determina el nivel de detalle.
2. No clasifiques MEDIUM solo porque el sujeto representado tenga varias partes.
3. Un line art sin sombreado, texturas o microdetalle normalmente debe clasificarse como LIGHT.
4. Si existe duda real entre LIGHT y MEDIUM, prefiere LIGHT y refleja la incertidumbre reduciendo
   detailConfidence.
5. Evalúa el trabajo visual requerido, no la complejidad semántica del objeto representado.

tattooOnSkin debe ser true únicamente cuando la referencia muestre un tatuaje aplicado sobre piel o
el cuerpo humano. referenceAnalyzable debe ser false cuando borrosidad, obstrucción, distancia, baja
calidad u otro problema relevante impida evaluar razonablemente el tatuaje.

ambiguityLevel debe ser NONE, MINOR o MAJOR según la incertidumbre visual. No fuerces confianzas
altas: expresa cualquier incertidumbre reduciendo la confidence correspondiente.

No calcules precios, puntuaciones ni readiness. No decidas LISTO, REVISAR o INCOMPLETO. No describas
ni infieras identidad, edad, género, raza ni otros atributos personales de una persona fotografiada.
`.trim();
