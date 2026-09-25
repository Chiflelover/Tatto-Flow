import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tatuoflow',
  description: 'Gestión simple de pedidos y cotizaciones para el estudio',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
