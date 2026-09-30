# Tatuoflow

Tatuoflow es un MVP para gestionar solicitudes y cotizaciones de tatuajes recibidas por WhatsApp. Nita recopila la información del cliente, almacena temporalmente la imagen de referencia, solicita un análisis visual y prepara el lead para que el tatuador lo atienda desde un dashboard privado.

La IA aporta observaciones sobre la referencia, pero no decide el precio ni el estado final por sí sola. El backend aplica reglas explicables de scoring, gates de seguridad y una matriz determinística de precios.

## Estado actual del MVP

El proyecto incluye:

- recepción y respuesta mediante WhatsApp Cloud API;
- flujo conversacional de Nita exclusivo de WhatsApp;
- análisis visual con Gemini como proveedor principal y OpenAI como fallback técnico opcional;
- scoring explicable y versionado con estados `LISTO`, `REVISAR` e `INCOMPLETO`;
- precios determinísticos calculados únicamente en el backend;
- revisión y envío manual de precio cuando el análisis requiere intervención;
- dashboard privado para gestionar leads y reglas de precios;
- almacenamiento privado de referencias en Supabase Storage;
- autenticación del tatuador y sesiones persistentes;
- administración global de cuentas de tatuador y números de Nita separados;
- despliegue conjunto de frontend y backend mediante Vercel Services;
- política de privacidad pública en `/privacy`.

No existe un chat web para Nita. El canal de atención automatizada es WhatsApp.

## Arquitectura

| Capa         | Tecnología               | Responsabilidad                                                        |
| ------------ | ------------------------ | ---------------------------------------------------------------------- |
| Frontend     | Next.js + TypeScript     | Login y dashboard responsive/mobile-first del tatuador                 |
| Backend      | NestJS + TypeScript      | Webhook, reglas de negocio, autenticación, scoring y precios           |
| Persistencia | PostgreSQL + Prisma 7    | Clientes, conversaciones, leads, evaluaciones, precios y sesiones      |
| Archivos     | Supabase Storage privado | Imágenes de referencia con acceso mediante URLs firmadas               |
| IA visual    | Gemini + OpenAI          | Gemini principal y OpenAI como fallback ante fallos técnicos elegibles |
| Mensajería   | WhatsApp Cloud API       | Entrada de texto, botones e imágenes; salida de texto y botones        |
| Reglas       | `json-rules-engine`      | Evaluación explicable y versionada de la preparación del lead          |
| Despliegue   | Vercel Services          | Next.js y NestJS dentro de un único proyecto                           |

Flujo principal:

```text
WhatsApp Cloud API
        ↓
Webhook firmado + resolución del número receptor + idempotencia por message ID
        ↓
WhatsAppAdapter
        ↓
ChatbotService / ConversationService
        ↓
Supabase Storage privado
        ↓
Gemini ──fallo técnico elegible──> OpenAI
        ↓
LeadScoringService
        ↓
PricingService o revisión humana
        ↓
Dashboard + entrega al tatuador
```

## Flujo de WhatsApp

El endpoint público es `/api/whatsapp/webhook`:

- `GET` valida la suscripción de Meta con `WHATSAPP_VERIFY_TOKEN`;
- `POST` valida `X-Hub-Signature-256` con `META_APP_SECRET`;
- los IDs de mensajes entrantes se registran para evitar reprocesamientos;
- el adapter convierte texto, `button_reply`, `list_reply` e imágenes a entradas del dominio sin contener lógica de estados;
- las respuestas estructuradas del chatbot se convierten en texto o botones interactivos de WhatsApp.

Cada `phone_number_id` registrado en el panel ADMIN identifica una cuenta de tatuador. Los clientes se distinguen por cuenta y teléfono; un mismo remitente puede escribir a dos números de Nita sin mezclar conversaciones. Los canales registrados usan las credenciales de la misma integración de Meta configurada en el backend.

La fase 1 mantiene el flujo de preguntas y precios v0.1. Todas las conversaciones existentes y nuevas usan `flowVersion=V1`; `V2` todavía no está activo.

Nita solicita, en orden:

1. tamaño mediante botones con IDs estables;
2. nivel de detalle mediante botones con IDs estables;
3. zona corporal como texto libre de 1 a 10 caracteres;
4. una imagen de referencia JPEG, PNG o WEBP de hasta 5 MB.

La conversación incompleta se conserva durante dos horas de actividad efectiva. Al completarse el procesamiento, la conversación pasa a `COMPLETED` y `HANDOFF_TO_TATTOO_ARTIST`; Nita deja de responder automáticamente mientras el lead siga en atención.

El horario normal se evalúa siempre en `America/Lima`: desde las 06:00 inclusive hasta las 22:00 exclusivo. El tiempo fuera de horario no hace expirar el progreso de una conversación.

`BUSINESS_HOURS_TEST_PHONE` es una variable opcional y temporal de testing. Si contiene un número y coincide exactamente con el remitente, solo omite la restricción horaria para ese número. Vacía o ausente, no cambia el comportamiento normal. No debe hardcodearse ningún teléfono en el código.

## Análisis de imágenes

Gemini es el proveedor principal. Ante un fallo técnico elegible, el backend puede realizar un único intento con OpenAI si `AI_FALLBACK_PROVIDER=openai` y sus credenciales están configuradas. Una respuesta válida con baja confianza o discrepancias no activa el fallback.

Ambos proveedores mantienen el contrato V1 para las conversaciones actuales: tamaño y detalle detectados, confidencias, presencia del tatuaje sobre piel, analizabilidad y ambigüedad. La IA no calcula el score, no clasifica el lead y no calcula precios.

La fase 3 agrega el contrato visual V2, independiente de las respuestas del cliente: estilo del catálogo activo o `null`, dimensión y área compositiva de referencia o `null`, cobertura cromática o `null`, cinco confidencias y observaciones de referencia esencialmente negra y cobertura corporal extensa. Las medidas requieren escala suficiente. No hay decisiones comerciales V2 en esta fase.

El contrato `VISION_V2_2` (prompt 2) identifica el origen de escala: `EXPLICIT_REFERENCE`, `BODY_CONTEXT` o `NONE`. La anatomía es una referencia aproximada, no una escala física validada. `scaleConfidence` solo expresa confianza en la conversión a medidas físicas. Con `NONE`, el backend normaliza obligatoriamente dimensión y área a `null`, conservando la respuesta original del proveedor. No se aplica un umbral adicional ni se decide todavía si una estimación anatómica puede cotizarse.

`ImageAnalysisV2Service.analyzeReference` es una entrada interna para pruebas controladas; no persiste ni envía mensajes. `analyzeAndPersistLeadReference` exige un lead de la cuenta indicada con conversación V2 y conserva cualquier análisis histórico V1. No existe un endpoint público V2 y las conversaciones nuevas siguen siendo V1.

Los análisis V2 conservan `analysisVersion`, proveedor/modelo efectivo, versiones de prompt/schema y respuesta original del proveedor. Los datos históricos V1 no se reinterpretan como V2.

`AI_MODE=mock` permite probar ambos contratos sin API keys ni consumo de IA. El mock V2 devuelve observaciones insuficientes con medidas, estilo y cobertura `null`, confidencias cero y booleanos falsos. No estima realmente la imagen. El modo por defecto es `real`; el valor heredado `gemini` se normaliza a `real`. No se utilizan variables `AI_MOCK_*`.

## Scoring y estados

La preparación del lead se guarda en una evaluación separada del estado operativo del lead. El motor de reglas registra:

- score bruto y score normalizado;
- versión de reglas;
- contribuciones que explican los puntos;
- blockers y gates activados;
- fecha de evaluación.

Estados de preparación:

- `LISTO`: información consistente y suficiente para continuar automáticamente;
- `REVISAR`: requiere revisión humana por discrepancias, baja confianza o fallo del proveedor de IA;
- `INCOMPLETO`: faltan datos esenciales, la conversación fue abandonada o se activa un gate duro.

Los gates tienen prioridad sobre los thresholds. Un error de IA con todos los datos del cliente presentes produce `REVISAR`, nunca `INCOMPLETO`, y no genera precio automático.

Estos estados no reemplazan el ciclo operativo del lead (`ANALYZING`, `VERIFIED`, `REQUIRES_REVIEW`, `HANDOFF_TO_TATTOO_ARTIST`, `COMPLETED`, entre otros).

## Precios

`PricingService` es la única fuente del precio automático. El cálculo se realiza en el backend a partir de la combinación de tamaño y nivel de detalle, utilizando reglas versionadas almacenadas en PostgreSQL.

El frontend no puede decidir `VERIFIED` ni establecer un precio automático. Cada lead conserva el precio y la versión de la regla utilizados en su cotización, por lo que cambios posteriores no alteran precios históricos.

Cuando un lead requiere revisión, el tatuador puede definir un rango válido y enviarlo mediante el servicio de mensajería. El envío es idempotente y queda registrado.

## Storage y privacidad

Las imágenes se guardan en un bucket privado de Supabase Storage. La base de datos conserva la ruta del objeto; el dashboard obtiene URLs firmadas de corta duración mediante endpoints autenticados.

Las imágenes de clientes no se eliminan automáticamente por antigüedad. El ADMIN puede verlas y eliminarlas manualmente desde `/admin/images`; esta operación conserva el lead, el análisis y el precio histórico. El tatuador puede descargar imágenes de sus propios leads mediante una URL firmada temporal.

La política pública está disponible en `/privacy` y explica los datos recopilados, la finalidad de uso, la retención de imágenes, los proveedores tecnológicos y el canal de contacto.

## Requisitos

- Node.js 24 recomendado;
- npm compatible con workspaces;
- PostgreSQL o Supabase Database;
- proyecto y bucket privado de Supabase Storage;
- aplicación de Meta con WhatsApp Cloud API;
- credenciales de Gemini;
- credenciales de OpenAI solo si se habilita el fallback;
- cuenta de Vercel para el despliegue actual.

## Instalación

Desde la raíz del repositorio:

```powershell
npm ci
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env.local
```

Prepara Prisma y aplica las migraciones existentes:

```powershell
cd backend
npm run prisma:generate
npm run prisma:validate
npm run prisma:migrate:deploy
npm run prisma:seed
```

Configura valores reales solo en `backend/.env`, `frontend/.env.local` o en el gestor de variables del proveedor. Estos archivos reales no deben subirse al repositorio.

## Variables de entorno

Los archivos `.env.example` contienen placeholders seguros. No copies claves reales al README ni al frontend.

### Backend

Aplicación y acceso:

- `NODE_ENV`
- `PORT`
- `FRONTEND_URL`
- `SESSION_TTL_HOURS`
- `TATTOO_ARTIST_EMAIL`
- `TATTOO_ARTIST_PASSWORD`
- `ADMIN_EMAIL` y `ADMIN_PASSWORD`: credenciales del administrador global para el comando `admin:create`.

Base de datos:

- `DATABASE_URL`: conexión runtime; en Vercel se usa el Transaction Pooler de Supabase.
- `DIRECT_URL`: conexión separada apropiada para Prisma CLI y migraciones.

IA:

- `AI_MODE`: `real` (por defecto) o `mock`.
- `GEMINI_API_KEY`: requerida en modo `real`.
- `GEMINI_MODEL`: modelo del proveedor real; tiene un valor por defecto.
- `AI_FALLBACK_PROVIDER`: `none` u `openai`.
- `OPENAI_API_KEY`: requerida solo cuando el fallback es `openai`.
- `OPENAI_MODEL`: requerida para el fallback de OpenAI.

Storage:

- `STORAGE_MODE`: `supabase` en producción; `memory` solo para tests aislados.
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_STORAGE_BUCKET`

WhatsApp:

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_NITA_NUMBER`: número de Nita de la cuenta heredada, necesario para registrar automáticamente el canal v0.1 cuando llega su primer webhook después de migrar.
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_VERIFY_TOKEN`
- `META_APP_SECRET`
- `WHATSAPP_GRAPH_API_VERSION`

Operación:

- `BUSINESS_HOURS_TEST_PHONE`: bypass horario opcional y temporal para un único número autorizado.

En modo `mock` no se crean clientes Gemini/OpenAI ni se requieren sus credenciales. Storage y WhatsApp mantienen su configuración independiente.

### Frontend

- `PRIVACY_CONTACT_EMAIL`: correo público mostrado en la política de privacidad.

## Desarrollo local

Backend, desde la raíz:

```powershell
npm --workspace backend run start:dev
```

Frontend, en otra terminal:

```powershell
npm --workspace frontend run dev
```

Abre `http://localhost:3000/login`. La raíz `/` redirige a `/login`.

Para crear o actualizar el usuario tatuador definido en el entorno:

```powershell
npm --workspace backend run user:create
```

Después de aplicar la migración de cuentas, crea el administrador global con `ADMIN_EMAIL` y `ADMIN_PASSWORD`:

```powershell
npm --workspace backend run admin:create
```

El panel `/admin` permite crear cuentas de tatuador, asignar su número de Nita y `phone_number_id`, cambiar contraseña o estado y copiar su URL `wa.me`. Si la cuenta heredada no tiene canal, asígnale ambos valores desde el panel antes de recibir mensajes; también puede registrarse automáticamente con `WHATSAPP_PHONE_NUMBER_ID` y `WHATSAPP_NITA_NUMBER` configurados. Una cuenta inactiva conserva sus datos y no procesa nuevos mensajes ni admite sesiones del tatuador.

### Precios por estilo (Fase 2)

`/dashboard/pricing/calibrate` permite habilitar estilos, responder los casos de calibración y activar un modelo por estilo. El ajuste general crea versiones nuevas sin modificar respuestas ni parámetros anteriores. Este pricing todavía no participa en las conversaciones ni en las cotizaciones de Nita; la matriz v0.1 sigue activa.

El algoritmo `AREA_COLOR_SEPARABLE_V1` interpola una curva base de precio por área con los casos `AREA` y una curva de factores propios del tatuador y estilo con los casos `COLOR`. El factor en cobertura cero es 1. Fuera de los rangos calibrados no entrega precio. El importe se calcula con precisión decimal y después se aplica el ajuste general.

Los ocho estilos iniciales se cargan con la migración. Los casos se administran mediante `/api/admin/catalog/styles` y `/api/admin/catalog/styles/:id/cases`, usando referencias HTTPS duraderas, separadas de `LeadImage`. No se cargan casos ficticios: las imágenes y sus metadatos internos deben prepararse antes de calibrar cada estilo. El sistema usa cuantos casos activos haya al iniciar cada borrador; la configuración inicial prevista es cinco `AREA` y cuatro `COLOR` por estilo.

Regla de producto para el flujo futuro: **Black & Grey = BLACK_ONLY**. Todavía no interviene en este pricing ni en la conversación v0.1.

## Tests y build

Backend:

```powershell
npm --workspace backend run format:check
npm --workspace backend run lint
npm --workspace backend run prisma:generate
npm --workspace backend run prisma:validate
npm --workspace backend run typecheck
npm --workspace backend run test
npm --workspace backend run test:e2e
npm --workspace backend run build
```

Frontend:

```powershell
npm --workspace frontend run format:check
npm --workspace frontend run lint
npm --workspace frontend run typecheck
npm --workspace frontend run build
```

Los smoke tests reales de proveedores requieren credenciales locales y una imagen no sensible. No forman parte de la ejecución normal de la suite.

## Rutas web

- `/`: redirige a `/login`;
- `/login`: acceso del tatuador;
- `/dashboard`: resumen privado;
- `/dashboard/leads`: bandeja, búsqueda, filtros, sorting y paginación;
- `/dashboard/leads/[id]`: detalle, evaluación explicable y acciones del lead;
- `/dashboard/pricing`: matriz de precios;
- `/dashboard/pricing/calibrate`: selección de estilos y calibración de precios v0.2;
- `/admin`: administración básica de cuentas y canales de Nita;
- `/admin/images`: imágenes de clientes de todas las cuentas y eliminación manual;
- `/privacy`: política de privacidad pública, sin autenticación.

## Despliegue en Vercel

El `vercel.json` de la raíz configura un único proyecto con dos Services:

- `frontend`: servicio Next.js;
- `backend`: servicio NestJS compilado;
- `/api/*`: se dirige al backend;
- el resto de rutas: se dirige al frontend;

El backend es ESM nativo y ejecuta el artefacto compilado. No depende de procesos persistentes ni del filesystem local. Las conversaciones vencen al recibir una nueva interacción.

Antes de desplegar:

1. configura las variables del backend y frontend en sus Services correspondientes;
2. usa `DATABASE_URL` para tráfico runtime y `DIRECT_URL` para migraciones;
3. ejecuta `npm run prisma:migrate:deploy` desde un entorno autorizado;
4. ejecuta `npm run admin:create` con credenciales seguras y configura el canal de Nita heredado;
5. confirma que el bucket de Supabase siga privado;
6. registra en Meta el callback HTTPS terminado en `/api/whatsapp/webhook`;
7. verifica `GET /api/health` después del deployment.

## Estructura principal

```text
tatto-flow/
├── backend/
│   ├── prisma/
│   ├── src/modules/auth/
│   ├── src/modules/chatbot/
│   ├── src/modules/dashboard/
│   ├── src/modules/image-analysis/
│   ├── src/modules/lead-scoring/
│   ├── src/modules/pricing/
│   ├── src/modules/storage/
│   └── test/
├── frontend/
│   ├── src/app/login/
│   ├── src/app/dashboard/
│   ├── src/app/privacy/
│   ├── src/components/
│   └── src/lib/
├── vercel.json
└── README.md
```
