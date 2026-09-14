'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DashboardError,
  DashboardLoading,
  EmptyState,
} from '@/components/dashboard/feedback-state';
import {
  dashboardErrorMessage,
  getPricingRules,
  isUnauthorized,
  updatePricingRules,
  type PricingRuleUpdate,
  type PricingRuleView,
} from '@/lib/dashboard-api';
import styles from '@/styles/dashboard.module.css';

const SIZE_ORDER: PricingRuleView['size'][] = ['SMALL', 'MEDIUM', 'LARGE'];
const DETAIL_ORDER: PricingRuleView['detail'][] = ['LIGHT', 'MEDIUM', 'DETAILED'];
const MAX_PRICE = 99_999_999.99;

interface PriceDraft {
  minPrice: string;
  maxPrice: string;
}

type PriceDrafts = Record<string, PriceDraft>;
type PriceErrors = Record<string, string>;

function createDrafts(rules: PricingRuleView[]): PriceDrafts {
  return Object.fromEntries(
    rules.map((rule) => [
      rule.id,
      { minPrice: rule.minPrice, maxPrice: rule.maxPrice } satisfies PriceDraft,
    ]),
  );
}

function parsePrice(value: string): number | null {
  const trimmedValue = value.trim();

  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmedValue)) {
    return null;
  }

  const price = Number(trimmedValue);

  return Number.isFinite(price) && price <= MAX_PRICE ? price : null;
}

function validateChanges(rules: PricingRuleView[], drafts: PriceDrafts) {
  const errors: PriceErrors = {};
  const updates: PricingRuleUpdate[] = [];

  for (const rule of rules) {
    const draft = drafts[rule.id];
    const minPrice = draft ? parsePrice(draft.minPrice) : null;
    const maxPrice = draft ? parsePrice(draft.maxPrice) : null;

    if (minPrice === null || maxPrice === null) {
      errors[rule.id] = 'Ingresa dos precios válidos, sin dejar campos vacíos.';
      continue;
    }

    if (maxPrice < minPrice) {
      errors[rule.id] = 'El precio máximo debe ser igual o mayor al mínimo.';
      continue;
    }

    if (minPrice !== Number(rule.minPrice) || maxPrice !== Number(rule.maxPrice)) {
      updates.push({ pricingRuleId: rule.id, minPrice, maxPrice });
    }
  }

  return { errors, updates };
}

export default function PricingPage() {
  const router = useRouter();
  const [rules, setRules] = useState<PricingRuleView[] | null>(null);
  const [drafts, setDrafts] = useState<PriceDrafts>({});
  const [errors, setErrors] = useState<PriceErrors>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pendingUpdates, setPendingUpdates] = useState<PricingRuleUpdate[] | null>(null);
  const [saving, setSaving] = useState(false);

  const applyLoadedRules = useCallback((loadedRules: PricingRuleView[]) => {
    setRules(loadedRules);
    setDrafts(createDrafts(loadedRules));
    setErrors({});
  }, []);

  const loadRules = useCallback(async () => {
    try {
      const result = await getPricingRules();
      setLoadError(null);
      applyLoadedRules(result.rules);
    } catch (requestError) {
      if (isUnauthorized(requestError)) {
        router.replace('/login');
        return;
      }

      setLoadError(dashboardErrorMessage(requestError));
    }
  }, [applyLoadedRules, router]);

  useEffect(() => {
    let active = true;

    void getPricingRules()
      .then((result) => {
        if (active) {
          applyLoadedRules(result.rules);
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

        setLoadError(dashboardErrorMessage(requestError));
      });

    return () => {
      active = false;
    };
  }, [applyLoadedRules, router]);

  const rulesByCombination = useMemo(
    () => new Map((rules ?? []).map((rule) => [`${rule.detail}:${rule.size}`, rule] as const)),
    [rules],
  );

  const changedCount = useMemo(
    () =>
      rules
        ? rules.filter((rule) => {
            const draft = drafts[rule.id];

            if (!draft) {
              return true;
            }

            const minPrice = parsePrice(draft.minPrice);
            const maxPrice = parsePrice(draft.maxPrice);

            return (
              minPrice === null ||
              maxPrice === null ||
              minPrice !== Number(rule.minPrice) ||
              maxPrice !== Number(rule.maxPrice)
            );
          }).length
        : 0,
    [drafts, rules],
  );

  function updateDraft(ruleId: string, field: keyof PriceDraft, value: string) {
    setDrafts((current) => ({
      ...current,
      [ruleId]: {
        minPrice: current[ruleId]?.minPrice ?? '',
        maxPrice: current[ruleId]?.maxPrice ?? '',
        [field]: value,
      },
    }));
    setErrors((current) => {
      if (!(ruleId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[ruleId];
      return next;
    });
    setSaveError(null);
    setSuccess(false);
  }

  function openConfirmation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!rules) {
      return;
    }

    const validation = validateChanges(rules, drafts);
    setErrors(validation.errors);

    if (Object.keys(validation.errors).length > 0 || validation.updates.length === 0) {
      return;
    }

    setPendingUpdates(validation.updates);
  }

  async function confirmSave() {
    if (!pendingUpdates || saving) {
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const result = await updatePricingRules(pendingUpdates);
      applyLoadedRules(result.rules);
      setPendingUpdates(null);
      setSuccess(true);
    } catch (requestError) {
      if (isUnauthorized(requestError)) {
        router.replace('/login');
        return;
      }

      setSaveError('No se pudieron actualizar los precios. Inténtalo nuevamente.');
      setPendingUpdates(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <span>Precios</span>
          <h1>Tabla de precios</h1>
          <p>Edita únicamente los importes. Los tamaños y sus rangos permanecen fijos.</p>
        </div>
      </header>

      {loadError && (
        <DashboardError
          message={loadError}
          retry={() => {
            setLoadError(null);
            void loadRules();
          }}
        />
      )}
      {!loadError && !rules && <DashboardLoading label="Cargando precios…" />}
      {rules && rules.length === 0 && <EmptyState>No hay reglas de precios activas.</EmptyState>}
      {rules && rules.length > 0 && (
        <form className={styles.pricingForm} onSubmit={openConfirmation} noValidate>
          <div className={styles.pricingMatrix}>
            <div className={styles.pricingMatrixHeader} aria-hidden="true">
              <span>Nivel de detalle</span>
              {SIZE_ORDER.map((size) => {
                const rule = rules.find((candidate) => candidate.size === size);

                return (
                  <div key={size}>
                    <strong>{rule?.sizeLabel}</strong>
                    <small>{rule?.sizeRange}</small>
                  </div>
                );
              })}
            </div>

            <div className={styles.pricingRows}>
              {DETAIL_ORDER.map((detail) => {
                const detailRule = rules.find((rule) => rule.detail === detail);

                return (
                  <section key={detail} className={styles.pricingRow}>
                    <header className={styles.pricingRowHeader}>
                      <span>Nivel de detalle</span>
                      <h2>{detailRule?.detailLabel}</h2>
                    </header>

                    {SIZE_ORDER.map((size) => {
                      const rule = rulesByCombination.get(`${detail}:${size}`);

                      if (!rule) {
                        return (
                          <div key={size} className={styles.pricingUnavailable}>
                            No disponible
                          </div>
                        );
                      }

                      const draft = drafts[rule.id] ?? { minPrice: '', maxPrice: '' };
                      const error = errors[rule.id];

                      return (
                        <div key={rule.id} className={styles.pricingCell}>
                          <div className={styles.pricingCellHeading}>
                            <strong>{rule.sizeLabel}</strong>
                            <span>{rule.sizeRange}</span>
                          </div>
                          <div className={styles.pricingInputs}>
                            <label>
                              <span>Mínimo</span>
                              <span className={styles.pricingInputWrap}>
                                <b>S/</b>
                                <input
                                  aria-invalid={Boolean(error)}
                                  inputMode="decimal"
                                  max={MAX_PRICE}
                                  min="0"
                                  onChange={(event) =>
                                    updateDraft(rule.id, 'minPrice', event.target.value)
                                  }
                                  step="0.01"
                                  type="number"
                                  value={draft.minPrice}
                                />
                              </span>
                            </label>
                            <label>
                              <span>Máximo</span>
                              <span className={styles.pricingInputWrap}>
                                <b>S/</b>
                                <input
                                  aria-invalid={Boolean(error)}
                                  inputMode="decimal"
                                  max={MAX_PRICE}
                                  min="0"
                                  onChange={(event) =>
                                    updateDraft(rule.id, 'maxPrice', event.target.value)
                                  }
                                  step="0.01"
                                  type="number"
                                  value={draft.maxPrice}
                                />
                              </span>
                            </label>
                          </div>
                          {error && <p className={styles.pricingFieldError}>{error}</p>}
                        </div>
                      );
                    })}
                  </section>
                );
              })}
            </div>
          </div>

          {success && (
            <div className={styles.pricingSuccess} role="status">
              <strong>Precios actualizados correctamente.</strong>
              <span>Los nuevos precios se aplicarán a futuras cotizaciones.</span>
            </div>
          )}
          {saveError && (
            <p className={styles.pricingSaveError} role="alert">
              {saveError}
            </p>
          )}

          <div className={styles.pricingActions}>
            <span>
              {changedCount > 0
                ? `${changedCount} ${changedCount === 1 ? 'precio modificado' : 'precios modificados'}`
                : 'Sin cambios pendientes'}
            </span>
            <button className={styles.primaryButton} disabled={changedCount === 0} type="submit">
              Guardar cambios
            </button>
          </div>
        </form>
      )}

      {pendingUpdates && (
        <div className={styles.modalBackdrop} role="presentation">
          <section
            aria-labelledby="pricing-confirmation-title"
            aria-modal="true"
            className={styles.confirmationModal}
            role="dialog"
          >
            <span className={styles.eyebrow}>Confirmar cambio</span>
            <h2 id="pricing-confirmation-title">
              Los nuevos precios se aplicarán solo a pedidos nuevos.
            </h2>
            <p>Los pedidos que ya tienen una cotización conservarán su precio actual.</p>
            <div className={styles.modalActions}>
              <button
                className={styles.secondaryButton}
                disabled={saving}
                onClick={() => setPendingUpdates(null)}
                type="button"
              >
                Cancelar
              </button>
              <button
                className={styles.primaryButton}
                disabled={saving}
                onClick={() => void confirmSave()}
                type="button"
              >
                {saving ? 'Guardando…' : 'Guardar precios'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
