'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { LogoutButton } from '@/components/dashboard/logout-button';
import { ThemeToggle } from '@/components/theme-toggle';
import styles from './admin.module.css';

export function AdminIcon({
  name,
}: {
  name: 'accounts' | 'images' | 'active' | 'inactive' | 'channel' | 'plus';
}) {
  const paths = {
    accounts: 'M4 21V7h10v14M14 11h6v10M8 11h2M8 15h2M8 19h2M17 15h1M17 18h1M2 21h20M8 7V3h6v4',
    images: 'M4 4h16v16H4zM4 16l5-5 4 4 3-3 4 4M15 8h.01',
    active: 'M20 11a8 8 0 1 1-4-7M8 11l3 3 9-9',
    inactive: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M8 8l8 8M16 8l-8 8',
    channel: 'M5 3h14v18H5zM9 6h6M11 18h2',
    plus: 'M12 5v14M5 12h14',
  };
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const imagesSection = usePathname().startsWith('/admin/images');

  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#admin-content">
        Ir al contenido
      </a>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/admin" aria-label="Tatuo Flow · Administración">
          <span className={styles.brandMark}>TF</span>
          <span>
            <strong>Tatuo Flow</strong>
            <small>Administración</small>
          </span>
        </Link>
        <nav className={styles.navigation} aria-label="Navegación de administración">
          <Link
            className={!imagesSection ? styles.activeLink : undefined}
            href="/admin"
            aria-current={!imagesSection ? 'page' : undefined}
          >
            <AdminIcon name="accounts" />
            Cuentas
          </Link>
          <Link
            className={imagesSection ? styles.activeLink : undefined}
            href="/admin/images"
            aria-current={imagesSection ? 'page' : undefined}
          >
            <AdminIcon name="images" />
            Imágenes de clientes
          </Link>
        </nav>
        <div className={styles.sidebarFooter}>
          <span>Panel ADMIN</span>
          <small>Gestión de tatuadores</small>
        </div>
      </aside>
      <main className={styles.workspace} id="admin-content">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>
              Administración / {imagesSection ? 'Imágenes' : 'Cuentas'}
            </p>
            <h1>{imagesSection ? 'Imágenes de clientes' : 'Administración de tatuadores'}</h1>
            <p className={styles.subtitle}>
              {imagesSection
                ? 'Referencias enviadas por clientes de todas las cuentas.'
                : 'Gestiona las cuentas, sus accesos y los números de Nita.'}
            </p>
          </div>
          <div className={styles.headerActions}>
            <ThemeToggle compact className={styles.themeToggle} />
            <LogoutButton />
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
