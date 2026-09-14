'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  DashboardError,
  DashboardLoading,
  EmptyState,
} from '@/components/dashboard/feedback-state';
import { LeadCard } from '@/components/dashboard/lead-card';
import {
  dashboardErrorMessage,
  isUnauthorized,
  listLeads,
  type LeadSummary,
} from '@/lib/dashboard-api';
import styles from '@/styles/dashboard.module.css';

const FILTERS = [
  { value: 'all', label: 'Todos' },
  { value: 'verified', label: 'Verificados' },
  { value: 'requires-review', label: 'Requieren revisión' },
  { value: 'completed', label: 'Finalizados' },
];

export default function LeadsPage() {
  const router = useRouter();
  const [filter, setFilter] = useState('all');
  const [leads, setLeads] = useState<LeadSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;

    void listLeads(filter)
      .then((result) => {
        if (active) {
          setError(null);
          setLeads(result.leads);
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
  }, [filter, retryKey, router]);

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <span>Pedidos</span>
          <h1>Todos los pedidos</h1>
          <p>Aquí aparecen únicamente solicitudes completas de clientes.</p>
        </div>
      </header>

      <div className={styles.filterBar} aria-label="Filtrar pedidos">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            className={filter === item.value ? styles.filterActive : ''}
            type="button"
            onClick={() => {
              setFilter(item.value);
              setLeads(null);
              setError(null);
            }}
            aria-pressed={filter === item.value}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && (
        <DashboardError
          message={error}
          retry={() => {
            setError(null);
            setLeads(null);
            setRetryKey((current) => current + 1);
          }}
        />
      )}
      {!error && !leads && <DashboardLoading label="Cargando pedidos…" />}
      {leads && leads.length === 0 && <EmptyState>No hay pedidos en este filtro.</EmptyState>}
      {leads && leads.length > 0 && (
        <div className={styles.leadList}>
          {leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} />
          ))}
        </div>
      )}
    </>
  );
}
