import { Inject, Injectable } from '@nestjs/common';
import { Engine, type Event } from 'json-rules-engine';
import { ConversationStatus, Prisma, ReadinessStatus } from '../../generated/prisma/client.js';
import { SafeStructuredLogger } from '../../infrastructure/observability/safe-structured-logger.js';
import { ImageAmbiguityLevel } from '../image-analysis/domain/image-analysis.types.js';
import type {
  GateRuleId,
  LeadEvaluationResult,
  LeadScoringConfig,
  LeadScoringFacts,
  LeadScoringInput,
  ScoringRuleId,
} from './domain/lead-scoring.types.js';
import { LEAD_SCORING_CONFIG } from './lead-scoring.config.js';
import {
  SCORING_BLOCKER_MESSAGES_ES,
  SCORING_CONTRIBUTION_MESSAGES_ES,
} from './lead-scoring.messages.es.js';

type LeadEvaluationClient = Pick<Prisma.TransactionClient, 'leadEvaluation'>;

const SCORE_EVENT = 'lead-score-contribution';
const GATE_EVENT = 'lead-readiness-gate';
const LOW_CONFIDENCE_READINESS_PENALTY = 10;

@Injectable()
export class LeadScoringService {
  private readonly engine: Engine;
  private readonly logger = new SafeStructuredLogger(LeadScoringService.name);

  constructor(
    @Inject(LEAD_SCORING_CONFIG)
    private readonly config: LeadScoringConfig,
  ) {
    this.engine = this.createEngine();
  }

  async evaluate(input: LeadScoringInput): Promise<LeadEvaluationResult> {
    const facts = this.toFacts(input);
    const { events } = await this.engine.run(facts);
    const matchedScoreRules = this.matchedRuleIds<ScoringRuleId>(events, SCORE_EVENT);
    const matchedGateRules = this.matchedRuleIds<GateRuleId>(events, GATE_EVENT);

    const contributions = this.config.scoringRules
      .filter((rule) => matchedScoreRules.has(rule.id))
      .map((rule) => ({
        ruleId: rule.id,
        points: this.config.weights[rule.id],
        reason: SCORING_CONTRIBUTION_MESSAGES_ES[rule.id],
      }));
    const rawScore = contributions.reduce((total, contribution) => total + contribution.points, 0);
    const blockers = this.config.gateRules
      .filter((rule) => matchedGateRules.has(rule.id))
      .map((rule) => ({
        ruleId: rule.id,
        reason: SCORING_BLOCKER_MESSAGES_ES[rule.id],
      }));
    const normalizedScore = this.normalize(rawScore);
    const finalReadinessScore = this.applyConfidencePenalty(normalizedScore, matchedGateRules);

    return {
      rawScore,
      maxPositiveScore: this.config.maxPositiveScore,
      readinessScore: Math.round(finalReadinessScore),
      status: this.classify(normalizedScore, matchedGateRules),
      rulesVersion: this.config.rulesVersion,
      contributions,
      blockers,
    };
  }

  async evaluateAndPersist(
    leadId: string,
    input: LeadScoringInput,
    client: LeadEvaluationClient,
  ): Promise<LeadEvaluationResult> {
    const result = await this.evaluate(input);
    const evaluatedAt = new Date();
    const matchedGateRules = new Set(result.blockers.map(({ ruleId }) => ruleId));
    const persistedScore = new Prisma.Decimal(
      this.applyConfidencePenalty(this.normalize(result.rawScore), matchedGateRules).toFixed(2),
    );
    const data = {
      rawScore: result.rawScore,
      maxPositiveScore: result.maxPositiveScore,
      readinessScore: persistedScore,
      readinessStatus: result.status,
      rulesVersion: result.rulesVersion,
      contributions: result.contributions as unknown as Prisma.InputJsonValue,
      blockers: result.blockers as unknown as Prisma.InputJsonValue,
      evaluatedAt,
    };

    await client.leadEvaluation.upsert({
      where: { leadId },
      update: data,
      create: { leadId, ...data },
    });

    this.logger.info('scoring.evaluation.completed', {
      leadId,
      readinessStatus: result.status,
      readinessScore: result.readinessScore,
      activatedGates: result.blockers.map((blocker) => blocker.ruleId),
      rulesVersion: result.rulesVersion,
    });

    return result;
  }

  private createEngine(): Engine {
    const engine = new Engine();

    for (const rule of this.config.scoringRules) {
      engine.addRule({
        name: rule.id,
        conditions: rule.conditions,
        event: { type: SCORE_EVENT, params: { ruleId: rule.id } },
      });
    }

    for (const rule of this.config.gateRules) {
      engine.addRule({
        name: `GATE_${rule.id}`,
        conditions: rule.conditions,
        event: { type: GATE_EVENT, params: { ruleId: rule.id } },
      });
    }

    return engine;
  }

  private toFacts(input: LeadScoringInput): LeadScoringFacts {
    const analysis = input.analysis;
    const sizeProvided = Boolean(input.selectedSize);
    const detailProvided = Boolean(input.selectedDetail);
    const bodyPartProvided = Boolean(input.bodyPart?.trim());
    const analysisPresent = analysis !== null;
    const sizeMatch = Boolean(
      input.selectedSize && analysis && input.selectedSize === analysis.detectedSize,
    );
    const detailMatch = Boolean(
      input.selectedDetail && analysis && input.selectedDetail === analysis.detectedDetail,
    );

    return {
      analysisPresent,
      analysisFailed: input.analysisFailed,
      flowComplete: sizeProvided && detailProvided && bodyPartProvided && input.referenceReceived,
      conversationAbandoned: input.conversationStatus === ConversationStatus.ABANDONED,
      sizeProvided,
      detailProvided,
      bodyPartProvided,
      referenceReceived: input.referenceReceived,
      tattooOnSkin: analysis?.tattooOnSkin === true,
      notOnSkin: analysis?.tattooOnSkin === false,
      referenceAnalyzable: analysis?.referenceAnalyzable === true,
      hardToAnalyze: analysisPresent && analysis.referenceAnalyzable === false,
      sizeMatch,
      sizeMismatch: Boolean(input.selectedSize && analysis && !sizeMatch),
      detailMatch,
      detailMismatch: Boolean(input.selectedDetail && analysis && !detailMatch),
      noMajorContradictions:
        analysisPresent && analysis.ambiguityLevel !== ImageAmbiguityLevel.MAJOR,
      minorAmbiguity: analysis?.ambiguityLevel === ImageAmbiguityLevel.MINOR,
      sizeConfidence: analysis?.sizeConfidence ?? 0,
      detailConfidence: analysis?.detailConfidence ?? 0,
    };
  }

  private matchedRuleIds<T extends string>(events: Event[], type: string): Set<T> {
    return new Set(
      events
        .filter((event) => event.type === type && typeof event.params?.ruleId === 'string')
        .map((event) => event.params?.ruleId as T),
    );
  }

  private normalize(rawScore: number): number {
    const percentage = (rawScore / this.config.maxPositiveScore) * 100;

    return Math.min(100, Math.max(0, percentage));
  }

  private applyConfidencePenalty(score: number, matchedGates: Set<GateRuleId>): number {
    const penalty =
      (matchedGates.has('LOW_SIZE_CONFIDENCE') ? LOW_CONFIDENCE_READINESS_PENALTY : 0) +
      (matchedGates.has('LOW_DETAIL_CONFIDENCE') ? LOW_CONFIDENCE_READINESS_PENALTY : 0);

    return Math.min(100, Math.max(0, score - penalty));
  }

  private classify(score: number, matchedGates: Set<GateRuleId>): ReadinessStatus {
    const hasHardGate = this.config.gateRules.some(
      (rule) => rule.status === ReadinessStatus.INCOMPLETO && matchedGates.has(rule.id),
    );

    if (hasHardGate) {
      return ReadinessStatus.INCOMPLETO;
    }

    const hasReviewGate = this.config.gateRules.some(
      (rule) => rule.status === ReadinessStatus.REVISAR && matchedGates.has(rule.id),
    );

    if (hasReviewGate) {
      return ReadinessStatus.REVISAR;
    }

    if (score >= this.config.thresholds.readyMinimum) {
      return ReadinessStatus.LISTO;
    }

    if (score >= this.config.thresholds.reviewMinimum) {
      return ReadinessStatus.REVISAR;
    }

    return ReadinessStatus.INCOMPLETO;
  }
}
