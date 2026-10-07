'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  DashboardError,
  DashboardLoading,
  EmptyState,
} from '@/components/dashboard/feedback-state';
import { ActionLabel } from '@/components/dashboard/action-label';
import { StatusBadge } from '@/components/dashboard/lead-card';
import { bookingIntentLabel } from '@/lib/v2-lead';
import {
  archiveLead,
  dashboardErrorMessage,
  deleteLead,
  isUnauthorized,
  listLeads,
  restoreLead,
  type LeadListResult,
  type LeadSortField,
  type LeadSummary,
  type LeadStatus,
  type SortOrder,
} from '@/lib/dashboard-api';
import { createSingleFlightRunner } from '@/lib/single-flight';
import { leadPriceLabel } from '@/lib/lead-price';
import styles from '@/styles/dashboard.module.css';

const PAGE_SIZE = 20;
const LEAD_STATUSES: LeadStatus[] = [
  'AUTO_QUOTED',
  'READY_TO_COORDINATE',
  'HANDOFF_TO_TATTOO_ARTIST',
  'REQUIRES_REVIEW',
  'SPECIAL_REVIEW',
  'ANALYZING',
  'COMPLETED',
];
const SORT_FIELDS: LeadSortField[] = ['price', 'createdAt', 'targetSizeCm', 'status'];

const TABS: Array<{
  key: 'all' | 'archived' | LeadStatus;
  label: string;
}> = [
  { key: 'all', label: 'Todos' },
  { key: 'AUTO_QUOTED', label: 'Listos' },
  { key: 'REQUIRES_REVIEW', label: 'Revisar' },
  { key: 'ANALYZING', label: 'Incompletos' },
  { key: 'SPECIAL_REVIEW', label: 'Revisión especial' },
  { key: 'READY_TO_COORDINATE', label: 'Para coordinar' },
  { key: 'HANDOFF_TO_TATTOO_ARTIST', label: 'En atención' },
  { key: 'COMPLETED', label: 'Finalizados' },
  { key: 'archived', label: 'Archivados' },
];

const SORT_LABELS: Record<LeadSortField, string> = {
  price: 'Precio',
  createdAt: 'Fecha',
  targetSizeCm: 'Tamaño objetivo',
  status: 'Estado',
};

const DATE_FORMATTER = new Intl.DateTimeFormat('es-PE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const EMPTY_MESSAGES: Record<(typeof TABS)[number]['key'], string> = {
  all: 'Todavía no hay leads activos para mostrar.',
  AUTO_QUOTED: 'No hay leads listos.',
  REQUIRES_REVIEW: 'No hay leads pendientes de revisión.',
  ANALYZING: 'No hay cotizaciones incompletas.',
  SPECIAL_REVIEW: 'No hay revisiones especiales.',
  READY_TO_COORDINATE: 'No hay leads para coordinar.',
  HANDOFF_TO_TATTOO_ARTIST: 'No hay leads en atención.',
  COMPLETED: 'No hay leads finalizados.',
  archived: 'No hay leads archivados.',
};

type QueryUpdate = Record<string, string | undefined>;
type PaginationItem = number | 'start-ellipsis' | 'end-ellipsis';

function PhoneSearch({ value, onSearch }: { value: string; onSearch: (value: string) => void }) {
  const [draft, setDraft] = useState(value);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSearch(draft.trim());
  }

  return (
    <form className={styles.phoneSearch} onSubmit={submit} role="search">
      <label htmlFor="lead-phone-search">Buscar por teléfono</label>
      <div>
        <input
          id="lead-phone-search"
          name="search"
          type="search"
          inputMode="tel"
          maxLength={20}
          placeholder="Ej. +51999999999"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit">Buscar</button>
      </div>
    </form>
  );
}

function enumValue<T extends string>(value: string | null, values: readonly T[]): T | undefined {
  return value && values.includes(value as T) ? (value as T) : undefined;
}

function positivePage(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function dateLabel(value: string): string {
  return DATE_FORMATTER.format(new Date(value))
    .replaceAll('.', '')
    .replace(/\b(?:set|sept)\b/, 'sep');
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('a, button, input, select, textarea'));
}

function LeadsLoading() {
  return (
    <div className={styles.leadsLoading} role="status" aria-label="Cargando leads">
      <span className={styles.srOnly}>Cargando leads…</span>
      {Array.from({ length: 6 }, (_, index) => (
        <span key={index} className={styles.leadSkeletonRow} aria-hidden="true" />
      ))}
    </div>
  );
}

function paginationItems(current: number, total: number): PaginationItem[] {
  if (total <= 5) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const pages = [...new Set([1, current - 1, current, current + 1, total])]
    .filter((page) => page >= 1 && page <= total)
    .sort((left, right) => left - right);
  const items: PaginationItem[] = [];

  pages.forEach((page, index) => {
    const previous = pages[index - 1];
    if (previous && page - previous > 1) {
      items.push(previous === 1 ? 'start-ellipsis' : 'end-ellipsis');
    }
    items.push(page);
  });

  return items;
}

function LeadsWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const status = enumValue(searchParams.get('status'), LEAD_STATUSES);
  const sortBy = enumValue(searchParams.get('sortBy'), SORT_FIELDS);
  const sortOrder: SortOrder = searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';
  const archived = searchParams.get('archived') === 'true';
  const search = searchParams.get('search')?.trim() ?? '';
  const page = positivePage(searchParams.get('page'));
  const activeTab = archived ? 'archived' : (status ?? 'all');
  const requestKey = searchParams.toString();
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingLeadId, setPendingLeadId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<LeadSummary | null>(null);
  const runSingleFlight = useRef(createSingleFlightRunner()).current;
  const [refreshKey, setRefreshKey] = useState(0);
  const currentRequestKey = `${requestKey}:${refreshKey}`;
  const [requestState, setRequestState] = useState<{
    key: string;
    resultKey: string;
    result: LeadListResult | null;
    error: string | null;
  } | null>(null);
  const currentState = requestState?.key === currentRequestKey ? requestState : null;
  const result = requestState?.result ?? null;
  const error = currentState?.error ?? null;
  const updating = currentState === null;
  const stale = Boolean(result && (requestState?.resultKey !== currentRequestKey || error));

  const navigate = useCallback(
    (updates: QueryUpdate, resetPage = true) => {
      const next = new URLSearchParams(searchParams.toString());

      Object.entries(updates).forEach(([key, value]) => {
        if (value) {
          next.set(key, value);
        } else {
          next.delete(key);
        }
      });

      if (resetPage) {
        next.delete('page');
      }

      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    let active = true;

    void Promise.resolve().then(() => {
      if (active) setRequestState((previous) => (previous ? { ...previous, key: '' } : previous));
    });

    void listLeads({
      status,
      archived,
      search: search || undefined,
      sortBy,
      sortOrder,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((data) => {
        if (active) {
          setRequestState({
            key: currentRequestKey,
            resultKey: currentRequestKey,
            result: data,
            error: null,
          });
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

        setRequestState((previous) => ({
          key: currentRequestKey,
          resultKey: previous?.resultKey ?? '',
          result: previous?.result ?? null,
          error: dashboardErrorMessage(requestError),
        }));
      });

    return () => {
      active = false;
    };
  }, [archived, currentRequestKey, page, router, search, sortBy, sortOrder, status]);

  const pageItems = useMemo(
    () => paginationItems(result?.pagination.page ?? 1, result?.pagination.totalPages ?? 0),
    [result?.pagination.page, result?.pagination.totalPages],
  );

  function selectTab(tab: (typeof TABS)[number]['key']): void {
    if (tab === 'archived') {
      navigate({ archived: 'true', status: undefined });
      return;
    }

    navigate({
      archived: undefined,
      status: tab === 'all' ? undefined : tab,
    });
  }

  function applySort(field: LeadSortField): void {
    const nextOrder: SortOrder = sortBy === field && sortOrder === 'desc' ? 'asc' : 'desc';
    navigate({ sortBy: field, sortOrder: nextOrder });
  }

  function openLead(
    leadId: string,
    event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
  ): void {
    if (isInteractiveTarget(event.target)) {
      return;
    }

    if ('key' in event && event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    if ('key' in event) {
      event.preventDefault();
    }

    router.push(`/dashboard/leads/${leadId}`);
  }

  async function runAction(leadId: string, action: () => Promise<unknown>): Promise<void> {
    if (stale || updating) return;
    await runSingleFlight(async () => {
      setPendingLeadId(leadId);
      setActionError(null);

      try {
        await action();
        setDeleteCandidate(null);
        setRefreshKey((current) => current + 1);
      } catch (requestError) {
        if (isUnauthorized(requestError)) {
          router.replace('/login');
          return;
        }

        setActionError(dashboardErrorMessage(requestError));
      } finally {
        setPendingLeadId(null);
      }
    });
  }

  const renderDeleteAction = (lead: LeadSummary) =>
    lead.deletable ? (
      <button
        className={styles.deleteAction}
        type="button"
        onClick={() => setDeleteCandidate(lead)}
        disabled={pendingLeadId !== null || stale || updating}
      >
        Eliminar
      </button>
    ) : null;

  const renderActions = (lead: LeadSummary) => (
    <div className={styles.rowActions}>
      <Link className={styles.viewAction} href={`/dashboard/leads/${lead.id}`}>
        Ver
      </Link>
      {lead.archivedAt !== null ? (
        <>
          <button
            type="button"
            onClick={() => void runAction(lead.id, () => restoreLead(lead.id))}
            disabled={pendingLeadId !== null || stale || updating}
            aria-busy={pendingLeadId === lead.id}
          >
            <ActionLabel
              label="Restaurar"
              pendingLabel="Restaurando..."
              pending={pendingLeadId === lead.id}
            />
          </button>
          {renderDeleteAction(lead)}
        </>
      ) : (
        <>
          {lead.status === 'ANALYZING' && (
            <button
              type="button"
              onClick={() => void runAction(lead.id, () => archiveLead(lead.id))}
              disabled={pendingLeadId !== null || stale || updating}
              aria-busy={pendingLeadId === lead.id}
            >
              <ActionLabel
                label="Archivar"
                pendingLabel="Archivando..."
                pending={pendingLeadId === lead.id}
              />
            </button>
          )}
          {renderDeleteAction(lead)}
        </>
      )}
    </div>
  );

  const sortableHeading = (field: LeadSortField, label: string) => (
    <button type="button" onClick={() => applySort(field)}>
      {label}
      <span aria-hidden="true">{sortBy === field ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}</span>
    </button>
  );

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <span>Tatuoflow</span>
          <h1>Bandeja de leads</h1>
          <p>Prioriza cotizaciones, revisa su preparación y gestiona pendientes.</p>
        </div>
      </header>

      <nav className={styles.leadTabs} aria-label="Categorías de leads">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={activeTab === tab.key ? styles.leadTabActive : ''}
            aria-pressed={activeTab === tab.key}
            onClick={() => selectTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section className={styles.leadFilters} aria-label="Filtros de leads">
        <PhoneSearch
          key={search}
          value={search}
          onSearch={(value) => navigate({ search: value || undefined })}
        />

        <label>
          <span>Ordenar por</span>
          <select
            value={sortBy ?? ''}
            onChange={(event) =>
              navigate({
                sortBy: event.target.value || undefined,
                sortOrder: event.target.value ? sortOrder : undefined,
              })
            }
          >
            <option value="">Más recientes</option>
            {SORT_FIELDS.map((value) => (
              <option key={value} value={value}>
                {SORT_LABELS[value]}
              </option>
            ))}
          </select>
        </label>

        <button
          className={styles.sortDirection}
          type="button"
          disabled={!sortBy}
          aria-label={sortOrder === 'asc' ? 'Orden ascendente' : 'Orden descendente'}
          onClick={() => navigate({ sortOrder: sortOrder === 'asc' ? 'desc' : 'asc' })}
        >
          {sortOrder === 'asc' ? 'Asc ↑' : 'Desc ↓'}
        </button>
      </section>

      {actionError && (
        <p className={styles.inlineError} role="alert">
          {actionError}
        </p>
      )}

      <p className={styles.resultsStatus} role="status" aria-live="polite">
        {updating && result
          ? 'Actualizando...'
          : error && result
            ? 'Se muestran los últimos pedidos cargados.'
            : null}
      </p>
      <section className={styles.leadResults} aria-label="Resultados de leads" aria-busy={updating}>
        {error && result ? (
          <div className={styles.inlineError} role="alert">
            <p>No pudimos actualizar los pedidos. {error}</p>
            <button type="button" onClick={() => setRefreshKey((current) => current + 1)}>
              Reintentar
            </button>
          </div>
        ) : (
          error && (
            <DashboardError message={error} retry={() => setRefreshKey((current) => current + 1)} />
          )
        )}
        {!error && !result && <LeadsLoading />}
        {result && result.leads.length === 0 && (
          <EmptyState>
            {stale ? 'No había leads en la última carga.' : EMPTY_MESSAGES[activeTab]}
          </EmptyState>
        )}

        {result && result.leads.length > 0 && (
          <>
            <div className={styles.leadTableShell}>
              <table className={styles.leadTable}>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th
                      aria-sort={
                        sortBy === 'price'
                          ? sortOrder === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      {sortableHeading('price', 'Precio')}
                    </th>
                    <th
                      aria-sort={
                        sortBy === 'targetSizeCm'
                          ? sortOrder === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      {sortableHeading('targetSizeCm', 'Tamaño objetivo')}
                    </th>
                    <th>Estilo</th>
                    <th
                      aria-sort={
                        sortBy === 'status'
                          ? sortOrder === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      {sortableHeading('status', 'Estado')}
                    </th>
                    <th
                      aria-sort={
                        sortBy === 'createdAt'
                          ? sortOrder === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      {sortableHeading('createdAt', 'Fecha')}
                    </th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {result.leads.map((lead) => (
                    <tr
                      key={lead.id}
                      className={styles.clickableLeadRow}
                      tabIndex={0}
                      role="link"
                      aria-label={`Ver lead de ${lead.customerPhoneNumber}`}
                      onClick={(event) => openLead(lead.id, event)}
                      onKeyDown={(event) => openLead(lead.id, event)}
                    >
                      <td className={styles.customerCell}>{lead.customerPhoneNumber}</td>
                      <td className={styles.priceCell}>{leadPriceLabel(lead)}</td>
                      <td>{lead.targetSizeCm !== null ? `${lead.targetSizeCm} cm` : '—'}</td>
                      <td>
                        {
                          <>
                            {lead.v2.style ?? '—'}
                            <small>
                              {lead.v2.targetColorCoverage === null
                                ? 'Color pendiente'
                                : `${Math.round(lead.v2.targetColorCoverage * 100)}% color`}
                            </small>
                          </>
                        }
                      </td>
                      <td>
                        {
                          <>
                            <StatusBadge status={lead.status} label={lead.statusLabel} />
                            <small>{bookingIntentLabel(lead.v2.bookingIntent)}</small>
                          </>
                        }
                      </td>
                      <td className={styles.dateCell}>{dateLabel(lead.createdAt)}</td>
                      <td>{renderActions(lead)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.mobileLeadTable}>
              {result.leads.map((lead) => (
                <article
                  key={lead.id}
                  className={`${styles.mobileLeadRow} ${styles.clickableLeadRow}`}
                  tabIndex={0}
                  role="link"
                  aria-label={`Ver lead de ${lead.customerPhoneNumber}`}
                  onClick={(event) => openLead(lead.id, event)}
                  onKeyDown={(event) => openLead(lead.id, event)}
                >
                  <div className={styles.mobileLeadTopline}>
                    <strong>{lead.customerPhoneNumber}</strong>
                    <StatusBadge status={lead.status} label={lead.statusLabel} />
                  </div>
                  <dl>
                    <div>
                      <dt>Tamaño objetivo</dt>
                      <dd>{lead.targetSizeCm !== null ? `${lead.targetSizeCm} cm` : '—'}</dd>
                    </div>
                    <div>
                      <dt>Estilo</dt>
                      <dd>{lead.v2.style ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>Precio</dt>
                      <dd>{leadPriceLabel(lead)}</dd>
                    </div>
                    {lead.v2 && (
                      <>
                        <div>
                          <dt>Color objetivo</dt>
                          <dd>
                            {lead.v2.targetColorCoverage === null
                              ? 'Pendiente'
                              : `${Math.round(lead.v2.targetColorCoverage * 100)}%`}
                          </dd>
                        </div>
                        <div>
                          <dt>Intención</dt>
                          <dd>{bookingIntentLabel(lead.v2.bookingIntent)}</dd>
                        </div>
                      </>
                    )}
                    <div>
                      <dt>Fecha</dt>
                      <dd>{dateLabel(lead.createdAt)}</dd>
                    </div>
                  </dl>
                  {renderActions(lead)}
                </article>
              ))}
            </div>

            <footer className={styles.paginationBar}>
              <p>
                Mostrando {(result.pagination.page - 1) * result.pagination.pageSize + 1}–
                {Math.min(
                  result.pagination.page * result.pagination.pageSize,
                  result.pagination.total,
                )}{' '}
                de {result.pagination.total}
              </p>
              <nav aria-label="Paginación de leads">
                <button
                  type="button"
                  disabled={stale || updating || result.pagination.page <= 1}
                  onClick={() => navigate({ page: String(result.pagination.page - 1) }, false)}
                >
                  Anterior
                </button>
                {pageItems.map((item) =>
                  typeof item === 'number' ? (
                    <button
                      key={item}
                      type="button"
                      className={item === result.pagination.page ? styles.currentPage : ''}
                      aria-current={item === result.pagination.page ? 'page' : undefined}
                      disabled={stale || updating}
                      onClick={() => navigate({ page: String(item) }, false)}
                    >
                      {item}
                    </button>
                  ) : (
                    <span key={item}>…</span>
                  ),
                )}
                <button
                  type="button"
                  disabled={
                    stale || updating || result.pagination.page >= result.pagination.totalPages
                  }
                  onClick={() => navigate({ page: String(result.pagination.page + 1) }, false)}
                >
                  Siguiente
                </button>
              </nav>
            </footer>
          </>
        )}
      </section>

      {deleteCandidate && (
        <div className={styles.modalBackdrop} role="presentation">
          <section
            className={styles.confirmationModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-lead-title"
          >
            <span className={styles.eyebrow}>Confirmar eliminación</span>
            <h2 id="delete-lead-title">¿Eliminar este lead?</h2>
            <p>Esta acción no se puede deshacer.</p>
            <div className={styles.modalActions}>
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => setDeleteCandidate(null)}
                disabled={pendingLeadId !== null}
              >
                Cancelar
              </button>
              <button
                className={styles.dangerButton}
                type="button"
                onClick={() =>
                  void runAction(deleteCandidate.id, () => deleteLead(deleteCandidate.id))
                }
                disabled={pendingLeadId !== null || stale || updating}
                aria-busy={pendingLeadId === deleteCandidate.id}
              >
                <ActionLabel
                  label="Eliminar"
                  pendingLabel="Eliminando..."
                  pending={pendingLeadId === deleteCandidate.id}
                />
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export default function LeadsPage() {
  return (
    <Suspense fallback={<DashboardLoading label="Preparando la bandeja…" />}>
      <LeadsWorkspace />
    </Suspense>
  );
}
