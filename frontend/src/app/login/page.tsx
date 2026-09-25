import type { Metadata } from 'next';
import Link from 'next/link';
import { LoginForm } from './login-form';
import styles from './login.module.css';

export const metadata: Metadata = {
  title: 'Ingresar | Tatuoflow',
};

export default function LoginPage() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.logo} aria-hidden="true">
          TF
        </div>
        <div className={styles.heading}>
          <span>Panel privado</span>
          <h1>Bienvenido a Tatuoflow</h1>
          <p>Ingresa con la cuenta del estudio para revisar tus pedidos.</p>
        </div>
        <LoginForm />
        <footer className={styles.footer}>
          <Link href="/privacy">Política de privacidad</Link>
        </footer>
      </section>
    </main>
  );
}
