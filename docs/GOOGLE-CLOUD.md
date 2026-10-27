# Google Cloud: activar los agentes de Manabit

## Lo que debes crear primero

En https://console.cloud.google.com/projectcreate crea un proyecto con nombre visible **Manabit Sistema**. El ID debe ser único; por ejemplo `manabit-sistema-david` solo si está disponible. Guarda ese ID y la cuenta que lo administra. No crees seis agentes desde el asistente visual: el grafo ADK ya está en este proyecto.

Proyecto creado y verificado: **`manabit-sistema`**, número **`130360510916`**. Está activo y tiene facturación habilitada. Se habilitaron las APIs base de despliegue; todavía no se han creado instancias de Cloud SQL, servicios Cloud Run ni runtimes ADK. En los comandos siguientes usa `manabit-sistema` donde aparece `TU_PROJECT_ID`.

**Presupuesto del piloto: menos de USD 10 al mes.** El despliegue de producción con Cloud SQL sigue como arquitectura de referencia y no se activa automáticamente con ese presupuesto. Primero hay que ajustar y estimar los componentes del piloto; no se promete que la arquitectura completa entre en ese importe. Un presupuesto con alertas no funciona como corte automático de consumo.

## Arquitectura de despliegue

| Recurso | Nombre propuesto | Función |
| --- | --- | --- |
| Cloud Run | manabit-sistema | Web pública, panel privado, API y webhooks |
| Cloud SQL PostgreSQL | manabit-db | Conversaciones, agenda, tareas y eventos |
| Agent Runtime público | manabit-atencion | Recepción + Asesor + Agenda + Soporte |
| Agent Runtime interno | manabit-direccion | Gerente + Ideas, opcional en la primera prueba |
| Secret Manager | secretos separados | Sesión, login, base de datos, herramientas y redes |
| Bucket privado | ID-unico-agent-staging | Artefactos de despliegue ADK |
| Cloud Scheduler | manabit-recover-jobs | Recuperar eventos pendientes si se interrumpe un worker |

Agent Runtime aparece en la documentación de Gemini Enterprise Agent Platform; el SDK conserva `agent_engines` y los recursos `reasoningEngines`. El código usa esas API oficiales. No se necesita Dialogflow para este piloto.

## Cuenta, APIs y permisos

1. Vincula la facturación y configura un presupuesto con alertas. La alerta no detiene por sí sola el gasto. No se presupone que Cloud SQL o las llamadas a Gemini sean gratuitas.
2. Selecciona el proyecto con `gcloud config set project TU_PROJECT_ID` e inicia ADC para desarrollo con `gcloud auth application-default login`. La sesión de `gcloud auth login` y las credenciales ADC son distintas.
3. Habilita las APIs que usarás: `aiplatform.googleapis.com`, `run.googleapis.com`, `sqladmin.googleapis.com`, `secretmanager.googleapis.com`, `storage.googleapis.com`, `artifactregistry.googleapis.com`, `cloudbuild.googleapis.com` y, antes de conectar redes, `cloudscheduler.googleapis.com`.
4. Crea tres cuentas de servicio: `manabit-web`, `manabit-agent-public` y `manabit-agent-owner`. Web necesita invocar los runtimes y conectar a Cloud SQL; cada agente necesita invocar Gemini y leer únicamente su propio secreto de herramientas. Otorga Secret Accessor sobre secretos concretos, no todos los secretos del proyecto. No concedas Owner al runtime.
5. La persona que despliega necesita permisos de creación de recursos y permiso `actAs` sobre las cuentas de servicio. Verifica las políticas de tu organización; no se automatizan cambios IAM en este proyecto.

El entorno de desarrollo se verificó con ADK 2.13.0, SDK de Google 2.6.0 y Python 3.14. El paquete fija esas versiones. La región propuesta del runtime es `us-central1`; Gemini usa endpoint `global`. Mantén los datos y conexiones en las regiones elegidas y revisa disponibilidad del modelo en tu proyecto.

## Desplegar primero la web y la base

1. Crea PostgreSQL en Cloud SQL, una base `manabit` y un usuario de aplicación. Activa respaldos. El esquema se inicializa al primer acceso; necesita crear `btree_gist` y la restricción de exclusión. Antes de varias instancias, realiza esa inicialización con una única instancia y comprueba la restricción. La migración automática no sustituye una estrategia de migraciones para producción.
2. Guarda `DATABASE_URL`, `SESSION_SECRET` (32+ caracteres), `ADMIN_PASSWORD` (16+), `MANABIT_TOOLS_TOKEN`, `MANABIT_OWNER_TOOLS_TOKEN` y `WORKER_TOKEN` en Secret Manager, con valores distintos. El script local `node scripts/setup-local.mjs` ayuda a generar valores, pero no los sube ni los imprime. Carga los secretos por la consola o un flujo seguro.
3. Crea Cloud Run desde el código usando el `Dockerfile`, adjunta la instancia Cloud SQL y la cuenta `manabit-web`. Para el piloto limita las instancias y configura tiempo de petición suficiente para el turno del agente, por ejemplo 120 segundos.
4. En Cloud Run monta secretos como variables, configura `APP_URL` con su URL HTTPS real y deja `SOCIAL_AUTOMATION_ENABLED=false`. No uses SQLite en Cloud Run: el servidor lo rechaza.
5. Para el socket Unix de Cloud SQL, la URL de `pg` puede usar el parámetro `host=/cloudsql/PROJECT:REGION:INSTANCE`. Codifica caracteres especiales de usuario/contraseña en la URL. No uses una IP pública sin el control de red y TLS apropiado.
6. La recepción requiere acceso público al servicio. Las rutas `/api/admin/*` exigen login en producción, las herramientas llevan bearer separado y los webhooks verifican firma. Comprueba desde un navegador sin sesión que `/api/admin/state` devuelve 401 antes de compartir la URL.
7. Prueba `/reservar`, crea y cancela una cita con datos de prueba. La aplicación empieza en modo guiado; la web ya debe poder guardar citas antes de conectar Gemini.

No se ha ejecutado la imagen Docker ni una prueba PostgreSQL real en esta entrega: Docker Desktop no estaba disponible. Esa validación es parte de la activación cloud.

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
