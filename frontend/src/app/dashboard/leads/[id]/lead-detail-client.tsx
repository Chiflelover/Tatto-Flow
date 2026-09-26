'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { DashboardError, DashboardLoading } from '@/components/dashboard/feedback-state';
import { ReadinessBadge, ReadinessScore } from '@/components/dashboard/lead-readiness';
import {
  completeLead,
  dashboardErrorMessage,
  getLead,
  getLeadReference,
  isUnauthorized,
  saveManualFinalPrice,
  type LeadDetail,
  type LeadReferenceAccess,
} from '@/lib/dashboard-api';
import styles from '@/styles/dashboard.module.css';

const AI_ERROR_MESSAGE =
  'No se pudo analizar automáticamente la referencia. El tatuador debe revisarla manualmente.';

const GATE_EXPLANATIONS: Record<string, string> = {
  FLOW_INCOMPLETE: 'La cotización está incompleta o la conversación fue abandonada',
  AI_ERROR: 'No se pudo completar el análisis automático',
  NOT_ON_SKIN: 'La referencia no corresponde a un tatuaje aplicado sobre piel',
  SIZE_MISMATCH: 'El tamaño indicado no coincide con el análisis',
  DETAIL_MISMATCH: 'El nivel de detalle no coincide con el análisis',
  LOW_SIZE_CONFIDENCE: 'La confianza del tamaño detectado es menor al 90%',
  SIZE_CONFIDENCE_LOW: 'La confianza del tamaño detectado es menor al 90%',
  LOW_DETAIL_CONFIDENCE: 'La confianza del detalle detectado es menor al 90%',
  DETAIL_CONFIDENCE_LOW: 'La confianza del detalle detectado es menor al 90%',
};

function normalizeExplanation(value: string): string {
  return value
    .trim()
    .replace(/[.!]+$/, '')
    .toLocaleLowerCase('es-PE');
}

function gateExplanation(blocker: { ruleId: string; reason: string }): string {
  const knownExplanation = GATE_EXPLANATIONS[blocker.ruleId];
  if (knownExplanation) {
    return knownExplanation;
  }

  const reason = blocker.reason.trim();
  return reason && !/^[A-Z0-9_]+$/.test(reason) ? reason : 'La evaluación requiere revisión manual';
}

export function LeadDetailClient({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [reference, setReference] = useState<LeadReferenceAccess | null>(null);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [manualPriceInput, setManualPriceInput] = useState('');
  const [pendingAction, setPendingAction] = useState<'complete' | 'save-price' | null>(null);
  const [evaluationExpanded, setEvaluationExpanded] = useState(false);

  const loadLead = useCallback(async () => {
    try {
      const result = await getLead(leadId);
      setError(null);
      setLead(result);
      setManualPriceInput(result.manualFinalPrice ?? '');
    } catch (requestError) {
      if (isUnauthorized(requestError)) {
        router.replace('/login');
        return;
      }

      setError(dashboardErrorMessage(requestError));
    }
  }, [leadId, router]);

  useEffect(() => {
    let active = true;

    void getLead(leadId)
      .then((result) => {
        if (active) {
          setLead(result);
          setManualPriceInput(result.manualFinalPrice ?? '');
        }
      })
      .catch((requestError: unknown) => {
        if (!active) {
          return;
        }

        if (isUnauthorized(requestError)) {
          router.replace('/login');
          return;
        }

        setError(dashboardErrorMessage(requestError));
      });

    return () => {
      active = false;
    };
  }, [leadId, router]);

  useEffect(() => {
    let active = true;

    void getLeadReference(leadId)
      .then((result) => {
        if (active) {
          setReference(result);
          setReferenceError(null);
        }
      })
      .catch((requestError: unknown) => {
        if (!active) {
          return;
        }

        if (isUnauthorized(requestError)) {
          router.replace('/login');
          return;
        }

        setReferenceError(dashboardErrorMessage(requestError));
      });

    return () => {
      active = false;
    };
  }, [leadId, router]);

  async function handleCompleteLead(): Promise<void> {
    if (pendingAction) {
      return;
    }

    setPendingAction('complete');
    setActionError(null);
    setConfirmation(null);

    try {
      const completed = await completeLead(leadId);
      setLead(completed);
      setConfirmation('Pedido finalizado. Nita podrá iniciar una nueva cotización del cliente.');
    } catch (requestError) {
      if (isUnauthorized(requestError)) {
        router.replace('/login');
        return;
      }

      setActionError(dashboardErrorMessage(requestError));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleSaveManualPrice(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (pendingAction) {
      return;
    }

    const normalizedPrice = manualPriceInput.trim().replace(',', '.');
    const price = Number(normalizedPrice);

    if (
      !/^\d+(?:\.\d{1,2})?$/.test(normalizedPrice) ||
      !Number.isFinite(price) ||
      price <= 0 ||
      price > 99_999_999.99
    ) {
      setActionError('Ingresa un precio válido, mayor que cero y con máximo 2 decimales.');
      setConfirmation(null);
      return;
    }

    setPendingAction('save-price');
    setActionError(null);
    setConfirmation(null);

    try {
      const updatedLead = await saveManualFinalPrice(leadId, price);
      setLead(updatedLead);
      setManualPriceInput(updatedLead.manualFinalPrice ?? normalizedPrice);
      setConfirmation('Precio final guardado correctamente.');
    } catch (requestError) {
      if (isUnauthorized(requestError)) {
        router.replace('/login');
        return;
      }

      setActionError(dashboardErrorMessage(requestError));
    } finally {
      setPendingAction(null);
    }
  }

  if (error) {
    return (
      <DashboardError
        message={error}
        retry={() => {
          setError(null);
          void loadLead();
        }}
      />
    );
  }

  if (!lead) {
    return <DashboardLoading label="Cargando pedido…" />;
  }

  const hasAiError =
    lead.evaluation?.blockers.some((blocker) => blocker.ruleId === 'AI_ERROR') ?? false;
  const contributionRuleIds = new Set(
    lead.evaluation?.contributions.map((contribution) => contribution.ruleId) ?? [],
  );
  const contributionExplanations = new Set(
    lead.evaluation?.contributions.map((contribution) =>
      normalizeExplanation(contribution.reason),
    ) ?? [],
  );
  const gateExplanations =
    lead.evaluation?.blockers
      .filter((blocker) => !contributionRuleIds.has(blocker.ruleId))
      .map(gateExplanation)
      .filter(
        (explanation, index, explanations) =>
          !contributionExplanations.has(normalizeExplanation(explanation)) &&
          explanations.indexOf(explanation) === index,
      ) ?? [];

  return (
    <>
      <Link className={styles.backLink} href="/dashboard/leads">
        ← Volver a pedidos
      </Link>

      <header className={styles.pageHeader}>
        <div>
          <span>Detalle del pedido</span>
          <h1>{lead.customerPhoneNumber}</h1>
          <p>Información entregada por el cliente y resultado del análisis.</p>
        </div>
      </header>

      <section className={styles.leadDetailSummary} aria-label="Resumen del lead">
        <div className={styles.detailReadiness}>
          <div>
            <span>Estado</span>
            <ReadinessBadge status={lead.evaluation?.status ?? null} />
          </div>
          <div>
            <span>Confianza</span>
            <ReadinessScore readiness={lead.readiness} confidence={lead.confidence} />
          </div>
        </div>

        {lead.evaluation && lead.evaluation.blockers.length > 0 && (
          <div className={styles.detailBlockers}>
            <strong>Requiere atención</strong>
            <ul>
              {lead.evaluation.blockers.map((blocker) => (
                <li key={blocker.ruleId}>
                  {blocker.ruleId === 'AI_ERROR' ? AI_ERROR_MESSAGE : gateExplanation(blocker)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className={styles.detailGrid}>
        <div className={styles.detailMain}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Datos del cliente</h2>
            </div>
            <dl className={styles.dataList}>
              <div>
                <dt>Tamaño</dt>
                <dd>{lead.selectedSizeLabel ?? 'Pendiente'}</dd>
              </div>
              <div>
                <dt>Nivel de detalle</dt>
                <dd>{lead.selectedDetailLabel ?? 'Pendiente'}</dd>
              </div>
              <div>
                <dt>Zona corporal</dt>
                <dd>{lead.bodyPart ?? 'Pendiente'}</dd>
              </div>
            </dl>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Análisis de la referencia</h2>
            </div>
            {lead.analysis ? (
              <dl className={styles.analysisFacts}>
                <div>
                  <dt>Tamaño detectado</dt>
                  <dd>{lead.analysis.detectedSizeLabel}</dd>
                  <small>Confianza: {Math.round(lead.analysis.sizeConfidence * 100)}%</small>
                </div>
                <div>
                  <dt>Detalle detectado</dt>
                  <dd>{lead.analysis.detectedDetailLabel}</dd>
                  <small>Confianza: {Math.round(lead.analysis.detailConfidence * 100)}%</small>
                </div>
              </dl>
            ) : hasAiError ? (
              <p className={styles.sentNote}>No hay resultados de análisis disponibles.</p>
            ) : (
              <p className={styles.sentNote}>La referencia todavía no tiene análisis disponible.</p>
            )}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Imagen de referencia</h2>
            </div>
            <div className={styles.referenceBox}>
              {reference?.available && reference.signedUrl ? (
                // The source is a short-lived URL issued by the authenticated backend.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className={styles.referenceImage}
                  src={reference.signedUrl}
                  alt="Referencia enviada por el cliente"
                />
              ) : (
                (referenceError ?? reference?.message ?? 'Cargando imagen de referencia…')
              )}
            </div>
          </section>

          <section className={`${styles.panel} ${styles.evaluationPanel}`}>
            <button
              className={styles.evaluationToggle}
              type="button"
              aria-expanded={evaluationExpanded}
              aria-controls="lead-evaluation-details"
              onClick={() => setEvaluationExpanded((current) => !current)}
            >
              <span>Cómo se calculó la evaluación</span>
              <strong>{evaluationExpanded ? 'Ocultar' : 'Mostrar'}</strong>
            </button>

            <div
              id="lead-evaluation-details"
              className={styles.evaluationContent}
              hidden={!evaluationExpanded}
            >
              {lead.evaluation ? (
                <>
                  {lead.evaluation.contributions.length > 0 && (
                    <div className={styles.evaluationGroup}>
                      <h3>Contribuciones y penalizaciones</h3>
                      <ul className={styles.contributionList}>
                        {lead.evaluation.contributions.map((contribution) => (
                          <li key={contribution.ruleId}>
                            <strong
                              className={
                                contribution.points >= 0
                                  ? styles.positivePoints
                                  : styles.negativePoints
                              }
                            >
                              {contribution.points > 0 ? '+' : ''}
                              {contribution.points}
                            </strong>
                            <span>{contribution.reason}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {gateExplanations.length > 0 && (
                    <div className={styles.evaluationGroup}>
                      <h3>Motivos que influyeron en el estado</h3>
                      <ul className={styles.evaluationBlockerList}>
                        {gateExplanations.map((explanation) => (
                          <li key={explanation}>{explanation}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <div className={styles.unevaluatedDetail}>
                  <ReadinessBadge status={null} />
                  <p>Este lead histórico todavía no tiene una evaluación de preparación.</p>
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className={styles.detailSide}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Precio</h2>
            </div>
            {lead.manualFinalPrice ? (
              <div className={styles.finalPriceDisplay}>
                <span>Precio final</span>
                <p className={styles.priceDisplay}>S/{lead.manualFinalPrice}</p>
              </div>
            ) : (
              <p className={styles.priceDisplay}>
                {lead.price ? `S/${lead.price.minimum} – S/${lead.price.maximum}` : 'Pendiente'}
              </p>
            )}

            {!lead.price && lead.readiness?.status === 'REVISAR' && (
              <form className={styles.manualPriceForm} onSubmit={handleSaveManualPrice}>
                <label htmlFor="manual-final-price">Precio final</label>
                <div className={styles.manualPriceInput}>
                  <span aria-hidden="true">S/</span>
                  <input
                    id="manual-final-price"
                    name="manualFinalPrice"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    max="99999999.99"
                    step="0.01"
                    required
                    value={manualPriceInput}
                    onChange={(event) => setManualPriceInput(event.target.value)}
                    disabled={pendingAction !== null}
                  />
                </div>
                <button
                  className={styles.primaryButton}
                  type="submit"
                  disabled={pendingAction !== null}
                >
                  {pendingAction === 'save-price' ? 'Guardando…' : 'Guardar precio'}
                </button>
              </form>
            )}

            <div className={styles.actionStack}>
              {lead.whatsappUrl && (
                <a
                  className={styles.whatsappButton}
                  href={lead.whatsappUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir WhatsApp
                </a>
              )}
              {lead.status !== 'ANALYZING' && lead.status !== 'COMPLETED' && (
                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={() => void handleCompleteLead()}
                  disabled={pendingAction !== null}
                >
                  {pendingAction === 'complete' ? 'Finalizando…' : 'Marcar como finalizado'}
                </button>
              )}
            </div>

            {actionError && (
              <p className={styles.formError} role="alert">
                {actionError}
              </p>
            )}
            {confirmation && (
              <p className={styles.confirmation} role="status">
                {confirmation}
              </p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
