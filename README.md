# Tatto Flow

Sistema de cotizaciones para estudios de tatuajes. Incluye una API NestJS con Prisma/PostgreSQL, referencias privadas en Supabase Storage, el flujo conversacional de Nita y un dashboard privado mobile-first construido con Next.js.

OpenAI permanece en modo mock. La recepción y respuesta de Nita puede conectarse a WhatsApp Cloud API mediante el webhook firmado del backend.

## Requisitos

- Node.js 20.9 o superior
- npm 10 o superior
- PostgreSQL accesible mediante `DATABASE_URL`
- Un bucket privado de Supabase Storage llamado `tattoo-references`

## Instalación

```powershell
cd C:\Users\USER\Desktop\gpt-projects\tatto-flow\backend
npm install
Copy-Item .env.example .env
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:seed
```

```powershell
cd C:\Users\USER\Desktop\gpt-projects\tatto-flow\frontend
npm install
Copy-Item .env.example .env.local
```

Configura las variables reales únicamente en los archivos locales `.env` y `.env.local`. No deben subirse al repositorio.

Para utilizar Supabase Storage, configura solo en `backend/.env` las variables `STORAGE_MODE=supabase`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` y `SUPABASE_STORAGE_BUCKET=tattoo-references`. La clave privada nunca debe llevar el prefijo `NEXT_PUBLIC_` ni copiarse al frontend.

Supabase es el modo predeterminado. `STORAGE_MODE=memory` existe únicamente para pruebas aisladas y no debe usarse como almacenamiento principal.

Para WhatsApp Cloud API configura en `backend/.env` las variables `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET` y `WHATSAPP_GRAPH_API_VERSION`. Registra en Meta el callback público HTTPS que apunte a `/api/whatsapp/webhook`; el mismo endpoint atiende la verificación GET y los eventos POST firmados. Antes de levantar esta integración aplica las migraciones para crear el registro persistente de IDs de mensajes entrantes.

Las referencias se validan y suben a `leads/{leadId}/{uuid}.{ext}` con sobrescritura desactivada. PostgreSQL conserva únicamente `storagePath` y las fechas de retención. El dashboard obtiene una URL firmada de cinco minutos mediante un endpoint autenticado; un trabajo diario elimina el objeto al cumplir 15 días y marca `deletedAt` sin borrar el Lead, su análisis ni su precio.

## Usuario tatuador inicial

No existe registro público. Para crear o actualizar el único usuario de desarrollo, define en `backend/.env`:

```env
TATTOO_ARTIST_EMAIL=tatuador@example.com
TATTOO_ARTIST_PASSWORD=clave-123-desarrollo
```

La contraseña debe contener entre 9 y 20 caracteres.

Después ejecuta:

```powershell
cd C:\Users\USER\Desktop\gpt-projects\tatto-flow\backend
npm run user:create
```

La contraseña se transforma en un hash `scrypt` con sal aleatoria antes de guardarse.

## Desarrollo

Backend:

```powershell
cd C:\Users\USER\Desktop\gpt-projects\tatto-flow\backend
npm run start:dev
```

Frontend:

```powershell
cd C:\Users\USER\Desktop\gpt-projects\tatto-flow\frontend
npm run dev
```

Abre `http://localhost:3000/login`. La ruta raíz redirige al acceso del tatuador; Nita atiende únicamente mediante WhatsApp.

## Dashboard

- `/login`: acceso privado por correo y contraseña.
- `/dashboard`: métricas simples y pedidos recientes.
- `/dashboard/leads`: listado y filtros de pedidos completos.
- `/dashboard/leads/[id]`: datos, análisis, revisión humana y acciones.
- `/dashboard/pricing`: matriz editable de las nueve reglas de precios.
- `/dashboard/settings`: cuenta y estado de las integraciones.

La sesión usa una cookie `httpOnly`; PostgreSQL conserva solo el hash del token. Los endpoints del dashboard validan la sesión en NestJS.

Los cambios de precios se guardan en una única transacción. Solo cambian los importes de las reglas modificadas, cada versión aumenta automáticamente y `PricingRuleHistory` conserva el valor anterior, el nuevo y el usuario responsable. Los precios ya copiados a un pedido no se recalculan.

## Calidad

Backend:

```powershell
npm run prisma:validate
npm run prisma:generate
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

Frontend:

```powershell
npm run lint
npm run typecheck
npm run build
```

## Estructura

```text
tatto-flow/
├── backend/
│   ├── prisma/
│   ├── src/modules/auth/
│   ├── src/modules/chatbot/
│   ├── src/modules/dashboard/
│   ├── src/modules/image-analysis/
│   ├── src/modules/storage/
│   └── test/
├── frontend/
│   ├── src/app/login/
│   ├── src/app/dashboard/
│   ├── src/components/dashboard/
│   └── src/lib/
└── README.md
```
