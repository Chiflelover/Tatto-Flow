export const IMAGE_ANALYSIS_PROMPT_VERSION = 1;

export const IMAGE_ANALYSIS_PROMPT = `
Analiza exclusivamente la imagen de referencia de tatuaje y responde usando el schema JSON indicado.

Clasificación de tamaño visual para Tatto Flow:
- SMALL: referencia visualmente compatible con la categoría pequeña.
- MEDIUM: referencia visualmente compatible con la categoría mediana.
- LARGE: referencia visualmente compatible con la categoría grande.

No inventes centímetros ni una medida física exacta. Si la imagen no ofrece suficiente información
para estimar el tamaño físico, selecciona la categoría visual más probable y reduce sizeConfidence.

Clasificación del nivel de detalle:
- LIGHT: pocas líneas, sombras o texturas y baja densidad visual.
- MEDIUM: complejidad visual intermedia.
- DETAILED: alta cantidad de líneas, sombras, texturas o cobertura.

tattooOnSkin debe ser true únicamente cuando la referencia muestre un tatuaje aplicado sobre piel o
el cuerpo humano. referenceAnalyzable debe ser false cuando borrosidad, obstrucción, distancia, baja
calidad u otro problema relevante impida evaluar razonablemente el tatuaje.

ambiguityLevel debe ser NONE, MINOR o MAJOR según la incertidumbre visual. No fuerces confianzas
altas: expresa cualquier incertidumbre reduciendo la confidence correspondiente.

No calcules precios, puntuaciones ni readiness. No decidas LISTO, REVISAR o INCOMPLETO. No describas
ni infieras identidad, edad, género, raza ni otros atributos personales de una persona fotografiada.
`.trim();
