'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { LogoutButton } from '@/components/dashboard/logout-button';
import {
  createArtistAccount,
  dashboardErrorMessage,
  listArtistAccounts,
  updateArtistAccount,
  type ArtistAccountView,
} from '@/lib/dashboard-api';
import styles from './admin.module.css';

const emptyForm = {
  name: '',
  email: '',
  password: '',
  phoneNumber: '',
  phoneNumberId: '',
  isActive: true,
};

export default function AdminPage() {
  const [accounts, setAccounts] = useState<ArtistAccountView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void listArtistAccounts()
      .then(setAccounts)
      .catch((e: unknown) => setError(dashboardErrorMessage(e)))
      .finally(() => setLoading(false));
  }, []);

  function select(account: ArtistAccountView) {
    setSelectedId(account.id);
    setForm({
      name: account.name,
      email: account.email ?? '',
      password: '',
      phoneNumber: account.phoneNumber ?? '',
      phoneNumberId: account.phoneNumberId ?? '',
      isActive: account.isActive,
    });
    setError(null);
    setNotice(null);
  }

  function startCreate() {
    setSelectedId(null);
    setForm(emptyForm);
    setError(null);
    setNotice(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const updated = selectedId
        ? await updateArtistAccount(selectedId, {
            name: form.name,
            phoneNumber: form.phoneNumber,
            phoneNumberId: form.phoneNumberId,
            isActive: form.isActive,
            ...(form.password ? { password: form.password } : {}),
          })
        : await createArtistAccount(form);
      setAccounts((current) =>
        selectedId
          ? current.map((item) => (item.id === updated.id ? updated : item))
          : [updated, ...current],
      );
      select(updated);
      setNotice(selectedId ? 'Cuenta actualizada.' : 'Cuenta creada.');
    } catch (e) {
      setError(dashboardErrorMessage(e));
    } finally {
      setPending(false);
    }
  }

  async function toggle(account: ArtistAccountView) {
    setPending(true);
    setError(null);
    try {
      const updated = await updateArtistAccount(account.id, { isActive: !account.isActive });
      setAccounts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      if (selectedId === updated.id) select(updated);
    } catch (e) {
      setError(dashboardErrorMessage(e));
    } finally {
      setPending(false);
    }
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setNotice('URL copiada.');
    } catch {
      setError('No se pudo copiar la URL.');
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Tatuo Flow</p>
          <h1>Administración de tatuadores</h1>
        </div>
        <LogoutButton />
      </header>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      <div className={styles.grid}>
        <section className={styles.panel} aria-label="Cuentas">
          <div className={styles.sectionHeader}>
            <h2>Cuentas</h2>
            <button onClick={startCreate} type="button">
              Crear cuenta
            </button>
          </div>
          {loading ? (
            <p>Cargando…</p>
          ) : accounts.length === 0 ? (
            <p>Aún no hay cuentas.</p>
          ) : (
            <ul className={styles.list}>
              {accounts.map((account) => (
                <li key={account.id} className={styles.item}>
                  <div>
                    <strong>{account.name}</strong>{' '}
                    <span>{account.isActive ? 'Activa' : 'Inactiva'}</span>
                    <small>
                      {account.phoneNumber ?? 'Número pendiente'} ·{' '}
                      {new Date(account.createdAt).toLocaleDateString('es-PE')}
                    </small>
                    {account.contactUrl && (
                      <a href={account.contactUrl} target="_blank" rel="noreferrer">
                        {account.contactUrl}
                      </a>
                    )}
                  </div>
                  <div className={styles.actions}>
                    {account.contactUrl && (
                      <button type="button" onClick={() => void copyUrl(account.contactUrl!)}>
                        Copiar URL
                      </button>
                    )}
                    <button type="button" onClick={() => select(account)}>
                      Ver / editar
                    </button>
                    <button type="button" disabled={pending} onClick={() => void toggle(account)}>
                      {account.isActive ? 'Desactivar' : 'Activar'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section
          className={styles.panel}
          aria-label={selectedId ? 'Editar cuenta' : 'Crear cuenta'}
        >
          <h2>{selectedId ? 'Editar cuenta' : 'Crear cuenta'}</h2>
          <form onSubmit={(e) => void save(e)} className={styles.form}>
            <label>
              Nombre
              <input
                required
                maxLength={120}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              Correo de acceso
              <input
                type="email"
                required
                disabled={selectedId !== null}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
            <label>
              {selectedId ? 'Nueva contraseña (opcional)' : 'Contraseña inicial'}
              <input
                type="password"
                required={!selectedId}
                minLength={9}
                maxLength={20}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </label>
            <label>
              Número de Nita
              <input
                type="tel"
                required
                value={form.phoneNumber}
                onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
                placeholder="+51 999 888 777"
              />
            </label>
            <label>
              phone_number_id
              <input
                required
                inputMode="numeric"
                value={form.phoneNumberId}
                onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })}
              />
            </label>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />{' '}
              Cuenta activa
            </label>
            <button className={styles.primary} type="submit" disabled={pending}>
              {pending ? 'Guardando…' : selectedId ? 'Guardar cambios' : 'Crear cuenta'}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
