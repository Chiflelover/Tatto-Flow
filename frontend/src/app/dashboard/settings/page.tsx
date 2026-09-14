'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { DashboardError, DashboardLoading } from '@/components/dashboard/feedback-state';
import {
  dashboardErrorMessage,
  getSession,
  isUnauthorized,
  type TattooArtistSession,
} from '@/lib/dashboard-api';
import styles from '@/styles/dashboard.module.css';

export default function SettingsPage() {
  const router = useRouter();
  const [session, setSession] = useState<TattooArtistSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    try {
      const result = await getSession();
      setError(null);
      setSession(result);
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

    void getSession()
      .then((result) => {
        if (active) {
          setSession(result);
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
          <span>Configuración</span>
          <h1>Tu cuenta</h1>
          <p>Información básica de acceso al panel del estudio.</p>
        </div>
      </header>

      {error && (
        <DashboardError
          message={error}
          retry={() => {
            setError(null);
            void loadSession();
          }}
        />
      )}
      {!error && !session && <DashboardLoading label="Cargando tu cuenta…" />}
      {session && (
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>Cuenta del tatuador</h2>
          </div>
          <div className={styles.settingsList}>
            <div className={styles.settingsRow}>
              <span>Correo electrónico</span>
              <strong>{session.user.email}</strong>
            </div>
            <div className={styles.settingsRow}>
              <span>Tipo de cuenta</span>
              <strong>Tatuador</strong>
            </div>
            <div className={styles.settingsRow}>
              <span>Mensajería</span>
              <strong>Modo prueba</strong>
            </div>
          </div>
          <p className={styles.securityNote}>
            Tu sesión se guarda en una cookie protegida. Tatto Flow nunca muestra ni devuelve tu
            contraseña.
          </p>
        </section>
      )}
    </>
  );
}
