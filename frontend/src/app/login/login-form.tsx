'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { dashboardErrorMessage, login } from '@/lib/dashboard-api';
import styles from './login.module.css';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (pending) {
      return;
    }

    setPending(true);
    setError(null);

    try {
      await login(email, password);
      setPassword('');
      router.replace('/dashboard');
      router.refresh();
    } catch (loginError) {
      setPassword('');
      setError(dashboardErrorMessage(loginError));
      setPending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
      <label>
        <span>Correo electrónico</span>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="tatuador@estudio.com"
          autoComplete="email"
          maxLength={320}
          required
          disabled={pending}
        />
      </label>
      <label>
        <span>Contraseña</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          minLength={9}
          maxLength={20}
          required
          disabled={pending}
        />
      </label>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending || !email || !password}>
        {pending ? 'Ingresando…' : 'Ingresar'}
      </button>
    </form>
  );
}
