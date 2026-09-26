'use client';

import styles from './theme-toggle.module.css';

const THEME_STORAGE_KEY = 'tatuoflow-theme';

type ThemeToggleProps = {
  className?: string;
  compact?: boolean;
};

export function ThemeToggle({ className, compact = false }: ThemeToggleProps) {
  function toggleTheme(): void {
    const currentTheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';

    document.documentElement.dataset.theme = nextTheme;

    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // The selected theme still applies for the current page when storage is unavailable.
    }
  }

  return (
    <button
      type="button"
      className={`${styles.toggle} ${compact ? styles.compact : ''} ${className ?? ''}`}
      onClick={toggleTheme}
      title="Cambiar entre tema oscuro y claro"
    >
      <span className={styles.accessiblePrefix}>Cambiar tema. Tema actual: </span>
      <span className={styles.darkState}>
        <span className={styles.icon} aria-hidden="true">
          ☾
        </span>
        <span className={styles.label}>Oscuro</span>
      </span>
      <span className={styles.lightState}>
        <span className={styles.icon} aria-hidden="true">
          ☀
        </span>
        <span className={styles.label}>Claro</span>
      </span>
    </button>
  );
}
