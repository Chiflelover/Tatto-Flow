import type { TopLevelCondition } from 'json-rules-engine';
import type {
  ConversationStatus,
  DetailLevel,
  ReadinessStatus,
  TattooSize,
} from '../../../generated/prisma/client.js';
import type { ImageAnalysisResult } from '../../image-analysis/domain/image-analysis.types.js';

export type ScoringRuleId =
  | 'SIZE_PROVIDED'
  | 'DETAIL_PROVIDED'
  | 'BODY_PART_PROVIDED'
  | 'REFERENCE_RECEIVED'
  | 'TATTOO_ON_SKIN'
  | 'REFERENCE_ANALYZABLE'
  | 'SIZE_MATCH'
  | 'DETAIL_MATCH'
  | 'NO_MAJOR_CONTRADICTIONS'
  | 'MINOR_AMBIGUITY'
  | 'SIZE_MISMATCH'
  | 'DETAIL_MISMATCH'
  | 'HARD_TO_ANALYZE'
  | 'NOT_ON_SKIN';

export type GateRuleId =
  | 'FLOW_INCOMPLETE'
  | 'NOT_ON_SKIN'
  | 'SIZE_MISMATCH'
  | 'DETAIL_MISMATCH'
  | 'LOW_SIZE_CONFIDENCE'
  | 'LOW_DETAIL_CONFIDENCE';

export interface LeadScoringContribution {
  ruleId: ScoringRuleId;
  points: number;
  reason: string;
}

export interface LeadScoringBlocker {
  ruleId: GateRuleId;
  reason: string;
}

export interface LeadEvaluationResult {
  rawScore: number;
  maxPositiveScore: number;
  readinessScore: number;
  status: ReadinessStatus;
  rulesVersion: number;
  contributions: LeadScoringContribution[];
  blockers: LeadScoringBlocker[];
}

export interface LeadScoringInput {
  selectedSize: TattooSize | null | undefined;
  selectedDetail: DetailLevel | null | undefined;
  bodyPart: string | null | undefined;
  referenceReceived: boolean;
  conversationStatus: ConversationStatus;
  analysis: ImageAnalysisResult | null;
}

export interface LeadScoringFacts {
  analysisPresent: boolean;
  flowComplete: boolean;
  conversationAbandoned: boolean;
  sizeProvided: boolean;
  detailProvided: boolean;
  bodyPartProvided: boolean;
  referenceReceived: boolean;
  tattooOnSkin: boolean;
  notOnSkin: boolean;
  referenceAnalyzable: boolean;
  hardToAnalyze: boolean;
  sizeMatch: boolean;
  sizeMismatch: boolean;
  detailMatch: boolean;
  detailMismatch: boolean;
  noMajorContradictions: boolean;
  minorAmbiguity: boolean;
  sizeConfidence: number;
  detailConfidence: number;
}

export interface ScoringRuleDefinition {
  id: ScoringRuleId;
  conditions: TopLevelCondition;
}

export interface GateRuleDefinition {
  id: GateRuleId;
  status: ReadinessStatus;
  conditions: TopLevelCondition;
}

export interface LeadScoringConfig {
  rulesVersion: number;
  maxPositiveScore: number;
  thresholds: {
    readyMinimum: number;
    reviewMinimum: number;
  };
  weights: Record<ScoringRuleId, number>;
  scoringRules: readonly ScoringRuleDefinition[];
  gateRules: readonly GateRuleDefinition[];
}
