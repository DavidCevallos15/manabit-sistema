# Prueba web de Manabit

## Abrir el proyecto

Desde la carpeta del proyecto:

```powershell
npm ci
npm run dev
```

Abre http://127.0.0.1:3100 para el panel y http://127.0.0.1:3100/reservar para simular un cliente. El servidor solo escucha en loopback. En este modo de desarrollo el panel abre sin contraseña; no expongas `next dev` como servidor público.

## Recorrido de prueba

1. En recepción, pulsa Ver planes. Comprueba los tres planes de Manabit.
2. Abre Elegir horario. Elige una fecha entre lunes y viernes y un horario futuro.
3. Selecciona En mi negocio y escribe nombre, contacto y dirección de prueba. Acepta los datos y confirma.
4. Abre Agenda en el panel; la cita debe aparecer en segundos. El panel refresca cada ocho segundos cuando la pestaña está visible.
5. Cancela esa cita de prueba. Comprueba que el horario vuelve a estar libre.
6. En el chat pulsa Hablar con David. En Conversaciones responde manualmente. La automatización queda pausada hasta seleccionar Asistente activo en el estado de la conversación.
7. En Canales puedes simular un mensaje entrante por red. Solo guarda datos locales y aparece etiquetado como prueba; no envía nada a cuentas externas.

Los datos sobreviven al reiniciar en `.data/manabit.sqlite`. Las pruebas automatizadas usan un directorio temporal distinto. La prueba visual de esta entrega dejó una cita de prueba cancelada, sin ocupar disponibilidad.

## Personalizar Manabit

Configuración permite horario, duración, pausa de agenda, enlace fijo y nota de videollamada. Sin enlace, se indica que David lo compartirá. Los planes y el perfil base están en `src/server/profile.ts`. El número de Manabit es +593 97 910 7716.

## Activar Gemini

Sigue [Google Cloud](GOOGLE-CLOUD.md). El chat guiado permite validar reserva, datos y atención humana antes de pagar por llamadas al modelo. Cuando crees el proyecto, basta compartir su ID para continuar la configuración; no compartas claves o tokens en una conversación.
