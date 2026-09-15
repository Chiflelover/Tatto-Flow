import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './privacy.module.css';

export const metadata: Metadata = {
  title: 'Política de privacidad | Tatto Flow',
  description: 'Conoce cómo Tatto Flow recopila, utiliza y conserva tus datos personales.',
};

const privacyContactEmail = process.env.PRIVACY_CONTACT_EMAIL?.trim();

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <article className={styles.policy}>
        <header className={styles.header}>
          <Link className={styles.brand} href="/login" aria-label="Ir al inicio de sesión">
            <span aria-hidden="true">TF</span>
            Tatto Flow
          </Link>
          <p className={styles.eyebrow}>Información para clientes</p>
          <h1>Política de privacidad</h1>
          <p className={styles.updated}>Última actualización: 15 de septiembre de 2026</p>
          <p className={styles.intro}>
            Esta política explica, de forma sencilla, qué datos utiliza Tatto Flow cuando solicitas
            una cotización de tatuaje mediante WhatsApp.
          </p>
        </header>

        <section>
          <h2>Datos que recopilamos</h2>
          <p>Para atender tu solicitud, Tatto Flow recopila:</p>
          <ul>
            <li>Tu número de WhatsApp.</li>
            <li>
              Las respuestas de la cotización: tamaño del tatuaje, nivel de detalle y zona corporal.
            </li>
            <li>La imagen de referencia que envías voluntariamente.</li>
          </ul>
        </section>

        <section>
          <h2>Para qué usamos tus datos</h2>
          <p>
            Utilizamos estos datos únicamente para recibir, analizar y gestionar tu solicitud, preparar
            una cotización aproximada y permitir que el tatuador continúe la atención.
          </p>
        </section>

        <section>
          <h2>Conservación de datos</h2>
          <p>
            Las imágenes de referencia se conservan durante un máximo de 15 días y después se eliminan
            automáticamente. Los demás datos de la cotización pueden permanecer almacenados para la
            gestión del pedido y el historial del tatuador.
          </p>
        </section>

        <section>
          <h2>Proveedores tecnológicos</h2>
          <p>
            Tatto Flow utiliza proveedores tecnológicos necesarios para operar el servicio, entre ellos
            Meta/WhatsApp para la mensajería, Vercel para alojar la aplicación y Supabase para la base de
            datos y el almacenamiento temporal de imágenes.
          </p>
        </section>

        <section>
          <h2>No vendemos tus datos</h2>
          <p>
            Tatto Flow no vende tus datos personales. Solo los utiliza y comparte con los proveedores
            necesarios para prestar el servicio descrito en esta política.
          </p>
        </section>

        <section>
          <h2>Contacto sobre privacidad</h2>
          <p>
            Puedes solicitar información, corrección o eliminación de tus datos escribiendo al siguiente
            correo:
          </p>
          {privacyContactEmail ? (
            <a className={styles.contact} href={`mailto:${privacyContactEmail}`}>
              {privacyContactEmail}
            </a>
          ) : (
            <p className={styles.missingContact}>
              Contacto pendiente: configura el correo real en la variable{' '}
              <code>PRIVACY_CONTACT_EMAIL</code>.
            </p>
          )}
        </section>

        <footer className={styles.footer}>
          <Link href="/login">Volver al inicio de sesión</Link>
        </footer>
      </article>
    </main>
  );
}
