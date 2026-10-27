# Arquitectura de agentes en Google Cloud

La arquitectura vigente del piloto Manabit está implementada en [arquitectura.md](arquitectura.md). Los nombres, subagentes y permisos están en [AGENTES.md](AGENTES.md) y el procedimiento de despliegue en [GOOGLE-CLOUD.md](GOOGLE-CLOUD.md).

El primer piloto cambió de consultorio al propio negocio Manabit por decisión de David. La atención pública y la dirección interna se despliegan por separado, con secretos y herramientas distintos. El frontend y ADK del curso de Platzi sirven como referencias revisadas; el sistema usa código propio y datos de Manabit.

Elegimos Cloud Run para la web/API, Cloud SQL PostgreSQL para datos, Agent Runtime para ADK, Secret Manager para secretos y Cloud Logging para operación. Las redes son adaptadores del backend, no agentes con calendarios separados. Google Calendar y colas de Cloud Tasks/Pub/Sub son próximos módulos, no conexiones activas de esta entrega.
