'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
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
  const openingDraft = useRef(false);

  const handleError = useCallback(
    (cause: unknown) => {
      if (isUnauthorized(cause)) router.replace('/login');
      else setError(dashboardErrorMessage(cause));
    },
    [router],
  );

  const refresh = useCallback(async () => {
    const [stylesResult, modelsResult, adjustmentResult] = await Promise.all([
      getCalibrationStyles(),
      getPricingModels(),
      getGeneralAdjustment(),
    ]);
    setCatalog(stylesResult);
    setModels(modelsResult);
    setAdjustment(adjustmentResult.percent);
    setSavedAdjustment(adjustmentResult.percent);
  }, []);

  const openDraft = useCallback((next: CalibrationDraftView) => {
    setSelectedStyleId(next.styleId);
    setDraft(next);
    const first = next.cases.findIndex((item) => item.pricePen === null);
    const nextPosition = first < 0 ? 0 : first;
    setPosition(nextPosition);
    setPrice(next.cases[nextPosition]?.pricePen ?? '');
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [stylesResult, modelsResult, adjustmentResult] = await Promise.all([
          getCalibrationStyles(),
          getPricingModels(),
          getGeneralAdjustment(),
        ]);
        if (cancelled) return;
        setCatalog(stylesResult);
        setModels(modelsResult);
        setAdjustment(adjustmentResult.percent);
        setSavedAdjustment(adjustmentResult.percent);
        const enabled = stylesResult.filter((style) => style.enabled);
        const requestedId = new URLSearchParams(window.location.search).get('styleId');
        const requested = enabled.find((style) => style.id === requestedId);
        const pending = await Promise.all(
          (requested ? [requested] : enabled).map((style) => getCalibrationDraft(style.id)),
        );
        const existing = pending.find((item) => item !== null);
        if (!cancelled && existing) openDraft(existing);
      } catch (cause) {
        if (!cancelled) handleError(cause);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handleError, openDraft]);

  async function toggleStyle(style: CalibrationStyleView) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await setCalibrationStyle(style.id, !style.enabled);
      setCatalog((current) =>
        current.map((item) => (item.id === style.id ? { ...item, enabled: !item.enabled } : item)),
      );
      if (selectedStyleId === style.id && style.enabled) {
        setSelectedStyleId(null);
        setDraft(null);
      }
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function selectStyle(styleId: string, catalog: 'AREA_COLOR' | 'PHASED' = 'AREA_COLOR') {
    if (openingDraft.current) return;
    openingDraft.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await startCalibrationDraft(styleId, catalog);
      openDraft(next);
      router.replace(`/dashboard/pricing/calibrate?styleId=${encodeURIComponent(styleId)}`, {
        scroll: false,
      });
    } catch (cause) {
      handleError(cause);
    } finally {
      openingDraft.current = false;
      setBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const item = draft?.cases[position];
    if (!draft || !selectedStyleId || !item) return;
    if (!/^\d+(?:\.\d{1,2})?$/.test(price.trim()) || Number(price) <= 0) {
      setError('Ingresa un precio mayor que cero en PEN.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
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
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function activate() {
    if (!selectedStyleId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await activateCalibration(selectedStyleId);
      setDraft(null);
      setSelectedStyleId(null);
      router.replace('/dashboard/pricing/calibrate', { scroll: false });
      await refresh();
      setNotice(`Modelo de precios versión ${result.version} activado.`);
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function saveAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !/^-?\d+(?:\.\d{1,2})?$/.test(adjustment.trim()) ||
      Number(adjustment) <= -100 ||
      Number(adjustment) > 1000
    ) {
      setError('Ingresa un porcentaje mayor que -100 y hasta 1000.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await setGeneralAdjustment(Number(adjustment));
      await refresh();
      setNotice(`Ajuste guardado. Se crearon ${result.newVersions} versiones nuevas.`);
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  const current = draft?.cases[position];
  return (
    <div className={styles.page}>
      <header>
        <p className={styles.eyebrow}>Precios · Configurar / Calibrar</p>
        <h1>Precios por estilo</h1>
        <p>Selecciona los estilos que trabajas y responde cuánto cobrarías por cada referencia.</p>
      </header>
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
      {loading ? (
        <p>Cargando estilos…</p>
      ) : (
        <section className={styles.panel}>
          <h2>1. Selecciona tus estilos</h2>
          <div className={styles.styleGrid}>
            {catalog.map((style) => (
              <div className={styles.styleCard} key={style.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={style.enabled}
                    disabled={busy}
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
                          busy ||
                          (style.code === 'FINE_LINE'
                            ? style.catalogCaseCount === 0
                            : style.caseCount === 0)
                        }
                        onClick={() =>
                          void selectStyle(
                            style.id,
                            style.code === 'FINE_LINE' ? 'PHASED' : 'AREA_COLOR',
                          )
                        }
                      >
                        {style.activeVersion ? 'Recalibrar' : 'Calibrar'}
                      </button>
                    )}
                    {style.caseCount + style.catalogCaseCount === 0 && (
                      <small>Las imágenes de este estilo aún no están cargadas.</small>
                    )}
                    {style.catalogCaseCount > 0 && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void selectStyle(style.id, 'PHASED')}
                      >
                        Responder referencias ({style.catalogCaseCount})
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

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
          <form onSubmit={(event) => void save(event)} className={styles.answerForm}>
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
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </div>
            <button type="submit" disabled={busy}>
              Guardar respuesta
            </button>
          </form>
          <div className={styles.steps}>
            <button
              type="button"
              disabled={busy || position === 0}
              onClick={() => {
                setPosition(position - 1);
                setPrice(draft.cases[position - 1].pricePen ?? '');
              }}
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={busy || position === draft.cases.length - 1}
              onClick={() => {
                setPosition(position + 1);
                setPrice(draft.cases[position + 1].pricePen ?? '');
              }}
            >
              Siguiente
            </button>
          </div>
          {draft.canActivate && draft.answeredCount === draft.totalCount && (
            <button type="button" disabled={busy} onClick={() => void activate()}>
              Activar modelo de {draft.styleName}
            </button>
          )}
        </section>
      )}

      <section className={styles.panel}>
        <h2>Ajuste general</h2>
        <p>
          Se aplica a los modelos activos y crea versiones nuevas. Ajuste actual: {savedAdjustment}
          %.
        </p>
        <form onSubmit={(event) => void saveAdjustment(event)} className={styles.adjustmentForm}>
          <label htmlFor="adjustment">Porcentaje</label>
          <input
            id="adjustment"
            type="number"
            step="0.01"
            min="-99.99"
            max="1000"
            value={adjustment}
            onChange={(event) => setAdjustment(event.target.value)}
          />
          <button type="submit" disabled={busy || Number(adjustment) === Number(savedAdjustment)}>
            Guardar ajuste
          </button>
        </form>
      </section>

      {models.length > 0 && (
        <section className={styles.panel}>
          <h2>Versiones de modelos</h2>
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
        </section>
      )}
    </div>
  );
}
