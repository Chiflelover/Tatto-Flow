'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from '@/styles/dashboard.module.css';

const NAVIGATION = [
  { href: '/dashboard', label: 'Inicio', icon: '⌂', exact: true },
  { href: '/dashboard/leads', label: 'Pedidos', icon: '≡' },
  { href: '/dashboard/pricing', label: 'Precios', icon: 'S/' },
  { href: '/dashboard/settings', label: 'Configuración', icon: '⚙' },
];

export function DashboardNav({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      className={mobile ? styles.mobileNav : styles.desktopNav}
      aria-label="Navegación principal"
    >
      {NAVIGATION.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            className={`${styles.navLink} ${active ? styles.navLinkActive : ''}`}
            href={item.href}
            aria-current={active ? 'page' : undefined}
          >
            <span className={styles.navIcon} aria-hidden="true">
              {item.icon}
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
