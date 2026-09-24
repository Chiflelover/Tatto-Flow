'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { DashboardError, DashboardLoading } from '@/components/dashboard/feedback-state';
import { StatusBadge } from '@/components/dashboard/lead-card';
import { ReadinessBadge, ReadinessScore } from '@/components/dashboard/lead-readiness';
import {
  completeLead,
  dashboardErrorMessage,
  getLead,
  getLeadReference,
  isUnauthorized,
  saveManualPrice,
  sendPrice,
  type LeadDetail,
  type LeadReferenceAccess,
} from '@/lib/dashboard-api';
import styles from '@/styles/dashboard.module.css';

const AI_ERROR_MESSAGE =
  'No se pudo analizar automáticamente la referencia. El tatuador debe revisarla manualmente.';

export function LeadDetailClient({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [reference, setReference] = useState<LeadReferenceAccess | null>(null);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'save' | 'send' | 'complete' | null>(null);

  const loadLead = useCallback(async () => {
    try {
      const result = await getLead(leadId);
      setError(null);
      setLead(result);
      setMinPrice(result.price?.minimum ?? '');
      setMaxPrice(result.price?.maximum ?? '');
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
          setMinPrice(result.price?.minimum ?? '');
          setMaxPrice(result.price?.maximum ?? '');
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

  async function handleSavePrice(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const minimum = Number(minPrice);
    const maximum = Number(maxPrice);

    setActionError(null);
    setConfirmation(null);

    if (
      !minPrice ||
      !maxPrice ||
      !Number.isFinite(minimum) ||
      !Number.isFinite(maximum) ||
      minimum < 0 ||
      maximum < minimum
    ) {
      setActionError('Ingresa un rango válido. El precio máximo no puede ser menor al mínimo.');
      return;
    }

    setPendingAction('save');

    try {
      const updated = await saveManualPrice(leadId, minimum, maximum);
      setLead(updated);
      setConfirmation('Precio guardado correctamente.');
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

  async function handleSendPrice(): Promise<void> {
    if (pendingAction) {
      return;
    }

    setPendingAction('send');
    setActionError(null);
    setConfirmation(null);

    try {
      const result = await sendPrice(leadId);
      setConfirmation(result.confirmation);
      await loadLead();
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

  const requiresReview = lead.status === 'REQUIRES_REVIEW';
  const verified = lead.status === 'VERIFIED';
  const hasAiError =
    lead.evaluation?.blockers.some((blocker) => blocker.ruleId === 'AI_ERROR') ?? false;

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
        <StatusBadge status={lead.status} label={lead.statusLabel} />
      </header>

      <section className={styles.leadDetailSummary} aria-label="Resumen del lead">
        <div className={styles.detailReadiness}>
          <div>
            <span>Preparación</span>
            <ReadinessBadge status={lead.evaluation?.status ?? null} />
          </div>
          <div>
            <span>Confianza</span>
            <ReadinessScore readiness={lead.readiness} confidence={lead.confidence} />
          </div>
        </div>

        <dl className={styles.detailSummaryFacts}>
          <div>
            <dt>Cliente</dt>
            <dd>
              {lead.selectedSizeLabel ?? 'Tamaño pendiente'} ·{' '}
              {lead.selectedDetailLabel ?? 'Detalle pendiente'}
            </dd>
          </div>
          <div>
            <dt>Análisis IA</dt>
            <dd>
              {lead.analysis
                ? `${lead.analysis.detectedSizeLabel} (${Math.round(
                    lead.analysis.sizeConfidence * 100,
                  )}%) · ${lead.analysis.detectedDetailLabel} (${Math.round(
                    lead.analysis.detailConfidence * 100,
                  )}%)`
                : 'No disponible'}
            </dd>
          </div>
        </dl>

        {lead.evaluation && lead.evaluation.blockers.length > 0 && (
          <div className={styles.detailBlockers}>
            <strong>Requiere atención</strong>
            <ul>
              {lead.evaluation.blockers.map((blocker) => (
                <li key={blocker.ruleId}>
                  {blocker.ruleId === 'AI_ERROR' ? AI_ERROR_MESSAGE : blocker.reason}
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
              <div>
                <dt>Precio aproximado</dt>
                <dd>
                  {lead.price ? `S/${lead.price.minimum} – S/${lead.price.maximum}` : 'Pendiente'}
                </dd>
              </div>
            </dl>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Evaluación del lead</h2>
            </div>
            {lead.evaluation ? (
              <div className={styles.evaluationContent}>
                <div className={styles.evaluationSummary}>
                  <div>
                    <span>Confianza</span>
                    <ReadinessScore readiness={lead.readiness} confidence={lead.confidence} />
                  </div>
                  <div>
                    <span>Estado</span>
                    <ReadinessBadge status={lead.evaluation.status} />
                  </div>
                </div>

                {lead.evaluation.contributions.length > 0 && (
                  <div className={styles.evaluationGroup}>
                    <h3>Contribuciones</h3>
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
              </div>
            ) : (
              <div className={styles.unevaluatedDetail}>
                <ReadinessBadge status={null} />
                <p>Este lead histórico todavía no tiene una evaluación de preparación.</p>
              </div>
            )}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Análisis de la referencia</h2>
            </div>
            {lead.analysis ? (
              <div className={styles.comparisonList}>
                <div className={styles.comparison}>
                  <span className={styles.comparisonLabel}>Tamaño</span>
                  <div className={styles.comparisonValues}>
                    <div>
                      <small>Cliente</small>
                      <strong>{lead.selectedSizeLabel ?? 'Pendiente'}</strong>
                    </div>
                    <div>
                      <small>IA</small>
                      <strong>
                        {lead.analysis.detectedSizeLabel} —{' '}
                        {Math.round(lead.analysis.sizeConfidence * 100)}%
                      </strong>
                    </div>
                  </div>
                </div>
                <div className={styles.comparison}>
                  <span className={styles.comparisonLabel}>Detalle</span>
                  <div className={styles.comparisonValues}>
                    <div>
                      <small>Cliente</small>
                      <strong>{lead.selectedDetailLabel ?? 'Pendiente'}</strong>
                    </div>
                    <div>
                      <small>IA</small>
                      <strong>
                        {lead.analysis.detectedDetailLabel} —{' '}
                        {Math.round(lead.analysis.detailConfidence * 100)}%
                      </strong>
                    </div>
                  </div>
                </div>
              </div>
            ) : hasAiError ? (
              <div className={styles.reviewBox}>
                <strong>Revisión manual necesaria</strong>
                <p>{AI_ERROR_MESSAGE}</p>
              </div>
            ) : (
              <p className={styles.sentNote}>La referencia todavía no tiene análisis disponible.</p>
            )}

            {verified && <div className={styles.verifiedBox}>Verificado automáticamente</div>}
            {requiresReview && !hasAiError && (
              <div className={styles.reviewBox}>
                <strong>Requiere revisión del tatuador</strong>
                {lead.reviewMessages.length > 0 && (
                  <ul>
                    {lead.reviewMessages.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                )}
              </div>
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
        </div>

        <aside className={styles.detailSide}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Precio</h2>
            </div>
            <p className={styles.priceDisplay}>
              {lead.price ? `S/${lead.price.minimum} – S/${lead.price.maximum}` : 'Pendiente'}
            </p>

            {requiresReview && (
              <form className={styles.priceForm} onSubmit={(event) => void handleSavePrice(event)}>
                <div className={styles.priceFields}>
                  <label>
                    <span>Precio mínimo</span>
                    <input
                      type="number"
                      min="0"
                      max="99999999.99"
                      step="0.01"
                      value={minPrice}
                      onChange={(event) => setMinPrice(event.target.value)}
                      required
                      disabled={pendingAction !== null}
                    />
                  </label>
                  <label>
                    <span>Precio máximo</span>
                    <input
                      type="number"
                      min="0"
                      max="99999999.99"
                      step="0.01"
                      value={maxPrice}
                      onChange={(event) => setMaxPrice(event.target.value)}
                      required
                      disabled={pendingAction !== null}
                    />
                  </label>
                </div>
                <button
                  className={styles.secondaryButton}
                  type="submit"
                  disabled={pendingAction !== null}
                >
                  {pendingAction === 'save' ? 'Guardando…' : 'Guardar precio'}
                </button>
              </form>
            )}

            <div className={styles.actionStack}>
              {requiresReview && lead.price && !lead.priceSentAt && (
                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={() => void handleSendPrice()}
                  disabled={pendingAction !== null}
                >
                  {pendingAction === 'send' ? 'Enviando…' : 'Enviar precio'}
                </button>
              )}
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

            {lead.priceSentAt && (
              <p className={styles.sentNote}>El precio ya fue enviado en modo de prueba.</p>
            )}
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
