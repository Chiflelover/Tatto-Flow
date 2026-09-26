import type { Metadata } from 'next';
import './globals.css';

const themeInitializationScript = `(function(){try{var t=localStorage.getItem("tatuoflow-theme");document.documentElement.setAttribute("data-theme",t==="light"?"light":"dark")}catch(e){document.documentElement.setAttribute("data-theme","dark")}})()`;

export const metadata: Metadata = {
  title: 'Tatuoflow',
  description: 'Gestión simple de pedidos y cotizaciones para el estudio',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="es" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitializationScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
