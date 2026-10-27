# Adaptación futura: consultorio

El primer piloto vigente es Manabit. Este documento se conserva como referencia de evolución, sin reglas de atención clínica activadas.

Para adaptar la base a un consultorio habrá que definir servicios, profesionales, duración, horarios, política de confirmación, ubicación, permisos de recepción y datos mínimos. El asistente gestionará consultas administrativas y citas; no hará diagnósticos clínicos. Los perfiles de consultorio y barbería de `src/core/presets.ts` son ficticios y se usan únicamente en pruebas del motor.

Antes de incorporar un segundo negocio se necesita identidad y aislamiento multiempresa en API, almacenamiento y sesiones remotas. Cambiar textos y colores no basta para aislar los datos de pacientes.
