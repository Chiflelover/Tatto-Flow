import type { Metadata } from 'next';
import Link from 'next/link';
import { ThemeToggle } from '@/components/theme-toggle';
import styles from './privacy.module.css';

export const metadata: Metadata = {
  title: 'Política de privacidad | Tatuoflow',
  description: 'Conoce cómo Tatuoflow utiliza y protege la información de una cotización.',
};

const privacyContactEmail = process.env.PRIVACY_CONTACT_EMAIL?.trim();

const externalLinkProps = {
  target: '_blank',
  rel: 'noreferrer noopener',
} as const;

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <div className={styles.themeControl}>
        <ThemeToggle />
      </div>
      <article className={styles.policy}>
        <header className={styles.header}>
          <Link className={styles.brand} href="/login" aria-label="Ir al inicio de sesión">
            <span aria-hidden="true">TF</span>
            Tatuoflow
          </Link>
          <p className={styles.eyebrow}>Información para clientes</p>
          <h1>Política de privacidad</h1>
          <p className={styles.updated}>Última actualización: 25 de septiembre de 2026</p>
          <p className={styles.intro}>
            Cómo Tatuoflow utiliza y protege la información que compartes durante una cotización.
          </p>
        </header>

        <section>
          <h2>Qué información recopilamos</h2>
          <p>Cuando conversas con Nita por WhatsApp, Tatuoflow puede procesar:</p>
          <ul>
            <li>Tu número de WhatsApp y el identificador técnico de cada mensaje recibido.</li>
            <li>
              Los datos de la solicitud: tamaño, nivel de detalle y zona corporal del tatuaje.
            </li>
            <li>La imagen de referencia que envías voluntariamente.</li>
            <li>
              El resultado del análisis visual, incluidas estimaciones, niveles de confianza y
              observaciones sobre la calidad de la referencia.
            </li>
            <li>
              El estado y evaluación de la cotización, motivos de revisión, rango de precio y fechas
              relacionadas con su atención.
            </li>
            <li>
              Información técnica mínima para operar y proteger el servicio, como eventos,
              identificadores internos, duración de procesos y categorías de error.
            </li>
          </ul>
          <p className={styles.notice}>
            No envíes documentos de identidad, información financiera, contraseñas ni otros datos
            personales que no sean necesarios para la cotización.
          </p>
        </section>

        <section>
          <h2>Para qué utilizamos la información</h2>
          <p>La información se utiliza para:</p>
          <ul>
            <li>Recibir y gestionar tu solicitud de cotización.</li>
            <li>Analizar la imagen y determinar si necesita revisión del tatuador.</li>
            <li>Calcular un rango de precio mediante las reglas configuradas en el sistema.</li>
            <li>Permitir que el tatuador continúe personalmente la atención por WhatsApp.</li>
            <li>Prevenir duplicados, diagnosticar errores y mantener el servicio funcionando.</li>
          </ul>
          <p>
            La implementación actual no incorpora funciones destinadas a publicidad ni a vender la
            información personal utilizada en la cotización.
          </p>
        </section>

        <section>
          <h2>Imágenes de referencia y retención</h2>
          <p>
            Tatuoflow almacena temporalmente la imagen de referencia en un espacio privado de
            Supabase. El acceso desde el dashboard requiere autenticación y utiliza enlaces
            temporales; el archivo no se publica como una URL abierta permanente.
          </p>
          <p>
            Cada imagen recibe una fecha de expiración de 15 días. Un proceso automático diario
            busca las imágenes vencidas y elimina sus archivos. Por ello, el objetivo operativo de
            Tatuoflow es conservarlas durante un máximo de 15 días, aunque una falla temporal del
            proceso podría retrasar la eliminación hasta su siguiente ejecución correcta.
          </p>
          <p>
            Este plazo describe la copia administrada por Tatuoflow en Supabase. El tratamiento
            temporal realizado por los proveedores de inteligencia artificial se rige por sus
            propias condiciones y configuraciones, que Tatuoflow no controla por completo.
          </p>
          <p>
            Los demás datos de la cotización —como respuestas, análisis, evaluación, estado y
            precio— pueden conservarse para que el tatuador gestione la solicitud y mantenga su
            historial.
          </p>
        </section>

        <section>
          <h2>Procesamiento mediante inteligencia artificial</h2>
          <p>
            La imagen puede enviarse a servicios de inteligencia artificial para estimar
            características visuales útiles para la cotización, como tamaño aparente, nivel de
            detalle, posibilidad de análisis y niveles de confianza.
          </p>
          <p>
            Google Gemini es el proveedor principal. OpenAI se utiliza como respaldo técnico solo
            cuando Gemini no puede completar el análisis por un error elegible. La inteligencia
            artificial no decide directamente el precio ni el estado final de preparación: esas
            decisiones se aplican mediante reglas determinísticas de Tatuoflow.
          </p>

          <h3>Google Gemini</h3>
          <p>
            El tratamiento de Google depende del plan y de las condiciones vigentes de Gemini API.
            Determinadas modalidades gratuitas pueden permitir a Google utilizar el contenido para
            mejorar sus productos, mientras que los servicios pagados establecen condiciones
            diferentes. El repositorio no permite comprobar qué modalidad está activa en la cuenta
            utilizada por Tatuoflow.
          </p>
          <a
            className={styles.externalLink}
            href="https://ai.google.dev/gemini-api/terms?hl=es-419"
            {...externalLinkProps}
          >
            Consultar las condiciones oficiales de Gemini API
          </a>

          <h3>OpenAI</h3>
          <p>
            Tatuoflow usa la API de OpenAI únicamente como respaldo técnico. La solicitud actual
            utiliza <code>store: false</code>, por lo que no solicita conservar el objeto Response
            como estado de la aplicación. Aun así, esto no significa retención cero: OpenAI indica
            que los datos de API no se usan para entrenar sus modelos por defecto, salvo
            participación voluntaria, y que pueden existir registros temporales para monitoreo de
            abuso u otras excepciones según la configuración y el servicio utilizado.
          </p>
          <a
            className={styles.externalLink}
            href="https://developers.openai.com/es-419/api/docs/guides/your-data"
            {...externalLinkProps}
          >
            Consultar los controles de datos de OpenAI API
          </a>
        </section>

        <section>
          <h2>Proveedores tecnológicos</h2>
          <p>Para prestar el servicio intervienen los siguientes proveedores:</p>
          <ul className={styles.providerList}>
            <li>
              <strong>Meta / WhatsApp Business Platform:</strong> recibe y transporta los mensajes y
              archivos antes de que lleguen a Tatuoflow. Su tratamiento se rige también por la{' '}
              <a
                href="https://www.whatsapp.com/legal/privacy-policy?lang=es"
                {...externalLinkProps}
              >
                política de privacidad de WhatsApp
              </a>
              . Tatuoflow no controla la retención interna de Meta.
            </li>
            <li>
              <strong>Supabase:</strong> proporciona la base de datos y el almacenamiento privado
              utilizado por la aplicación. Consulta su{' '}
              <a href="https://supabase.com/privacy" {...externalLinkProps}>
                política de privacidad
              </a>
              .
            </li>
            <li>
              <strong>Vercel:</strong> aloja y ejecuta la aplicación, por lo que procesa las
              solicitudes técnicas necesarias para prestar el servicio. Consulta su{' '}
              <a href="https://vercel.com/legal/privacy-notice" {...externalLinkProps}>
                aviso de privacidad
              </a>
              .
            </li>
            <li>
              <strong>Google Gemini y OpenAI:</strong> procesan temporalmente la imagen cuando se
              requiere el análisis visual descrito anteriormente.
            </li>
          </ul>
        </section>

        <section>
          <h2>Medidas de seguridad</h2>
          <p>
            Tatuoflow utiliza almacenamiento privado para las imágenes, enlaces temporales para
            visualizarlas, acceso autenticado al dashboard, secretos mantenidos fuera del frontend,
            registros técnicos sanitizados y eliminación programada de imágenes vencidas. Estas
            medidas reducen riesgos, pero ningún sistema puede garantizar seguridad absoluta.
          </p>
        </section>

        <section>
          <h2>Contacto y solicitudes sobre tus datos</h2>
          <p>
            Puedes consultar qué datos gestiona Tatuoflow o solicitar, según corresponda, su
            corrección o eliminación. Algunas solicitudes pueden estar sujetas a verificaciones,
            obligaciones aplicables o períodos de tratamiento propios de proveedores externos.
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
