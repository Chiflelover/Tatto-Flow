import { ReadinessStatus } from '../../generated/prisma/client.js';
import { MINIMUM_AUTOMATIC_QUOTE_CONFIDENCE } from '../image-analysis/domain/image-analysis.constants.js';
import type { LeadScoringConfig } from './domain/lead-scoring.types.js';

export const LEAD_SCORING_CONFIG = Symbol('LEAD_SCORING_CONFIG');

export const LEAD_SCORING_CONFIG_V1: LeadScoringConfig = {
  rulesVersion: 1,
  maxPositiveScore: 250,
  thresholds: {
    readyMinimum: 90,
    reviewMinimum: 75,
  },
  weights: {
    SIZE_PROVIDED: 25,
    DETAIL_PROVIDED: 20,
    BODY_PART_PROVIDED: 10,
    REFERENCE_RECEIVED: 25,
    TATTOO_ON_SKIN: 100,
    REFERENCE_ANALYZABLE: 20,
    SIZE_MATCH: 15,
    DETAIL_MATCH: 15,
    NO_MAJOR_CONTRADICTIONS: 20,
    MINOR_AMBIGUITY: -10,
    SIZE_MISMATCH: -40,
    DETAIL_MISMATCH: -40,
    HARD_TO_ANALYZE: -50,
    NOT_ON_SKIN: -150,
  },
  scoringRules: [
    {
      id: 'SIZE_PROVIDED',
      conditions: { all: [{ fact: 'sizeProvided', operator: 'equal', value: true }] },
    },
    {
      id: 'DETAIL_PROVIDED',
      conditions: { all: [{ fact: 'detailProvided', operator: 'equal', value: true }] },
    },
    {
      id: 'BODY_PART_PROVIDED',
      conditions: { all: [{ fact: 'bodyPartProvided', operator: 'equal', value: true }] },
    },
    {
      id: 'REFERENCE_RECEIVED',
      conditions: { all: [{ fact: 'referenceReceived', operator: 'equal', value: true }] },
    },
    {
      id: 'TATTOO_ON_SKIN',
      conditions: { all: [{ fact: 'tattooOnSkin', operator: 'equal', value: true }] },
    },
    {
      id: 'REFERENCE_ANALYZABLE',
      conditions: { all: [{ fact: 'referenceAnalyzable', operator: 'equal', value: true }] },
    },
    {
      id: 'SIZE_MATCH',
      conditions: { all: [{ fact: 'sizeMatch', operator: 'equal', value: true }] },
    },
    {
      id: 'DETAIL_MATCH',
      conditions: { all: [{ fact: 'detailMatch', operator: 'equal', value: true }] },
    },
    {
      id: 'NO_MAJOR_CONTRADICTIONS',
      conditions: { all: [{ fact: 'noMajorContradictions', operator: 'equal', value: true }] },
    },
    {
      id: 'MINOR_AMBIGUITY',
      conditions: { all: [{ fact: 'minorAmbiguity', operator: 'equal', value: true }] },
    },
    {
      id: 'SIZE_MISMATCH',
      conditions: { all: [{ fact: 'sizeMismatch', operator: 'equal', value: true }] },
    },
    {
      id: 'DETAIL_MISMATCH',
      conditions: { all: [{ fact: 'detailMismatch', operator: 'equal', value: true }] },
    },
    {
      id: 'HARD_TO_ANALYZE',
      conditions: { all: [{ fact: 'hardToAnalyze', operator: 'equal', value: true }] },
    },
    {
      id: 'NOT_ON_SKIN',
      conditions: { all: [{ fact: 'notOnSkin', operator: 'equal', value: true }] },
    },
  ],
  gateRules: [
    {
      id: 'FLOW_INCOMPLETE',
      status: ReadinessStatus.INCOMPLETO,
      conditions: {
        any: [
          { fact: 'flowComplete', operator: 'equal', value: false },
          { fact: 'conversationAbandoned', operator: 'equal', value: true },
        ],
      },
    },
    {
      id: 'NOT_ON_SKIN',
      status: ReadinessStatus.INCOMPLETO,
      conditions: { all: [{ fact: 'notOnSkin', operator: 'equal', value: true }] },
    },
    {
      id: 'AI_ERROR',
      status: ReadinessStatus.REVISAR,
      conditions: { all: [{ fact: 'analysisFailed', operator: 'equal', value: true }] },
    },
    {
      id: 'SIZE_MISMATCH',
      status: ReadinessStatus.REVISAR,
      conditions: { all: [{ fact: 'sizeMismatch', operator: 'equal', value: true }] },
    },
    {
      id: 'DETAIL_MISMATCH',
      status: ReadinessStatus.REVISAR,
      conditions: { all: [{ fact: 'detailMismatch', operator: 'equal', value: true }] },
    },
    {
      id: 'LOW_SIZE_CONFIDENCE',
      status: ReadinessStatus.REVISAR,
      conditions: {
        all: [
          { fact: 'analysisPresent', operator: 'equal', value: true },
          {
            fact: 'sizeConfidence',
            operator: 'lessThan',
            value: MINIMUM_AUTOMATIC_QUOTE_CONFIDENCE,
          },
        ],
      },
    },
    {
      id: 'LOW_DETAIL_CONFIDENCE',
      status: ReadinessStatus.REVISAR,
      conditions: {
        all: [
          { fact: 'analysisPresent', operator: 'equal', value: true },
          {
            fact: 'detailConfidence',
            operator: 'lessThan',
            value: MINIMUM_AUTOMATIC_QUOTE_CONFIDENCE,
          },
        ],
      },
    },
  ],
};
