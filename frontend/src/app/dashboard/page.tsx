'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  DashboardError,
  DashboardLoading,
  EmptyState,
} from '@/components/dashboard/feedback-state';
import { LeadCard } from '@/components/dashboard/lead-card';
import {
  dashboardErrorMessage,
  getDashboardMetrics,
  isUnauthorized,
  type DashboardMetrics,
} from '@/lib/dashboard-api';
import styles from '@/styles/dashboard.module.css';

const METRICS = [
  { key: 'newOrders' as const, label: 'Nuevos pedidos' },
  { key: 'verified' as const, label: 'Verificados' },
  { key: 'requiresReview' as const, label: 'Para revisar' },
  { key: 'completed' as const, label: 'Completados' },
];

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    try {
      const result = await getDashboardMetrics();
      setError(null);
      setData(result);
    } catch (requestError) {
      if (isUnauthorized(requestError)) {
        router.replace('/login');
        return;
      }

      setError(dashboardErrorMessage(requestError));
    }
  }, [router]);

  useEffect(() => {
    let active = true;

    void getDashboardMetrics()
      .then((result) => {
        if (active) {
          setData(result);
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
  }, [router]);

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <span>Resumen</span>
          <h1>Inicio</h1>
          <p>Lo más importante del estudio, sin complicaciones.</p>
        </div>
      </header>

      {error && (
        <DashboardError
          message={error}
          retry={() => {
            setError(null);
            void loadDashboard();
          }}
        />
      )}
      {!error && !data && <DashboardLoading label="Preparando tu resumen…" />}

      {data && (
        <>
          <section className={styles.metricsGrid} aria-label="Resumen de pedidos">
            {METRICS.map((metric) => (
              <article key={metric.key} className={styles.metricCard}>
                <span>{metric.label}</span>
                <strong>{data.totals[metric.key]}</strong>
              </article>
            ))}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2>Pedidos recientes</h2>
              <Link href="/dashboard/leads">Ver todos</Link>
            </div>
            {data.recentLeads.length > 0 ? (
              <div className={styles.leadList}>
                {data.recentLeads.map((lead) => (
                  <LeadCard key={lead.id} lead={lead} />
                ))}
              </div>
            ) : (
              <EmptyState>Todavía no hay pedidos completos para mostrar.</EmptyState>
            )}
          </section>
        </>
      )}
    </>
  );
}
