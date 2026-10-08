'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  dashboardErrorMessage,
  deleteManagedImages,
  listArtistAccounts,
  listManagedImages,
  type ArtistAccountView,
  type ManagedImageView,
} from '@/lib/dashboard-api';
import styles from './images.module.css';

const emptyFilters = { accountId: '', from: '', to: '', phone: '' };

export default function AdminImagesPage() {
  const [accounts, setAccounts] = useState<ArtistAccountView[]>([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [images, setImages] = useState<ManagedImageView[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (query: typeof emptyFilters, targetPage: number) => {
    const result = await listManagedImages({ ...query, page: targetPage });
    setImages(result.images);
    setPage(result.page);
    setTotal(result.total);
    setTotalPages(result.totalPages);
    setSelected([]);
  }, []);

  useEffect(() => {
    void Promise.all([listArtistAccounts(), listManagedImages({ page: 1 })])
      .then(([artists, result]) => {
        setAccounts(artists);
        setImages(result.images);
        setTotal(result.total);
        setTotalPages(result.totalPages);
      })
      .catch((cause: unknown) => setError(dashboardErrorMessage(cause)));
  }, []);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await load(filters, 1);
      setApplied(filters);
    } catch (cause) {
      setError(dashboardErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function changePage(next: number) {
    setBusy(true);
    setError(null);
    try {
      await load(applied, next);
    } catch (cause) {
      setError(dashboardErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    if (
      !selected.length ||
      !window.confirm(`¿Eliminar ${selected.length} imagen(es) seleccionadas?`)
    )
      return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await deleteManagedImages(selected);
      const alreadyDeleted = result.results.filter((item) => item.status === 'already_deleted');
      const notFound = result.results.filter((item) => item.status === 'not_found');
      const retryRequired = result.results.filter((item) => item.status === 'retry_required');
      setNotice(`${result.deletedCount} eliminada(s); ${alreadyDeleted.length} ya eliminada(s).`);
      if (notFound.length || retryRequired.length)
        setError(
          `No encontradas: ${notFound.map((item) => item.id).join(', ') || 'ninguna'}. ` +
            `Requieren reintento: ${retryRequired.map((item) => item.id).join(', ') || 'ninguna'}.`,
        );
      try {
        await load(applied, page);
      } catch (cause) {
        setError(
          (current) =>
            `${current ? `${current} ` : ''}No se pudo actualizar la lista: ${dashboardErrorMessage(cause)}`,
        );
      }
    } catch (cause) {
      setError(dashboardErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  return (
    <section className={styles.page} aria-label="Gestión de imágenes">
      <form className={styles.filters} onSubmit={(event) => void search(event)} aria-busy={busy}>
        <label>
          Tatuador
          <select
            value={filters.accountId}
            onChange={(event) => setFilters({ ...filters, accountId: event.target.value })}
          >
            <option value="">Todas las cuentas</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Desde
          <input
            type="date"
            value={filters.from}
            onChange={(event) => setFilters({ ...filters, from: event.target.value })}
          />
        </label>
        <label>
          Hasta
          <input
            type="date"
            value={filters.to}
            onChange={(event) => setFilters({ ...filters, to: event.target.value })}
          />
        </label>
        <label>
          Teléfono del cliente
          <input
            type="search"
            inputMode="tel"
            value={filters.phone}
            onChange={(event) => setFilters({ ...filters, phone: event.target.value })}
          />
        </label>
        <button className={styles.filterButton} type="submit" disabled={busy}>
          Filtrar
        </button>
      </form>
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
      <div className={styles.toolbar}>
        <span>
          {total} {total === 1 ? 'imagen' : 'imágenes'}
        </span>
        <button
          type="button"
          disabled={busy || selected.length === 0}
          onClick={() => void removeSelected()}
        >
          Eliminar seleccionadas ({selected.length})
        </button>
      </div>
      <div className={styles.grid}>
        {images.map((image) => (
          <article
            className={`${styles.card} ${selected.includes(image.id) ? styles.selectedCard : ''}`}
            key={image.id}
          >
            <label className={styles.select}>
              <input
                type="checkbox"
                checked={selected.includes(image.id)}
                onChange={() => toggle(image.id)}
              />{' '}
              Seleccionar
            </label>
            <div className={styles.preview}>
              {image.previewUrl ? (
                // Short-lived signed URL from the authenticated backend.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image.previewUrl}
                  alt={`Referencia del cliente ${image.customerPhoneNumber}`}
                />
              ) : (
                'Vista previa no disponible'
              )}
            </div>
            <dl>
              <dt>Tatuador</dt>
              <dd>{image.accountName}</dd>
              <dt>Cliente</dt>
              <dd>{image.customerPhoneNumber}</dd>
              <dt>Lead</dt>
              <dd>{image.leadId}</dd>
              <dt>Subida</dt>
              <dd>{new Date(image.createdAt).toLocaleString('es-PE')}</dd>
            </dl>
          </article>
        ))}
      </div>
      {images.length === 0 && (
        <p className={styles.emptyState}>No hay imágenes para estos filtros.</p>
      )}
      <nav className={styles.pages} aria-label="Páginas de imágenes">
        <button
          type="button"
          disabled={busy || page <= 1}
          onClick={() => void changePage(page - 1)}
        >
          Anterior
        </button>
        <span>
          {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={busy || page >= totalPages}
          onClick={() => void changePage(page + 1)}
        >
          Siguiente
        </button>
      </nav>
    </section>
  );
}
