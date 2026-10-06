# Tatuoflow

Tatuoflow es un MVP para gestionar solicitudes y cotizaciones de tatuajes recibidas por WhatsApp. Nita recopila la información del cliente, almacena temporalmente la imagen de referencia, solicita un análisis visual y prepara el lead para que el tatuador lo atienda desde un dashboard privado.

La IA aporta observaciones sobre la referencia, pero no decide el precio ni el estado final por sí sola. El backend aplica la preparación del caso y el modelo de precios calibrado del tatuador.

## Estado actual del MVP

El proyecto incluye:

- recepción y respuesta mediante WhatsApp Cloud API;
- flujo conversacional de Nita exclusivo de WhatsApp;
- análisis visual con Gemini como proveedor principal y OpenAI como fallback técnico opcional;
- preparación con cotización automática, revisión ordinaria o revisión especial;
- precios determinísticos calculados únicamente en el backend;
- revisión y envío manual de precio cuando el análisis requiere intervención;
- dashboard privado para gestionar leads y calibración de precios;
- almacenamiento privado de referencias en Supabase Storage;
- autenticación del tatuador y sesiones persistentes;
- administración global de cuentas de tatuador y números de Nita separados;
- despliegue conjunto de frontend y backend mediante Vercel Services;
- política de privacidad pública en `/privacy`.

No existe un chat web para Nita. El canal de atención automatizada es WhatsApp.

## Arquitectura

| Capa         | Tecnología               | Responsabilidad                                                                 |
| ------------ | ------------------------ | ------------------------------------------------------------------------------- |
| Frontend     | Next.js + TypeScript     | Login y dashboard responsive/mobile-first del tatuador                          |
| Backend      | NestJS + TypeScript      | Webhook, reglas de negocio, autenticación, preparación y precios                |
| Persistencia | PostgreSQL + Prisma 7    | Clientes, conversaciones, leads, análisis, cotizaciones y sesiones              |
| Archivos     | Supabase Storage privado | Imágenes de referencia con acceso mediante URLs firmadas                        |
| IA visual    | Gemini + OpenAI          | Gemini principal y OpenAI como fallback ante fallos técnicos elegibles          |
| Mensajería   | WhatsApp Cloud API       | Entrada de texto, botones, listas e imágenes; salida de texto, botones y listas |
| Despliegue   | Vercel Services          | Next.js y NestJS dentro de un único proyecto                                    |

Flujo principal:

```text
WhatsApp Cloud API
        ↓
Webhook firmado + resolución del número receptor + idempotencia por message ID
        ↓
WhatsAppJob / WhatsAppJobProcessor / WhatsAppAdapter
        ↓
ChatbotService / ConversationService
        ↓
Supabase Storage privado
        ↓
Gemini ──fallo técnico elegible──> OpenAI
        ↓
NitaV2AnalysisService / Decision Engine
        ↓
QuoteV2Service o revisión humana
        ↓
Dashboard + entrega al tatuador
```

## Flujo de WhatsApp

El endpoint público es `/api/whatsapp/webhook`:

- `GET` valida la suscripción de Meta con `WHATSAPP_VERIFY_TOKEN`;
- `POST` valida `X-Hub-Signature-256` con `META_APP_SECRET`;
- los IDs de mensajes entrantes se registran para evitar reprocesamientos;
- el adapter convierte texto, `button_reply`, `list_reply` e imágenes a entradas del dominio sin contener lógica de estados;
- las respuestas estructuradas del chatbot se convierten en texto, botones o listas interactivas de WhatsApp.

Cada `phone_number_id` registrado en el panel ADMIN identifica una cuenta de tatuador. Los clientes se distinguen por cuenta y teléfono; un mismo remitente puede escribir a dos números de Nita sin mezclar conversaciones. Los canales registrados usan las credenciales de la misma integración de Meta configurada en el backend.

Solo existe la Nita actual. Solicita primer tatuaje, imagen de referencia, mismo tamaño,
tamaño objetivo en centímetros (tanto con YES como con NO), color y ubicación.
`targetSizeCm` es siempre el tamaño declarado por el cliente; la medida de referencia
es contexto y nunca lo sustituye ni se promedia con él.

La conversación incompleta se conserva durante dos horas de actividad efectiva. Al completarse el procesamiento, la conversación pasa a `COMPLETED` y `HANDOFF_TO_TATTOO_ARTIST`; Nita deja de responder automáticamente mientras el lead siga en atención.

El horario normal se evalúa siempre en `America/Lima`: desde las 06:00 inclusive hasta las 22:00 exclusivo. El tiempo fuera de horario no hace expirar el progreso de una conversación.

`BUSINESS_HOURS_TEST_PHONE` es una variable opcional y temporal de testing. Si contiene un número y coincide exactamente con el remitente, solo omite la restricción horaria para ese número. Vacía o ausente, no cambia el comportamiento normal. No debe hardcodearse ningún teléfono en el código.

## Análisis de imágenes

Gemini es el proveedor principal. Ante un fallo técnico elegible, el backend puede realizar un único intento con OpenAI si `AI_FALLBACK_PROVIDER=openai` y sus credenciales están configuradas. Una respuesta válida con baja confianza o discrepancias no activa el fallback.

Gemini, OpenAI y mock comparten el contrato `VISION_V2_5` y el prompt 5.
`estimatedDensity` es un número continuo entre 0 y 100, con decimales, independiente
del estilo, color, tamaño y precio. La columna nullable conserva la lectura de Vision
V2_4 y versiones anteriores sin reconstruir datos. Proveedor/modelo, versiones de
prompt/schema y respuesta original permanecen en `AiAnalysis`.

`ImageAnalysisV2Service` verifica pertenencia a la cuenta y reutiliza los análisis
persistidos. No existe un endpoint público para probar Vision. El mock devuelve una
referencia inválida sin evidencia visual ni medidas físicas inventadas.

## Preparación y precios

El Decision Engine usa el intake y las observaciones para preparar cotización o revisión.
`QuoteV2Service` calcula el precio en el backend con los modelos calibrados del tatuador.
`Quote` conserva el importe y el snapshot inmutable del modelo. El modelo A/B usa la
densidad estimada y el color objetivo declarado por el cliente; los modelos anteriores
conservan su algoritmo. Los pedidos de revisión sin Quote admiten precio final manual.
Los detalles del algoritmo actual y su calibración se describen más abajo.

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
- `WHATSAPP_NITA_NUMBER`: número de Nita para registrar automáticamente el canal de la cuenta inicial cuando llega su primer webhook. Los demás canales se resuelven mediante `WhatsAppChannel`.
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

### Precios por estilo

`/dashboard/pricing/calibrate` permite habilitar estilos, responder los casos de calibración y activar un modelo por estilo. El ajuste general crea versiones nuevas sin modificar respuestas ni parámetros anteriores. Nita utiliza estos modelos mediante `QuoteV2Service`.

El catálogo Fine Line contiene 20 casos A (5 tamaños × 4 coberturas de color, con densidad 60) y 5 casos B (11 cm, negro, densidades 20/40/60/80/100, basados en `FL_A_09`). Sus imágenes fijas se sirven desde `/calibration-assets/v1/Fine_Line/`; las referencias privadas de clientes siguen en Storage. El tatuador ve estilo, imagen, progreso, precio y navegación, sin la metadata interna del caso.

Los borradores A/B empiezan en `CATALOG_AB_PENDING`. Al responder los 25 precios válidos, se construye `CATALOG_AB_BILINEAR_DENSITY_V1` y el tatuador puede activarlo para ese estilo y cuenta. El precio es `surfaceA(sizeCm, colorCoverage) × B(estimatedDensity) / B(60) × (1 + generalAdjustmentPercent / 100)`, con interpolación bilineal en A y lineal en B. No extrapola fuera del catálogo: Fine Line admite tamaño 4–30 cm, color 0–1 y densidad 20–100. Se calcula con precisión decimal y se guarda en céntimos sin redondeo comercial adicional.

`AREA_COLOR_SEPARABLE_V1` sigue disponible para los modelos anteriores: interpola una curva base por área con los casos `AREA` y una curva de factores aprendidos con los casos `COLOR`. El factor en cobertura cero es 1. Fuera de los rangos calibrados no entrega precio. Los modelos y snapshots históricos, incluidos los identificados con `IDW_CONVEX_HULL_V1`, se conservan.

Los ocho estilos iniciales se cargan con la migración. Los casos globales se administran mediante `/api/admin/catalog/styles`, `/api/admin/catalog/styles/:id/cases` y `/api/admin/catalog/import`; las respuestas y modelos pertenecen a cada cuenta. El importador acepta referencias HTTPS duraderas o rutas públicas relativas del frontend, separadas de `LeadImage`. Cada borrador congela los casos activos del catálogo elegido. Fine Line es el único catálogo A/B real disponible por ahora.

Nita pregunta **Negro / Poco color / Color medio / Full color**, que producen `targetColorCoverage` **0 / 0.25 / 0.5 / 1**. **Black & Grey = BLACK_ONLY** sigue siendo una respuesta textual válida para Negro. Vision describe el color observado y permite contrastar intención y referencia, sin elegir el color objetivo. Las declaraciones históricas ambiguas se conservan y requieren una elección explícita para una nueva cotización; las cotizaciones existentes no cambian.

## Tests y build

### Nita V2 — intake (Fase 4A)

El intake V2 recopila primer tatuaje, referencia privada, mismo tamaño y dimensión principal
en cm, color y ubicación, hasta `READY_FOR_ANALYSIS`. Las respuestas temporales viven en `Conversation`;
el candidato se crea al guardar la imagen y recibe los datos consolidados al completar
el intake. `bodyPart` se reutiliza para ubicación (máximo 120 caracteres).

Las pruebas E2E con BD requieren una `.env` local y permisos para crear esquemas temporales.
Ejecutan todas las migraciones en un esquema separado por suite y lo eliminan al terminar.
Usan Storage en memoria y WhatsApp simulado:

```powershell
$env:RUN_NITA_V2_DB_TESTS = "1"
npm --workspace backend run test:e2e
Remove-Item Env:RUN_NITA_V2_DB_TESTS
```

### Nita V2 — análisis y preparación (Fase 4B)

Al completar el intake, V2 procesa `READY_FOR_ANALYSIS → ANALYZING` y termina internamente
en `READY_FOR_PRICING`, `HUMAN_REVIEW` o `SPECIAL_REVIEW`. Reutiliza AI Vision V2 y su fallback.
Esta etapa de preparación no calcula precios; consulta el algoritmo activo para validar
las entradas necesarias. La cotización y su comunicación se realizan después.
El acuse de recepción del intake se conserva.

`AiAnalysis` mantiene las observaciones y metadata originales. `Lead.v2Preparation` guarda
una estructura versionada con decisión, diagnósticos, las dos señales especiales, comparación
de color y datos derivados. Las medidas y el factor se calculan con Decimal (40 dígitos)
y se serializan como strings para conservar precisión. No se crean tablas nuevas.

El tamaño objetivo siempre procede del cliente, independientemente de SAME_SIZE.
El modelo por área usa el tamaño declarado y la geometría compositiva observada;
el modelo A/B usa directamente `targetSizeCm` y no requiere un área estimada.
`ASK_TARGET_SIZE_AFTER_ANALYSIS` conserva la recuperación de conversaciones históricas
sin tamaño objetivo, sin copiar ni inventar medidas de la referencia.
La única regla comercial de confianza sigue siendo `overallConfidence >= 0.90`.

La cobertura objetivo procede de la elección explícita del cliente: 0, 0.25, 0.5 o 1.
Añadir color a una referencia esencialmente negra exige revisión especial y conserva
el nivel elegido. Las diferencias con una referencia coloreada se registran como modificación.
La otra señal especial es cobertura corporal extensa; ambas pueden guardarse juntas.

El procesamiento usa un claim persistido de 120 s con ID de intento, transacciones breves
y un límite técnico de 90 s para AI (compatible con los reintentos/fallback existentes).
Un reintento puede recuperar un claim vencido y reutiliza el análisis ya guardado.
Desde Fase 6A, el webhook persiste un trabajo V2; su worker retoma el análisis sin repetir
intake. Un claim vigente impide que otro worker lo ejecute simultáneamente.
Los fallos definitivos de análisis terminan en HUMAN_REVIEW. Los resultados tardíos de un
intento sustituido no alteran la decisión ni el histórico. No se añade un cron en esta fase.

El desacoplamiento del webhook se implementa en Fase 6A. Su ejecución después del ACK
debe comprobarse también en el despliegue real.

La suite `nita-v2-database` comprueba el intake con preparación sustituida por un stub.
`nita-v2-preparation` comprueba el pipeline completo por webhook con la BD de desarrollo,
cuentas y estilo aislados, IA/Storage/WhatsApp simulados, y limpieza posterior.

### Nita V2 — cotización y avance (Fase 5)

`READY_FOR_PRICING` selecciona el modelo ACTIVE de la misma cuenta y estilo habilitado.
`QuoteV2Service` despacha por `algorithmVersion`: los modelos A/B usan tamaño declarado,
color elegido y densidad observada; los modelos por área usan las medidas preparadas.
Sin entradas suficientes o modelo aplicable, el caso pasa a revisión ordinaria
con diagnóstico `PRICING_MODEL_NOT_AVAILABLE` o `MODEL_NOT_APPLICABLE`.

`Quote` conserva un único importe en PEN por lead, modelo/version/algoritmo, entradas,
ajuste general y snapshot de curvas y casos. La base de datos bloquea actualizaciones
de Quote. Los cambios de calibración o ajuste afectan nuevos casos; los reintentos reutilizan
la Quote existente.

La cotización queda en `PRICE_READY` mientras se entrega un precio aproximado único
y la pregunta de avance. Tras registrar el envío de la pregunta, pasa a `ASK_ADVANCE_INTENT`.
La elección expresa se persiste como `DIRECT_BOOKING` (`READY_TO_COORDINATE`) o
`ARTIST_CONTACT`; ambos terminan en `HANDOFF_TO_TATTOO_ARTIST`. Coordinar no equivale
a una cita reservada. Las revisiones reciben un mensaje humano, pasan a handoff y conservan
`bookingIntent = null`, sin preguntar por una cita ni mostrar precio.

`WhatsAppDelivery` conserva el mensaje final, sus intentos, claim temporal, error y `sentAt`.
Resultado, pregunta y confirmación tienen claves únicas por lead; lo ya registrado como enviado
no se repite. Un fallo confirmado antes del envío o un rechazo explícito permite reintentar
el trabajo sin recalcular la Quote. Los envíos V2
utilizan un límite HTTP de 30 s y un claim de 60 s, con procesamiento fuera de las transacciones.
Desde Fase 6A, el job V2 orquesta estos envíos. El dashboard muestra Quote, estado V2, estilo,
área/color objetivo, revisión e intención.

La suite `nita-v2-completion` comprueba pricing, histórico inmutable, aislamiento,
concurrencia, fallos de entrega y ambas intenciones con BD de desarrollo y proveedores
simulados. La suite de trabajos de Fase 6A verifica el ingreso durable por webhook.
El registro distingue pendiente (sin `sentAt`, error ni claim), enviado (`sentAt`), fallo
confirmado (`DELIVERY_FAILED`) y resultado desconocido (`DELIVERY_UNKNOWN`). Un timeout,
error de transporte/servidor, fallo al persistir después de la aceptación o claim vencido
queda desconocido y bloquea el reenvío automático y los mensajes siguientes. Un claim vigente
sigue en proceso. Si falla incluso la persistencia del diagnóstico, el claim conservado impide
un nuevo envío y queda desconocido al vencer. No se agrega resolución automática o manual
de resultados desconocidos en esta fase; requieren comprobación operativa antes de continuar.
No se ofrece una garantía absoluta de entrega exactamente una vez.

### Nita V2 — trabajo durable fuera del webhook (Fase 6A)

El webhook V2 valida firma, cuenta/canal y mensaje. En una transacción registra el ID
inbound y un `WhatsAppJob` único; responde sin descargar imágenes, ejecutar Vision,
calcular Quote ni enviar respuestas. Es el único recorrido del webhook.

`waitUntil` de `@vercel/functions` inicia el procesador después del trabajo mínimo
del webhook, sin esperar su resultado para responder. Se configura un máximo de
300 s para la función backend. El job permanece en PostgreSQL si la invocación termina.
No se añade otra infraestructura ni un cron de retención o eliminación de imágenes.

Los estados son `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, `RETRYABLE` y `UNKNOWN`.
Se guardan cuenta, canal, cliente, inbound, versión de flujo y, cuando están disponibles,
conversación/lead/imagen. Estos tres últimos IDs son referencias históricas escalares
para conservar las operaciones actuales de borrado del dashboard; el worker valida
su pertenencia a la cuenta y cliente. El input mínimo (texto, ID de botón o media ID)
se elimina al confirmar su aplicación. No se persiste el payload completo de Meta.

El worker usa `FOR UPDATE SKIP LOCKED`, un claim con ID de intento y lease de 300 s.
Ordena trabajos por cliente/cuenta y bloquea posteriores mientras el anterior está
pendiente, procesando, retryable o desconocido. El checkpoint guarda transición,
recibo del input y respuestas de intake en la misma transacción. Un retry continúa
desde ese recibo y usa los servicios existentes de análisis, preparación, pricing,
Quote y delivery. El job conserva V2 aunque cambie el valor predeterminado.
El abandono crea un intake nuevo y conserva la conversación e imagen anteriores.

Las respuestas de intake se guardan en `WhatsAppDelivery` por job/secuencia;
resultado, intención y handoff conservan sus claves por lead. SENT se omite,
un fallo confirmado permite retry y UNKNOWN bloquea nuevos envíos y pasos posteriores.
Si se pierde la confirmación de una transacción pero `sentAt` sí quedó guardado, el job
queda retryable y la recuperación omite ese mensaje y continúa únicamente lo pendiente.
Los fallos transitorios de Vision dejan el job retryable; un análisis válido y una Quote
persistidos se reutilizan. El backoff técnico empieza en 5 s y llega a 300 s.
Una cuenta desactivada deja el job en FAILED (`ACCOUNT_INACTIVE`) y conserva su histórico.

El dispatcher drena inputs rápidos durante un presupuesto de 30 s; cada job iniciado
puede terminar usando el resto de la invocación. Para recuperar pendientes, retryables
cuyo backoff venció o workers con lease vencido, usar GET o POST
`/api/whatsapp/jobs/process`. Cada llamada procesa como máximo un job elegible.
La ruta exige `Authorization: Bearer <CRON_SECRET>`, un secreto privado de al menos
32 caracteres, y devuelve `Cache-Control: no-store`. Sin configurar el secreto devuelve
503 y con autorización inválida devuelve 401. No expone mensajes, imágenes ni secretos.

Configurar `CRON_SECRET` fuera de Git en desarrollo/despliegue. Ejemplo de recuperación
con la variable ya presente en la sesión de PowerShell:

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:3001/api/whatsapp/jobs/process" -Headers @{ Authorization = "Bearer $env:CRON_SECRET" }
```

**Deuda antes de producción:**

> `WhatsAppJob` es persistente, pero la recuperación automática periódica todavía no está configurada. `waitUntil` es el camino principal y `/api/whatsapp/jobs/process` permite recuperación segura.

Después de una interrupción, un webhook posterior puede despertar el procesador o se
llama a esta ruta. UNKNOWN no se reintenta
ni se resuelve automáticamente. Los logs incluyen job, cuenta, conversación, estado,
intento, timestamps y códigos de error resumidos, sin contenido del cliente.

La suite `whatsapp-jobs` prueba el ACK independiente del pipeline, duplicados, claims,
recuperación, retries, Quote inmutable, delivery, aislamiento y abandono en PostgreSQL
aislado con proveedores simulados. Las suites de intake, preparación y cierre también
utilizan el ingreso durable de producción.

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
- `/dashboard/leads/[id]`: detalle, análisis visual, preparación y acciones del lead;
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
