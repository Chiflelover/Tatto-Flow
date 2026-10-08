'use client';

import { useEffect, useState, type FormEvent } from 'react';

import {
  createArtistAccount,
  dashboardErrorMessage,
  listArtistAccounts,
  updateArtistAccount,
  type ArtistAccountView,
} from '@/lib/dashboard-api';
import { AdminIcon } from './admin-shell';
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

  const activeCount = accounts.filter((account) => account.isActive).length;
  const summaries = [
    {
      label: 'Total de cuentas',
      value: accounts.length,
      detail: 'Tatuadores registrados',
      icon: 'accounts' as const,
      tone: styles.navy,
    },
    {
      label: 'Cuentas activas',
      value: activeCount,
      detail: 'Acceso habilitado',
      icon: 'active' as const,
      tone: styles.green,
    },
    {
      label: 'Cuentas inactivas',
      value: accounts.length - activeCount,
      detail: 'Acceso deshabilitado',
      icon: 'inactive' as const,
      tone: styles.red,
    },
    {
      label: 'Números de Nita',
      value: accounts.filter((account) => account.phoneNumber && account.phoneNumberId).length,
      detail: 'Números configurados',
      icon: 'channel' as const,
      tone: styles.blue,
    },
  ];

  return (
    <>
      <section className={styles.summaryGrid} aria-label="Resumen de cuentas" aria-busy={loading}>
        {summaries.map((summary) => (
          <article className={`${styles.summaryCard} ${summary.tone}`} key={summary.label}>
            <div className={styles.summaryIcon}>
              <AdminIcon name={summary.icon} />
            </div>
            <div className={styles.summaryMetric}>
              <h2>{summary.label}</h2>
              <strong>{loading ? '—' : summary.value}</strong>
            </div>
            <p>{summary.detail}</p>
          </article>
        ))}
      </section>
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
        <section className={styles.panel} aria-label="Cuentas" aria-busy={loading}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Cuentas de tatuadores</h2>
              <p>Accesos y configuración de WhatsApp.</p>
            </div>
            <button className={styles.primary} onClick={startCreate} type="button">
              <AdminIcon name="plus" />
              Crear cuenta
            </button>
          </div>
          {loading ? (
            <div className={styles.emptyState} role="status">
              Cargando cuentas…
            </div>
          ) : accounts.length === 0 ? (
            <div className={styles.emptyState}>
              <AdminIcon name="accounts" />
              <strong>Aún no hay cuentas.</strong>
              <p>Completa el formulario para crear la primera.</p>
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <caption className={styles.visuallyHidden}>
                  Cuentas de tatuadores y acciones disponibles
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Cuenta</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Alta</th>
                    <th scope="col">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <tr
                      key={account.id}
                      className={selectedId === account.id ? styles.selectedRow : undefined}
                    >
                      <td className={styles.accountCell}>
                        <div className={styles.accountIdentity}>
                          <span className={styles.accountAvatar}>
                            <AdminIcon name="accounts" />
                          </span>
                          <div>
                            <strong>{account.name}</strong>
                            <small>{account.email ?? 'Correo no registrado'}</small>
                          </div>
                        </div>
                        <span className={styles.accountPhone}>
                          <AdminIcon name="channel" />
                          {account.phoneNumber ?? 'Número pendiente'}
                        </span>
                        {account.contactUrl && (
                          <a
                            className={styles.contactLink}
                            href={account.contactUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {account.contactUrl}
                          </a>
                        )}
                      </td>
                      <td>
                        <span className={styles.mobileLabel}>Estado</span>
                        <span
                          className={`${styles.statusBadge} ${account.isActive ? styles.statusActive : styles.statusInactive}`}
                        >
                          {account.isActive ? 'Activa' : 'Inactiva'}
                        </span>
                      </td>
                      <td className={styles.dateCell}>
                        <span className={styles.mobileLabel}>Alta</span>
                        <time dateTime={account.createdAt}>
                          {new Date(account.createdAt).toLocaleDateString('es-PE')}
                        </time>
                      </td>
                      <td className={styles.actionsCell}>
                        <div className={styles.actions}>
                          {account.contactUrl && (
                            <button type="button" onClick={() => void copyUrl(account.contactUrl!)}>
                              Copiar URL
                            </button>
                          )}
                          <button
                            className={styles.editButton}
                            type="button"
                            onClick={() => select(account)}
                          >
                            Ver / editar
                          </button>
                          <button
                            className={account.isActive ? styles.deactivateButton : undefined}
                            type="button"
                            disabled={pending}
                            onClick={() => void toggle(account)}
                          >
                            {account.isActive ? 'Desactivar' : 'Activar'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className={styles.tableFooter}>
                {accounts.length}{' '}
                {accounts.length === 1 ? 'cuenta registrada' : 'cuentas registradas'}
              </p>
            </div>
          )}
        </section>
        <section
          className={`${styles.panel} ${styles.formPanel}`}
          aria-label={selectedId ? 'Editar cuenta' : 'Crear cuenta'}
        >
          <div className={styles.formHeader}>
            <h2>{selectedId ? 'Editar cuenta' : 'Crear cuenta'}</h2>
            <p>
              {selectedId
                ? 'Actualiza los datos de la cuenta seleccionada.'
                : 'Configura el acceso de un nuevo tatuador.'}
            </p>
          </div>
          <form onSubmit={(e) => void save(e)} className={styles.form} aria-busy={pending}>
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
              ID del número de WhatsApp
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
              />
              Cuenta activa
            </label>
            <button className={styles.primary} type="submit" disabled={pending} aria-busy={pending}>
              {pending ? 'Guardando…' : selectedId ? 'Guardar cambios' : 'Crear cuenta'}
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
