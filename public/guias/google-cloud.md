# Google Cloud: activar los agentes de Manabit

## Lo que debes crear primero

En https://console.cloud.google.com/projectcreate crea un proyecto con nombre visible **Manabit Sistema**. El ID debe ser único; por ejemplo `manabit-sistema-david` solo si está disponible. Guarda ese ID y la cuenta que lo administra. No crees seis agentes desde el asistente visual: el grafo ADK ya está en este proyecto.

Proyecto creado y verificado: **`manabit-sistema`**, número **`130360510916`**. Está activo y tiene facturación habilitada. Se habilitaron las APIs base de despliegue; todavía no se han creado la base Firestore, servicios Cloud Run ni runtimes ADK. En los comandos siguientes usa `manabit-sistema` donde aparece `TU_PROJECT_ID`.

**Presupuesto del piloto: menos de USD 10 al mes.** Por eso el piloto usa **Firestore** en lugar de Cloud SQL: no cobra por instancia encendida y la base `(default)` tiene cuota gratuita diaria. Cloud Run y Agent Runtime escalan a cero. PostgreSQL sigue soportado con `DATABASE_URL` para una etapa multiempresa. Un presupuesto con alertas no funciona como corte automático de consumo.

## Arquitectura de despliegue

| Recurso | Nombre propuesto | Función |
| --- | --- | --- |
| Cloud Run | manabit-sistema | Web pública, panel privado, API y webhooks |
| Firestore (modo nativo) | `(default)` en us-central1 | Conversaciones, agenda, tareas y eventos |
| Agent Runtime público | manabit-atencion | Recepción + Asesor + Agenda + Soporte |
| Agent Runtime interno | manabit-direccion | Gerente + Ideas, opcional en la primera prueba |
| Secret Manager | secretos separados | Sesión, login, base de datos, herramientas y redes |
| Bucket privado | ID-unico-agent-staging | Artefactos de despliegue ADK |
| Cloud Scheduler | manabit-recover-jobs | Recuperar eventos pendientes si se interrumpe un worker |

Agent Runtime aparece en la documentación de Gemini Enterprise Agent Platform; el SDK conserva `agent_engines` y los recursos `reasoningEngines`. El código usa esas API oficiales. No se necesita Dialogflow para este piloto.

## Cuenta, APIs y permisos

1. Vincula la facturación y configura un presupuesto con alertas. La alerta no detiene por sí sola el gasto. No se presupone que Firestore, Agent Runtime o las llamadas a Gemini sean gratuitos fuera de sus cuotas.
2. Selecciona el proyecto con `gcloud config set project TU_PROJECT_ID` e inicia ADC para desarrollo con `gcloud auth application-default login`. La sesión de `gcloud auth login` y las credenciales ADC son distintas.
3. Habilita las APIs que usarás: `aiplatform.googleapis.com`, `run.googleapis.com`, `firestore.googleapis.com`, `secretmanager.googleapis.com`, `storage.googleapis.com`, `artifactregistry.googleapis.com`, `cloudbuild.googleapis.com` y, antes de conectar redes, `cloudscheduler.googleapis.com`.
4. Crea tres cuentas de servicio: `manabit-web`, `manabit-agent-public` y `manabit-agent-owner`. Web necesita invocar los runtimes y leer/escribir Firestore (`roles/datastore.user`); cada agente necesita invocar Gemini y leer únicamente su propio secreto de herramientas. Otorga Secret Accessor sobre secretos concretos, no todos los secretos del proyecto. No concedas Owner al runtime.
5. La persona que despliega necesita permisos de creación de recursos y permiso `actAs` sobre las cuentas de servicio. Verifica las políticas de tu organización; no se automatizan cambios IAM en este proyecto.

El entorno de desarrollo se verificó con ADK 2.13.0, SDK de Google 2.6.0 y Python 3.14. El paquete fija esas versiones. La región propuesta del runtime es `us-central1`; Gemini usa endpoint `global`. Mantén los datos y conexiones en las regiones elegidas y revisa disponibilidad del modelo en tu proyecto.

## Desplegar primero la web y la base

Atajo para el piloto, desde la carpeta del proyecto en PowerShell normal: `scripts\gcp-preparar.ps1` (permiso de Firestore, cinco secretos generados sin mostrarse y accesos mínimos; solo pide la contraseña del panel) y después `scripts\gcp-desplegar.ps1` (Cloud Build + Cloud Run con Firestore, comprueba el 401 del panel y los horarios). `.gcloudignore` evita subir `.env*`, `.data`, `agents` y `node_modules`. Los pasos siguientes detallan lo que hacen.

1. Crea la base Firestore en modo nativo, `(default)`, en `us-central1`: `gcloud firestore databases create --location=us-central1 --type=firestore-native`. Solo la base `(default)` tiene cuota gratuita. No hay usuarios ni contraseñas: Cloud Run entra con la cuenta `manabit-web` y el rol `roles/datastore.user`.
2. Opcional: borra contadores de límite vencidos con TTL: `gcloud firestore fields ttls update expireAt --collection-group=rate_limits --enable-ttl`.
3. Guarda `SESSION_SECRET` (32+ caracteres), `ADMIN_PASSWORD` (16+), `MANABIT_TOOLS_TOKEN`, `MANABIT_OWNER_TOOLS_TOKEN` y `WORKER_TOKEN` en Secret Manager, con valores distintos, y da a `manabit-web` Secret Accessor solo sobre esos secretos. `DATABASE_URL` no aplica con Firestore.
4. Despliega Cloud Run desde el `Dockerfile` con la cuenta `manabit-web`, `DATABASE_BACKEND=firestore`, `min-instances=0`, `max-instances=1` y timeout de 120 s para el turno del agente.
5. Configura `APP_URL` con la URL HTTPS real y deja `SOCIAL_AUTOMATION_ENABLED=false`. No uses SQLite en Cloud Run: el servidor lo rechaza.
6. La recepción requiere acceso público al servicio. Las rutas `/api/admin/*` exigen login en producción, las herramientas llevan bearer separado y los webhooks verifican firma. Comprueba desde un navegador sin sesión que `/api/admin/state` devuelve 401 antes de compartir la URL.
7. Prueba `/reservar`, crea y cancela una cita con datos de prueba. La aplicación empieza en modo guiado; la web ya debe poder guardar citas antes de conectar Gemini.

### Modelo en Firestore y costes

| Ruta | Contenido |
| --- | --- |
| `tenants/{tenant}/{tipo}/{id}` | Conversaciones, contactos, tareas, borradores, eventos, entregas y configuración (JSON en `payload`) |
| `tenants/{tenant}/appointments/{id}` | Citas |
| `tenants/{tenant}/appointmentKeys/{clave}` | Idempotencia: una clave, una cita |
| `tenants/{tenant}/agendaLocks/{profesional}` | Serializa reservas del mismo profesional dentro de una transacción |
| `leases/{nombre}`, `rate_limits/{id}` | Coordinación entre procesos y límites de uso |

Una reserva se valida en una transacción que lee la agenda del profesional y escribe su lock: dos reservas simultáneas chocan y la segunda ve la primera. Firestore cobra por documento leído y el panel se refresca cada 8 s, así que los listados se cachean en memoria (`FIRESTORE_LIST_CACHE_SECONDS`, 60 por defecto) y se invalidan en cada escritura del proceso. Con `max-instances=1` el caché es coherente; con más instancias, el TTL acota cuánto tarda en verse un cambio de otra.

Verificado contra el emulador de Firestore (concurrencia, idempotencia, cancelación, leases, límites y los flujos del sistema) y con el build standalone en modo Cloud Run. Falta la prueba contra la base real y la imagen Docker; ambas son parte de la activación.

## Desplegar el runtime público

Desde `agents` crea un entorno virtual e instala `requirements.txt`:

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
.venv/Scripts/python.exe -m unittest discover -s tests -v
```

Crea un bucket privado de staging y guarda el token público de herramientas en Secret Manager. Su versión debe contener exactamente el mismo valor configurado como `MANABIT_TOOLS_TOKEN` en Cloud Run. El runtime público recibe el **nombre de la versión**, no el token en texto dentro del paquete.

Ejemplo de revisión sin desplegar, desde `agents`:

```powershell
.venv/Scripts/python.exe deploy.py --project TU_PROJECT_ID --bucket gs://TU_BUCKET --service-account manabit-agent-public@TU_PROJECT_ID.iam.gserviceaccount.com --api-url https://TU_SERVICIO.run.app --secret-version projects/TU_PROJECT_ID/secrets/manabit-tools-public/versions/1
```

El resultado debe indicar `checked: true` y `deployed: false`. Para crear el runtime, ejecuta ese mismo comando añadiendo `--execute`. **Cada `--execute` sin `--update` crea un recurso nuevo.** Conserva el nombre devuelto y, para desplegar cambios, repite el comando con `--execute --update projects/ID/locations/REGION/reasoningEngines/NUMERO`. Así no se duplican runtimes.

El script usa `vertexai.Client().agent_engines.create(agent=AdkApp(...))`, escala de cero a dos instancias y empaqueta solo `factory.py` y `tools.py`, más dependencias declaradas. No empaqueta `.env`, SQLite ni la web. La URL de herramientas debe ser accesible desde Google; `localhost` no sirve.

Copia el nombre devuelto, con formato `projects/ID/locations/REGION/reasoningEngines/NUMERO`, a `GOOGLE_AGENT_ENGINE_ID` de Cloud Run. Reinicia el servicio y prueba planes, horario, una propuesta con código de aceptación y una derivación humana. El backend usa `async_create_session` y `async_stream_query`; esos contratos se comprobaron contra el SDK instalado, pero aún no contra un runtime de tu cuenta.

Para el runtime interno repite con `--audience owner`, cuenta `manabit-agent-owner` y **otro secreto**, `manabit-tools-owner`. Su recurso se configura como `GOOGLE_OWNER_AGENT_ENGINE_ID`. Este paso puede esperar hasta validar la atención pública.

## Recuperación de eventos sociales

Antes de activar una red, programa Cloud Scheduler para `POST https://TU_SERVICIO/api/worker/jobs` cada minuto con el encabezado `Authorization: Bearer VALOR_DE_WORKER_TOKEN`. Es una credencial dedicada; restrínge quién puede leer o editar el job. El backend solo procesa pendientes y usa leases para evitar que dos workers tomen el mismo evento. Un trabajo fallido queda visible y requiere revisión/reintento desde el panel.

Este mecanismo sirve para el piloto. No hay Cloud Tasks o Pub/Sub configurados; para mayores volúmenes conviene separar el worker y usar una cola administrada con reintentos y dead-letter.

## Orden de activación

1. Web guiada y reservas persistentes.
2. Gemini público y sus herramientas verificadas.
3. Una cuenta social y sus permisos reales, más recuperación de eventos.
4. Dirección interna y mejora de conversaciones.
5. Calendario, recordatorios y adaptación multiempresa.

Puedes compartir el **ID del proyecto** para continuar. No pegues contraseñas, archivos de cuenta de servicio ni tokens en un chat.

## Referencias oficiales consultadas

- [Desplegar ADK](https://adk.dev/deploy/)
- [Gestionar sesiones con ADK](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/sessions/manage-with-adk)
- [Gemini 3.5 Flash y su identificador](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash)
- Los contratos de despliegue también se revisaron directamente en el SDK instalado, sin invocar servicios cloud.
