export const IMAGE_ANALYSIS_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    detectedSize: {
      type: 'string',
      enum: ['SMALL', 'MEDIUM', 'LARGE'],
    },
    sizeConfidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
    detectedDetail: {
      type: 'string',
      enum: ['LIGHT', 'MEDIUM', 'DETAILED'],
    },
    detailConfidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
    tattooOnSkin: {
      type: 'boolean',
    },
    tattooOnSkinConfidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
    referenceAnalyzable: {
      type: 'boolean',
    },
    analyzabilityConfidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
    ambiguityLevel: {
      type: 'string',
      enum: ['NONE', 'MINOR', 'MAJOR'],
    },
  },
  required: [
    'detectedSize',
    'sizeConfidence',
    'detectedDetail',
    'detailConfidence',
    'tattooOnSkin',
    'tattooOnSkinConfidence',
    'referenceAnalyzable',
    'analyzabilityConfidence',
    'ambiguityLevel',
  ],
} as const;
