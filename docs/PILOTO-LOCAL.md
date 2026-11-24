# Piloto local: chat web, ADK y Vertex AI

El piloto ejecuta Next.js y los seis agentes en tu equipo. Gemini responde desde el proyecto de Google Cloud `manabit-sistema` usando ADC. La agenda de este recorrido permanece en SQLite local. La web que ya existe en Cloud Run con Firestore conserva su configuración independiente; este cambio no conecta ni despliega allí los agentes.

## Iniciar

Desde la raíz de `manabit-sistema`, con Node 24 y Python 3.14:

```powershell
agents/.venv/Scripts/python.exe -m pip install -r agents/requirements-local.txt
npm run agents:local
```

En otra terminal de la misma carpeta:

```powershell
npm run dev
```

Abre http://127.0.0.1:3100/reservar para el cliente y http://127.0.0.1:3100 para David. `agents:local` prepara un token privado en `.env.local` sin mostrarlo. Debe quedar en ejecución junto con la web. Los dos servidores escuchan solo en el equipo, puertos 3100 y 8001.

## Qué cambia al activar el piloto

La recepción deja de usar respuestas guiadas y consulta el grafo ADK. Recepción puede transferir al Asesor, Agenda o Soporte según el mensaje. Gerente e Ideas se invocan desde el panel privado. Las herramientas usan los mismos endpoints de negocio ya existentes, con secretos distintos para atención y dirección.

Agenda consulta horarios reales y devuelve una propuesta. El cliente debe enviar `CONFIRMAR CODIGO` para que el backend guarde la reserva. La autorización de citas sigue en TypeScript y no se delega al modelo. Pedir atención de David crea una tarea y pausa el asistente.

## Consumo y límite

El piloto admite como máximo **USD 8 al mes de consumo estimado de Gemini** entre ambas entradas. Antes de cada generación cuenta el contexto, rechaza entradas superiores a 12.000 tokens y reserva el máximo calculado con 1.200 tokens de salida. El importe se ajusta si Google devuelve uso final, incluyendo razonamiento. Una generación fallida conserva su reserva máxima. La transacción del registro evita que varias solicitudes reserven más del saldo disponible.

El contador se guarda en `.data/adk/usage.sqlite`; las sesiones ADK en `.data/adk/sessions.sqlite`. Ambos sobreviven al reinicio y están excluidos de Git. No borres el registro de consumo si quieres conservar el límite. El mes se calcula con hora de Ecuador.

```powershell
npm run agents:status
```

Muestra `accountedUsd` (uso contabilizado más reservas), `reservedUsd`, `limitUsd` y número de llamadas. Cada turno admite hasta ocho generaciones y no reintenta automáticamente la petición HTTP al modelo. Si falta saldo, hay un error o se excede el contexto, la consulta pasa a David.

Modelo admitido en este modo: `gemini-3.5-flash`, endpoint `global`, tarifas estándar verificadas el 23 de noviembre de 2026: USD 1,50 por millón de tokens de entrada y USD 9 por millón de salida. No se cambia a un modelo con tarifa desconocida. [Fuente oficial de precios](https://cloud.google.com/model-garden/pricing).

El registro es una protección de esta aplicación basada en las tarifas indicadas; no sustituye la factura de Google ni limita otros servicios, impuestos, otros programas que usen el proyecto o futuros cambios de precio. Los servicios ya existentes en Cloud Run y Firestore se facturan por separado. Para el objetivo global de menos de USD 10 se conserva margen y se revisan esos cargos antes de activar el agente en producción.

## Credenciales y recuperación

Usa `gcloud auth application-default login` si las credenciales expiran y `gcloud auth application-default set-quota-project manabit-sistema` para la cuota. No se necesita una API key ni un archivo de clave de cuenta de servicio. El token entre Next.js y el puente ADK solo se transmite por loopback.

Una sesión está ligada a la audiencia y al contacto creado por el backend. Un identificador ajeno se rechaza. Los errores del modelo no se presentan como respuestas exitosas; se crea la atención pendiente para David.

Para volver al modo guiado, deja vacía `MANABIT_LOCAL_ADK_URL` en `.env.local` y reinicia Next.js. Los identificadores de runtimes remotos se conservan. El puente local se rechaza en Cloud Run para evitar publicar por accidente una configuración del equipo.
