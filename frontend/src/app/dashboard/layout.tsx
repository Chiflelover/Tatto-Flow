import type { Metadata } from 'next';
import Link from 'next/link';
import { DashboardNav } from '@/components/dashboard/dashboard-nav';
import { LogoutButton } from '@/components/dashboard/logout-button';
import { ThemeToggle } from '@/components/theme-toggle';
import styles from '@/styles/dashboard.module.css';

export const metadata: Metadata = {
  title: 'Dashboard | Tatuoflow',
  description: 'Pedidos y precios de Tatuoflow',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.dashboardLayout}>
      <aside className={styles.sidebar}>
        <Link href="/dashboard" className={styles.brand}>
          <span aria-hidden="true">TF</span>
          <div>
            <strong>Tatuoflow</strong>
            <small>Panel del tatuador</small>
          </div>
        </Link>
        <DashboardNav />
        <LogoutButton />
      </aside>

      <header className={styles.mobileHeader}>
        <Link href="/dashboard" className={styles.brand}>
          <span aria-hidden="true">TF</span>
          <div>
            <strong>Tatuoflow</strong>
            <small>Panel del tatuador</small>
          </div>
        </Link>
        <div className={styles.mobileHeaderActions}>
          <ThemeToggle compact />
          <LogoutButton compact />
        </div>
      </header>

      <div className={styles.desktopThemeControl}>
        <ThemeToggle />
      </div>
      <main className={styles.dashboardContent}>{children}</main>
      <DashboardNav mobile />
    </div>
  );
}
