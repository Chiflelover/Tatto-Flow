'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { logout } from '@/lib/dashboard-api';
import styles from '@/styles/dashboard.module.css';

export function LogoutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout(): Promise<void> {
    if (pending) {
      return;
    }

    setPending(true);

    try {
      await logout();
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <button
      className={compact ? styles.logoutCompact : styles.logoutButton}
      type="button"
      onClick={() => void handleLogout()}
      disabled={pending}
    >
      {pending ? 'Saliendo…' : 'Cerrar sesión'}
    </button>
  );
}
