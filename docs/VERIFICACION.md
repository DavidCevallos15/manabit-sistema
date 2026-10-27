# Verificación de esta entrega

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

No verificado: PostgreSQL real, imagen Docker (daemon no disponible), runtime Google de una cuenta, costes/cuotas del proyecto, permisos y entregas de redes, ni sincronización con Google Calendar. Estos puntos forman parte de la activación posterior, no de la demo local.
