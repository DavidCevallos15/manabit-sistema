# Piloto ADK / Vertex AI · 23 de noviembre de 2026

- 23 pruebas Node correctas; 4 pruebas Firestore omitidas porque no se arrancó el emulador en esta verificación.
- 10 pruebas Python correctas: incluye aislamiento del puente, persistencia de consumo, reservas concurrentes de saldo y rechazo de contexto excesivo.
- Llamadas reales a Gemini 3.5 Flash en `manabit-sistema`: Asesor explicó Tongabit, Agenda consultó y propuso el 25 de noviembre a las 10:00 en el negocio de prueba, el backend confirmó tras el código del cliente y la cancelación liberó el espacio. Soporte derivó a David y pausó la automatización. Gerente consultó métricas e Ideas devolvió un borrador.
- Compilación de producción, comprobación de tipos y prueba HTTP de producción correctas con Next.js 16.4.6. La prueba HTTP desactiva el puente para no generar consumo ni mezclar datos reales.
- La recepción se probó también en el navegador, conservando el diseño de Manabit. Captura: `images/piloto-gemini.jpg`.
- Consumo estimado registrado durante esas pruebas: USD 0,083953, 17 generaciones, sin reservas pendientes. No es una factura del proveedor.
- Next.js actualizado de 16.4.3 a 16.4.6 para corregir el aviso verificado por npm audit. Quedan cuatro hallazgos moderados transitivos en la cadena google-gax/rimraf/glob/minimatch del adaptador Firestore; `npm audit fix` no los resolvió dentro de las versiones declaradas. No se forzaron actualizaciones incompatibles.
- Se verificó que ya existe un servicio Cloud Run con Firestore. Este cambio activa el agente únicamente en el equipo local; no se desplegaron runtimes ni se modificó el servicio publicado.

## Verificación inicial (histórica)

Verificación de la entrega inicial

- Node 24: 21 pruebas correctas de motor, persistencia SQLite, turnos, propuestas, firmas y permisos.
- Python: 5 pruebas correctas; grafos separados, ausencia de confirmación directa, fallo de herramienta sin configuración y serialización de ambos AdkApp con el SDK instalado.
- `npm run typecheck`: correcto.
- `npm run build`: correcto; Next.js 16.4.3, salida standalone.
- `npm run verify:production`: arranca el build con datos temporales, verifica login y sesión, rechaza panel sin propietario, POST de origen ajeno y token público en herramientas internas, y responde en el chat público.
- Paquete de despliegue ADK revisado con `deploy.py` sin `--execute`; no se creó un runtime ni se hicieron llamadas a Gemini.
- Navegador: planes, reserva presencial con dirección, cita visible en agenda, cancelación que libera el horario, derivación humana y respuesta manual visible en el chat.
- Configuración guardada con el horario confirmado. La reserva de prueba está cancelada y la conversación se identificó como simulación.
- Responsive: estructura de escritorio 1440 × 900 sin desbordamiento horizontal; menú, agentes y recepción a 390 px, revisados también en iframe de ese ancho porque la captura de Chrome con viewport emulado falló. Se corrigieron el encaje vertical del chat y una colisión de estilo del mensaje de David.
- Detector de Impeccable: sin hallazgos. Lint de Taste con modo app: sin errores; advertencia de cero inicial revisada como formato real de reloj.

- Firestore (27/10/2026): 11 pruebas contra el emulador (5 de contrato: 4 reservas simultáneas, idempotencia, cancelación, claim, caché, leases y límites; 6 del sistema con `DATABASE_BACKEND=firestore`), `verify:production` y build standalone con `K_SERVICE` sobre Firestore.

No verificado: Firestore real, PostgreSQL real, imagen Docker (daemon no disponible), runtime Google de una cuenta, costes/cuotas del proyecto, permisos y entregas de redes, ni sincronización con Google Calendar. Estos puntos forman parte de la activación posterior, no de la demo local.
