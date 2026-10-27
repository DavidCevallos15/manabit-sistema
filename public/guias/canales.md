# Conectar canales a Manabit

El canal principal de operación es el **panel de Manabit**. Cada cliente escribe por la red que ya utiliza. Telegram puede añadirse, pero no obliga a mover allí a tus clientes.

## Estado de esta entrega

Solo el chat web funciona sin cuentas externas. Las simulaciones de Canales son locales y están etiquetadas como prueba. No equivalen a una conexión ni hacen envíos a redes. Los adaptadores están escritos, pero sus contratos y permisos aún deben probarse con las cuentas reales de David.

| Canal | Cuenta necesaria | Entrada preparada | Pendiente de activar |
| --- | --- | --- | --- |
| Web | Ninguna | /reservar | Desplegar URL pública cuando corresponda |
| WhatsApp | Número habilitado en WhatsApp Business Platform / Cloud API | /api/webhooks/meta | App Meta, WABA, permisos, token, número y prueba |
| Instagram | Cuenta profesional compatible con la API de mensajes | /api/webhooks/meta | Login, permisos, suscripciones y prueba |
| Messenger | Página de Facebook con permisos de mensajería | /api/webhooks/meta | Página, token, permisos y prueba |
| Telegram | Bot propio | /api/webhooks/telegram | Bot token y secreto de webhook |

WhatsApp personal no se conecta directamente con este adaptador. Tener instalada la aplicación WhatsApp Business tampoco configura Cloud API automáticamente: la habilitación del número y, si aplica, la coexistencia se validan en el proceso oficial de Meta. No se usa automatización de WhatsApp Web mediante QR.

Los mensajes privados de Marketplace personal no se presentan como una integración garantizada. Primero revisa qué acceso oficial tiene la cuenta y el flujo comercial concreto; mientras tanto pueden dirigir al chat de Manabit o a un canal autorizado.

## Meta

1. Crea y configura tu app de Meta para la cuenta elegida. Revisa roles de prueba, revisión de permisos y requisitos de tu modalidad de login antes de abrirla a otros clientes.
2. Selecciona una versión vigente para tu aplicación y configura `META_GRAPH_VERSION` con formato `vN.N`; el código no inventa una versión fija.
3. Configura `META_APP_SECRET` y `META_VERIFY_TOKEN` en el servidor. Para WhatsApp: `WHATSAPP_PHONE_NUMBER_ID` y `WHATSAPP_ACCESS_TOKEN`; para Instagram: `INSTAGRAM_ACCOUNT_ID` y `INSTAGRAM_ACCESS_TOKEN`; para Messenger: `MESSENGER_PAGE_ID` y `MESSENGER_ACCESS_TOKEN`.
4. Usa el callback HTTPS `/api/webhooks/meta` y el verify token configurado. Suscribe los eventos de mensajes de la cuenta correspondiente.
5. Mantén la respuesta automática pausada mientras verificas que llegan eventos válidos. El servidor comprueba HMAC SHA-256, ignora ecos y descarta IDs de cuenta ajenos. El estado «Recibiendo» demuestra un evento validado, no entrega garantizada ni permiso universal.
6. Verifica el worker de recuperación descrito en Google Cloud. Después cambia `SOCIAL_AUTOMATION_ENABLED=true` y prueba con un mensaje autorizado de tu propia cuenta de prueba.
7. Confirma en el proveedor que el mensaje llegó. Comprueba después la derivación a David y que responder manualmente pausa el asistente.

El adaptador de Instagram usa el endpoint `graph.instagram.com/.../IG_ID/messages`, correspondiente al flujo de Instagram Login. Si eliges Facebook Login, revisa y adapta su host/token antes de habilitarlo; no mezcles los dos contratos.

Los envíos de Meta se limitan de manera conservadora a las 24 horas desde el último mensaje entrante. Las excepciones, etiquetas, plantillas y mensajería iniciada por la empresa no están implementadas. No hay campañas ni mensajes promocionales. Audio, imágenes y archivos se derivan a David; el sistema no los interpreta.

## Telegram

Crea un bot y configura `TELEGRAM_BOT_TOKEN` y `TELEGRAM_WEBHOOK_SECRET`. Registra el webhook oficial del bot hacia `/api/webhooks/telegram` con `secret_token` igual al secreto del servidor. Solo procesa chats privados con texto. No uses un token de Telegram como secreto de herramientas ni de sesión.

## Entregas y reintentos

Cada evento entrante tiene una clave de deduplicación. La respuesta se guarda antes de enviar, y una entrega confirmada por HTTP se registra para no repetirla normalmente. Si el proveedor devuelve error, el evento queda fallido en el panel. Si hay timeout o caída entre envío y persistencia, podría haber sido entregado: revisa la cuenta antes de reintentar. No se ofrece garantía «exactamente una vez» entre proveedores externos.

Los adaptadores aún no procesan todos los estados de lectura/entrega o errores asíncronos de Meta. Un HTTP aceptado no equivale a lectura por el cliente.

## Referencias oficiales

- [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/)
- [Instagram Messaging con Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api)
- [Messenger Platform](https://developers.facebook.com/docs/messenger-platform/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
