'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ActionLabel } from '@/components/dashboard/action-label';
import {
  activateCalibration,
  dashboardErrorMessage,
  getCalibrationDraft,
  getCalibrationStyles,
  getGeneralAdjustment,
  getPricingModels,
  isUnauthorized,
  saveCalibrationAnswer,
  setCalibrationStyle,
  setGeneralAdjustment,
  startCalibrationDraft,
  type CalibrationDraftView,
  type CalibrationStyleView,
  type PricingModelView,
} from '@/lib/dashboard-api';
import styles from './calibrate.module.css';

type LoadSection = 'styles' | 'models' | 'adjustment' | 'drafts';
const BASE_SECTIONS: LoadSection[] = ['styles', 'models', 'adjustment'];
const ALL_SECTIONS: LoadSection[] = [...BASE_SECTIONS, 'drafts'];
const SECTION_LABELS: Record<LoadSection, string> = {
  styles: 'Estilos',
  models: 'Versiones de modelos',
  adjustment: 'Ajuste general',
  drafts: 'Borradores de calibración',
};

export default function CalibratePage() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<CalibrationStyleView[]>([]);
  const [models, setModels] = useState<PricingModelView[]>([]);
  const [draft, setDraft] = useState<CalibrationDraftView | null>(null);
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [price, setPrice] = useState('');
  const [adjustment, setAdjustment] = useState('0');
  const [savedAdjustment, setSavedAdjustment] = useState('0');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [available, setAvailable] = useState<LoadSection[]>([]);
  const [loadErrors, setLoadErrors] = useState<Partial<Record<LoadSection, string>>>({});
  const actionPending = useRef(false);
  const loadId = useRef(0);
  const catalogCache = useRef<CalibrationStyleView[]>([]);

  const handleError = useCallback(
    (cause: unknown) => {
      if (isUnauthorized(cause)) router.replace('/login');
      else setError(dashboardErrorMessage(cause));
    },
    [router],
  );

  const openDraft = useCallback((next: CalibrationDraftView) => {
    setSelectedStyleId(next.styleId);
    setDraft(next);
    const first = next.cases.findIndex((item) => item.pricePen === null);
    const nextPosition = first < 0 ? 0 : first;
    setPosition(nextPosition);
    setPrice(next.cases[nextPosition]?.pricePen ?? '');
  }, []);

  const refresh = useCallback(
    async (sections: LoadSection[] = BASE_SECTIONS, restoreDraft = false) => {
      const requestId = ++loadId.current;
      setLoading(true);
      const failures: Partial<Record<LoadSection, string>> = {};
      const loaded: LoadSection[] = [];
      const results = await Promise.allSettled([
        sections.includes('styles') ? getCalibrationStyles() : Promise.resolve(null),
        sections.includes('models') ? getPricingModels() : Promise.resolve(null),
        sections.includes('adjustment') ? getGeneralAdjustment() : Promise.resolve(null),
      ]);
      if (requestId !== loadId.current) return;
      for (const [index, result] of results.entries()) {
        if (result.status === 'rejected') {
          if (isUnauthorized(result.reason)) {
            router.replace('/login');
            return;
          }
          failures[BASE_SECTIONS[index]] = dashboardErrorMessage(result.reason);
        } else if (result.value !== null) loaded.push(BASE_SECTIONS[index]);
      }
      const [stylesResult, modelsResult, adjustmentResult] = results;
      if (stylesResult.status === 'fulfilled' && stylesResult.value !== null) {
        catalogCache.current = stylesResult.value;
        setCatalog(stylesResult.value);
      }
      if (modelsResult.status === 'fulfilled' && modelsResult.value !== null) {
        setModels(modelsResult.value);
      }
      if (adjustmentResult.status === 'fulfilled' && adjustmentResult.value !== null) {
        setAdjustment(adjustmentResult.value.percent);
        setSavedAdjustment(adjustmentResult.value.percent);
      }
      setAvailable((current) => [...new Set([...current, ...loaded])]);
      if (sections.includes('drafts') && !failures.styles) {
        const enabled = catalogCache.current.filter((style) => style.enabled);
        const requestedId = new URLSearchParams(window.location.search).get('styleId');
        const requested = enabled.find((style) => style.id === requestedId);
        const candidates = requested ? [requested] : enabled;
        const pending = await Promise.allSettled(
          candidates.map((style) => getCalibrationDraft(style.id)),
        );
        if (requestId !== loadId.current) return;
        const draftErrors: string[] = [];
        for (const [index, result] of pending.entries()) {
          if (result.status === 'rejected') {
            if (isUnauthorized(result.reason)) {
              router.replace('/login');
              return;
            }
            draftErrors.push(`${candidates[index].name}: ${dashboardErrorMessage(result.reason)}`);
          }
        }
        if (draftErrors.length) failures.drafts = draftErrors.join(' ');
        else loaded.push('drafts');
        const existing = pending.find(
          (result) => result.status === 'fulfilled' && result.value !== null,
        );
        if (restoreDraft && existing?.status === 'fulfilled' && existing.value) {
          openDraft(existing.value);
        }
      } else if (sections.includes('drafts')) {
        failures.drafts = 'Carga los estilos para comprobar los borradores pendientes.';
      }
      setAvailable((current) => [...new Set([...current, ...loaded])]);
      setLoadErrors((current) => {
        const next = { ...current };
        sections.forEach((section) => delete next[section]);
        return { ...next, ...failures };
      });
      setLoading(false);
    },
    [openDraft, router],
  );

  useEffect(() => {
    let active = true;
    const requests = loadId;
    void Promise.resolve().then(() => {
      if (active) return refresh(ALL_SECTIONS, true);
    });
    return () => {
      active = false;
      requests.current++;
    };
  }, [refresh]);

  async function runAction(key: string, action: () => Promise<void>) {
    if (actionPending.current || loading) return;
    actionPending.current = true;
    setBusy(true);
    setPendingAction(key);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      handleError(cause);
    } finally {
      actionPending.current = false;
      setBusy(false);
      setPendingAction(null);
    }
  }

  async function toggleStyle(style: CalibrationStyleView) {
    await runAction(`style:${style.id}`, async () => {
      await setCalibrationStyle(style.id, !style.enabled);
      const next = catalogCache.current.map((item) =>
        item.id === style.id ? { ...item, enabled: !item.enabled } : item,
      );
      catalogCache.current = next;
      setCatalog(next);
      if (selectedStyleId === style.id && style.enabled) {
        setSelectedStyleId(null);
        setDraft(null);
      }
    });
  }

  async function selectStyle(styleId: string, catalog: 'AREA_COLOR' | 'PHASED' = 'AREA_COLOR') {
    await runAction(`open:${styleId}`, async () => {
      const next = await startCalibrationDraft(styleId, catalog);
      openDraft(next);
      router.replace(`/dashboard/pricing/calibrate?styleId=${encodeURIComponent(styleId)}`, {
        scroll: false,
      });
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actionPending.current) return;
    const item = draft?.cases[position];
    if (!draft || !selectedStyleId || !item) return;
    if (!/^\d+(?:\.\d{1,2})?$/.test(price.trim()) || Number(price) <= 0) {
      setError('Ingresa un precio mayor que cero en PEN.');
      return;
    }
    await runAction('answer', async () => {
      const next = await saveCalibrationAnswer(selectedStyleId, item.id, Number(price));
      setDraft(next);
      const nextPosition = next.cases.findIndex(
        (entry, index) => index > position && entry.pricePen === null,
      );
      if (nextPosition >= 0) {
        setPosition(nextPosition);
        setPrice('');
      } else {
        setPrice(next.cases[position]?.pricePen ?? '');
        setNotice('Respuesta guardada.');
      }
    });
  }

  async function activate() {
    if (!selectedStyleId) return;
    await runAction('activate', async () => {
      const result = await activateCalibration(selectedStyleId);
      setDraft(null);
      setSelectedStyleId(null);
      router.replace('/dashboard/pricing/calibrate', { scroll: false });
      await refresh();
      setNotice(`Modelo de precios versión ${result.version} activado.`);
    });
  }

  async function saveAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actionPending.current) return;
    if (
      !/^-?\d+(?:\.\d{1,2})?$/.test(adjustment.trim()) ||
      Number(adjustment) <= -100 ||
      Number(adjustment) > 1000
    ) {
      setError('Ingresa un porcentaje mayor que -100 y hasta 1000.');
      return;
    }
    await runAction('adjustment', async () => {
      const result = await setGeneralAdjustment(Number(adjustment));
      await refresh();
      setNotice(`Ajuste guardado. Se crearon ${result.newVersions} versiones nuevas.`);
    });
  }

  const current = draft?.cases[position];
  const hasData = BASE_SECTIONS.some((section) => available.includes(section));
  const failedSections = Object.keys(loadErrors) as LoadSection[];
  const disabled = busy || loading;
  return (
    <div className={styles.page}>
      <header>
        <p className={styles.eyebrow}>Precios · Configurar / Calibrar</p>
        <h1>Precios por estilo</h1>
        <p>Selecciona los estilos que trabajas y responde cuánto cobrarías por cada referencia.</p>
      </header>
      <div className={styles.statusSlot} role="status" aria-live="polite">
        {loading
          ? hasData
            ? 'Actualizando...'
            : 'Cargando precios...'
          : pendingAction?.startsWith('style:')
            ? 'Guardando estilo...'
            : null}
      </div>
      {failedSections.length > 0 && (
        <section className={styles.error} role="alert">
          <strong>
            {hasData ? 'Algunas secciones no pudieron actualizarse' : 'No pudimos cargar Precios'}
          </strong>
          <ul>
            {failedSections.map((section) => (
              <li key={section}>
                {SECTION_LABELS[section]}: {loadErrors[section]}
              </li>
            ))}
          </ul>
          <p>{hasData ? 'La información disponible se conserva.' : 'Puedes reintentar aquí.'}</p>
          <button
            type="button"
            disabled={disabled}
            aria-busy={loading}
            onClick={() => void refresh(failedSections, true)}
          >
            <ActionLabel
              label="Reintentar carga"
              pendingLabel="Reintentando..."
              pending={loading}
            />
          </button>
        </section>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      <section className={`${styles.panel} ${styles.stylesPanel}`} aria-busy={loading}>
        <h2>1. Selecciona tus estilos</h2>
        <div className={styles.styleGrid}>
          {!available.includes('styles') ? (
            loading ? (
              Array.from({ length: 8 }, (_, index) => (
                <div
                  key={index}
                  className={`${styles.styleCard} ${styles.skeletonCard} ${index === 0 ? styles.enabledStyleCard : ''}`}
                  aria-hidden="true"
                />
              ))
            ) : (
              <p>Los estilos no están disponibles. Reintenta la carga.</p>
            )
          ) : (
            catalog.map((style) => (
              <div
                className={`${styles.styleCard} ${style.enabled ? styles.enabledStyleCard : ''}`}
                key={style.id}
              >
                <label>
                  <input
                    type="checkbox"
                    checked={style.enabled}
                    disabled={disabled}
                    onChange={() => void toggleStyle(style)}
                  />{' '}
                  {style.name}
                </label>
                {style.enabled && (
                  <div className={styles.styleActions}>
                    <small>
                      {style.activeVersion
                        ? `Modelo activo v${style.activeVersion}`
                        : 'Sin modelo activo'}{' '}
                      ·{' '}
                      {style.code === 'FINE_LINE'
                        ? style.catalogCaseCount
                        : style.caseCount + style.catalogCaseCount}{' '}
                      referencias disponibles
                    </small>
                    {(style.code === 'FINE_LINE' ||
                      style.caseCount > 0 ||
                      style.catalogCaseCount === 0) && (
                      <button
                        type="button"
                        disabled={
                          disabled ||
                          (style.code === 'FINE_LINE'
                            ? style.catalogCaseCount === 0
                            : style.caseCount === 0)
                        }
                        aria-busy={pendingAction === `open:${style.id}`}
                        onClick={() =>
                          void selectStyle(
                            style.id,
                            style.code === 'FINE_LINE' ? 'PHASED' : 'AREA_COLOR',
                          )
                        }
                      >
                        <ActionLabel
                          label={style.activeVersion ? 'Recalibrar' : 'Calibrar'}
                          pendingLabel="Abriendo..."
                          pending={pendingAction === `open:${style.id}`}
                        />
                      </button>
                    )}
                    {style.caseCount + style.catalogCaseCount === 0 && (
                      <small>Las imágenes de este estilo aún no están cargadas.</small>
                    )}
                    {style.catalogCaseCount > 0 && (
                      <button
                        type="button"
                        disabled={disabled}
                        aria-busy={pendingAction === `open:${style.id}`}
                        onClick={() => void selectStyle(style.id, 'PHASED')}
                      >
                        <ActionLabel
                          label={`Responder referencias (${style.catalogCaseCount})`}
                          pendingLabel="Abriendo..."
                          pending={pendingAction === `open:${style.id}`}
                        />
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      {draft && current && (
        <section className={styles.panel}>
          <h2>2. Calibración · {draft.styleName}</h2>
          <p>
            Referencia {position + 1} de {draft.totalCount} · {draft.answeredCount} respondidas
          </p>
          {!draft.canActivate && (
            <p>
              {draft.calibrationError ??
                'Tus precios se guardan. Completa las referencias para activar tu modelo.'}
            </p>
          )}
          <div className={styles.imageWrap}>
            <Image
              src={current.imageUrl}
              alt={`Referencia para ${draft.styleName}`}
              width={600}
              height={600}
              unoptimized
            />
          </div>
          <form
            onSubmit={(event) => void save(event)}
            className={styles.answerForm}
            aria-busy={pendingAction === 'answer'}
          >
            <label htmlFor="calibration-price">
              ¿Cuánto cobrarías normalmente por este tatuaje?
            </label>
            <div>
              <span>S/</span>
              <input
                id="calibration-price"
                type="number"
                inputMode="decimal"
                min="0.01"
                max="99999999.99"
                step="0.01"
                required
                disabled={disabled}
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </div>
            <button type="submit" disabled={disabled} aria-busy={pendingAction === 'answer'}>
              <ActionLabel
                label="Guardar respuesta"
                pendingLabel="Guardando..."
                pending={pendingAction === 'answer'}
              />
            </button>
          </form>
          <div className={styles.steps}>
            <button
              type="button"
              disabled={disabled || position === 0}
              onClick={() => {
                setPosition(position - 1);
                setPrice(draft.cases[position - 1].pricePen ?? '');
              }}
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={disabled || position === draft.cases.length - 1}
              onClick={() => {
                setPosition(position + 1);
                setPrice(draft.cases[position + 1].pricePen ?? '');
              }}
            >
              Siguiente
            </button>
          </div>
          {draft.canActivate && draft.answeredCount === draft.totalCount && (
            <button
              type="button"
              disabled={disabled}
              aria-busy={pendingAction === 'activate'}
              onClick={() => void activate()}
            >
              <ActionLabel
                label={`Activar modelo de ${draft.styleName}`}
                pendingLabel="Activando..."
                pending={pendingAction === 'activate'}
              />
            </button>
          )}
        </section>
      )}

      <section
        className={`${styles.panel} ${styles.adjustmentPanel}`}
        aria-busy={loading || pendingAction === 'adjustment'}
      >
        <h2>Ajuste general</h2>
        {available.includes('adjustment') ? (
          <>
            <p>
              Se aplica a los modelos activos y crea versiones nuevas. Ajuste actual:{' '}
              {savedAdjustment}
              %.
            </p>
            <form
              onSubmit={(event) => void saveAdjustment(event)}
              className={styles.adjustmentForm}
              aria-busy={pendingAction === 'adjustment'}
            >
              <label htmlFor="adjustment">Porcentaje</label>
              <input
                id="adjustment"
                type="number"
                step="0.01"
                min="-99.99"
                max="1000"
                value={adjustment}
                disabled={disabled}
                onChange={(event) => setAdjustment(event.target.value)}
              />
              <button
                type="submit"
                disabled={disabled || Number(adjustment) === Number(savedAdjustment)}
                aria-busy={pendingAction === 'adjustment'}
              >
                <ActionLabel
                  label="Guardar ajuste"
                  pendingLabel="Guardando..."
                  pending={pendingAction === 'adjustment'}
                />
              </button>
            </form>
          </>
        ) : (
          <p>
            {loading ? 'Cargando ajuste...' : 'El ajuste no está disponible. Reintenta la carga.'}
          </p>
        )}
      </section>

      <section className={`${styles.panel} ${styles.modelsPanel}`} aria-busy={loading}>
        <h2>Versiones de modelos</h2>
        {available.includes('models') ? (
          models.length > 0 ? (
            <ul className={styles.history}>
              {models.map((model) => (
                <li key={model.id}>
                  <strong>{model.styleName}</strong> · v{model.version} ·{' '}
                  {model.status === 'ACTIVE'
                    ? 'Activo'
                    : model.status === 'DRAFT'
                      ? 'Borrador'
                      : 'Anterior'}{' '}
                  · ajuste {model.adjustmentPercent}%
                </li>
              ))}
            </ul>
          ) : (
            <p>Todavía no hay versiones de modelos.</p>
          )
        ) : (
          <p>
            {loading
              ? 'Cargando versiones...'
              : 'Las versiones no están disponibles. Reintenta la carga.'}
          </p>
        )}
      </section>
    </div>
  );
}
