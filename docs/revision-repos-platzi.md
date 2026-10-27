# Viabilidad de los repositorios de Platzi

Sí sirven como bases conceptuales complementarias: interfaz/proxy y conjunto ADK. Se revisó el código; no se instalaron dependencias ni se invocaron agentes, corpus o servicios de Google del curso.

## Frontend

`platzi/google-agent-platform-frontend`, rama `develop`, revisión `600e09c9a4209cff4b44969f3f2e6089be5559de`.

Aporta Next.js, proxy de servidor, credenciales ADC, streaming y verificación de IAP al crear sesión cuando hay encabezado firmado. Consume un agente ya desplegado; no crea su lógica.

Antes de usarlo como producto multiempresa:

- `src/lib/env.ts` selecciona un recurso de agente global. Añadir resolución autorizada del negocio y su configuración.
- `src/app/api/chat/route.ts` acepta `userId` y `sessionId` del cuerpo y no vuelve a comprobar ahí identidad IAP y pertenencia. Resolver ambos desde la sesión autorizada en cada llamada.
- `src/app/api/session/route.ts` usa email como clave de memoria. Introducir identificadores internos y ámbito de negocio/audiencia/conversación.
- La ruta de chat intenta importar la sesión completa a Memory Bank al terminar cada stream. Definir retención selectiva para consultorios y usar trabajo persistente si se requiere garantizar el guardado.
- Faltan roles, bandeja multicanal, agenda y persistencia operativa.
- Revisar el contenedor: copia `/app/public`, pero no hay directorio `public` versionado en la revisión inspeccionada.

## ADK

`platzi/adk2.5-google`, rama `main`, revisión `7417416dad7e82d5b1d2f6791ef6f12e9a9e177f`.

`app/agent.py` define router y cuatro especialistas con `sub_agents`. Es el patrón adecuado para comenzar. Las fuentes operativas necesitan sustitución:

- `pedidos.py`: datos de ejemplo dentro del prompt.
- `escalamiento.py`: ticket generado como texto, sin registro real.
- `tools/recomendaciones.py`: catálogo de una API pública de pruebas.
- `tools/RAG.py`: proyecto y corpus del curso fijados en código.
- `requirements.txt`: dependencias sin bloqueo exacto; fijarlas y probarlas para despliegues reproducibles.
- Modelos de ejemplo de varios proveedores: seleccionar por disponibilidad, necesidad y coste del negocio, no mantenerlos por obligación.

Se revisó también `main-production-grade`, revisión `27dd8823d6ace15bb1eef52bfadb9a91b636068f`. Separa y refuerza prompts, pero mantiene pedidos, catálogo y tickets de demostración. Su README declara esos límites. El nombre de la rama no valida la plataforma completa para producción.

En el árbol de esa rama aparece una base local de sesiones. No se abrió ni se incorpora a Manabit. Al preparar una base propia se excluyen bases locales y datos de conversación.

## Reutilización

No se encontró un archivo LICENSE en las revisiones inspeccionadas; aclarar permisos antes de incorporar código a un producto comercial. Por ahora se conservan copias de referencia sin modificaciones y Manabit tiene su propio núcleo local.

La viabilidad técnica está apoyada por la estructura del código. La viabilidad de un despliegue concreto requiere probar los métodos de sesión/streaming del agente, sus modelos y las credenciales de la cuenta del usuario. No se hicieron esas pruebas en esta revisión.
