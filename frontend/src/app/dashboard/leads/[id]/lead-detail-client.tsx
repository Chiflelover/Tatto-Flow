'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ActionLabel } from '@/components/dashboard/action-label';
import { DashboardError, DashboardLoading } from '@/components/dashboard/feedback-state';
import { StatusBadge } from '@/components/dashboard/lead-card';
import { bookingIntentLabel, v2ReviewLabel } from '@/lib/v2-lead';
import {
  completeLead,
  dashboardErrorMessage,
  getLead,
  getImageDownload,
  getLeadReference,
  isUnauthorized,
  saveManualFinalPrice,
  type LeadDetail,
  type LeadReferenceAccess,
} from '@/lib/dashboard-api';
import styles from '@/styles/dashboard.module.css';

export function LeadDetailClient({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [reference, setReference] = useState<LeadReferenceAccess | null>(null);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [manualPriceInput, setManualPriceInput] = useState('');
  const [pendingAction, setPendingAction] = useState<'complete' | 'save-price' | null>(null);
  const actionPending = useRef(false);
  const downloadPending = useRef(false);

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
    if (actionPending.current) {
      return;
    }

    actionPending.current = true;
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
      actionPending.current = false;
      setPendingAction(null);
    }
  }

  async function handleSaveManualPrice(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (actionPending.current) {
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

    actionPending.current = true;
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
      actionPending.current = false;
      setPendingAction(null);
    }
  }

  async function downloadImage(): Promise<void> {
    if (!reference?.imageId || downloadPending.current) return;
    downloadPending.current = true;
    setDownloading(true);
    setReferenceError(null);
    try {
      const { url, fileName } = await getImageDownload(reference.imageId);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (requestError) {
      if (isUnauthorized(requestError)) router.replace('/login');
      else setReferenceError(dashboardErrorMessage(requestError));
    } finally {
      downloadPending.current = false;
      setDownloading(false);
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
        <div className={styles.detailStatus}>
          <div>
            <span>Estado</span>
            <StatusBadge status={lead.status} label={lead.statusLabel} />
          </div>
          <div>
            <span>Confianza</span>
            <strong>
              {lead.visionV2?.overallConfidence != null
                ? `${Math.round(lead.visionV2.overallConfidence * 100)}%`
                : 'Pendiente'}
            </strong>
          </div>
        </div>

        {lead.v2 && (lead.v2.reviewReasons.length > 0 || lead.v2.specialReviewTypes.length > 0) && (
          <div className={styles.detailBlockers}>
            <strong>
              {lead.v2.decision === 'SPECIAL_REVIEW' ? 'Revisión especial' : 'Revisión ordinaria'}
            </strong>
            <ul>
              {[...lead.v2.specialReviewTypes, ...lead.v2.reviewReasons].map((code) => (
                <li key={code}>{v2ReviewLabel(code)}</li>
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
              <>
                <div>
                  <dt>Estilo</dt>
                  <dd>{lead.v2.style ?? 'Pendiente'}</dd>
                </div>
                <div>
                  <dt>Área objetivo</dt>
                  <dd>{lead.v2.targetAreaCm2 ? `${lead.v2.targetAreaCm2} cm²` : 'Pendiente'}</dd>
                </div>
                <div>
                  <dt>Color objetivo</dt>
                  <dd>
                    {lead.v2.targetColorCoverage !== null
                      ? `${Math.round(lead.v2.targetColorCoverage * 100)}%`
                      : 'Pendiente'}
                  </dd>
                </div>
                <div>
                  <dt>Intención del cliente</dt>
                  <dd>{bookingIntentLabel(lead.v2.bookingIntent)}</dd>
                </div>
                {lead.v2.bookingIntent === 'DIRECT_BOOKING' && (
                  <div>
                    <dt>Coordinación</dt>
                    <dd>Listo para coordinar. Aún no hay una cita reservada.</dd>
                  </div>
                )}
              </>
              <div>
                <dt>Tamaño objetivo declarado</dt>
                <dd>{lead.targetSizeCm !== null ? `${lead.targetSizeCm} cm` : 'Pendiente'}</dd>
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
            {lead.visionV2 ? (
              <dl className={styles.analysisFacts}>
                <div>
                  <dt>Estilo observado</dt>
                  <dd>{lead.visionV2.style ?? 'Sin identificar'}</dd>
                </div>
                <div>
                  <dt>Dimensión de referencia</dt>
                  <dd>
                    {lead.visionV2.referenceMainDimensionCm !== null
                      ? `${lead.visionV2.referenceMainDimensionCm} cm`
                      : 'Sin estimación'}
                  </dd>
                </div>
                <div>
                  <dt>Área de referencia</dt>
                  <dd>
                    {lead.visionV2.referenceAreaCm2 !== null
                      ? `${lead.visionV2.referenceAreaCm2} cm²`
                      : 'Sin estimación'}
                  </dd>
                </div>
                <div>
                  <dt>Escala</dt>
                  <dd>
                    {lead.visionV2.scaleReferenceType === 'EXPLICIT_REFERENCE'
                      ? 'Referencia física'
                      : lead.visionV2.scaleReferenceType === 'BODY_CONTEXT'
                        ? 'Estimación anatómica'
                        : 'Sin escala'}
                  </dd>
                </div>
              </dl>
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
            {reference?.available && reference.imageId && (
              <button
                className={styles.secondaryButton}
                type="button"
                disabled={downloading}
                aria-busy={downloading}
                onClick={() => void downloadImage()}
              >
                <ActionLabel
                  label="Descargar imagen"
                  pendingLabel="Preparando descarga..."
                  pending={downloading}
                />
              </button>
            )}
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
            ) : lead.quote ? (
              <div className={styles.finalPriceDisplay}>
                <span>Precio aproximado</span>
                <p className={styles.priceDisplay}>S/{lead.quote.amount}</p>
              </div>
            ) : (
              <p className={styles.priceDisplay}>Pendiente</p>
            )}

            {!lead.quote && ['REQUIRES_REVIEW', 'SPECIAL_REVIEW'].includes(lead.status) && (
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
                  aria-busy={pendingAction === 'save-price'}
                >
                  <ActionLabel
                    label="Guardar precio"
                    pendingLabel="Guardando..."
                    pending={pendingAction === 'save-price'}
                  />
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
                  aria-busy={pendingAction === 'complete'}
                >
                  <ActionLabel
                    label="Marcar como finalizado"
                    pendingLabel="Finalizando..."
                    pending={pendingAction === 'complete'}
                  />
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
