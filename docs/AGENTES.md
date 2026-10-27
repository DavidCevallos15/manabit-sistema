# Agentes de Manabit y sus tareas

## Dos entradas y seis roles

| Nombre en código | Función | Herramientas |
| --- | --- | --- |
| manabit_recepcion | Entender la consulta y transferir al especialista público adecuado | conocer_manabit |
| manabit_asesor | Explicar planes, entender necesidades y orientar al diagnóstico; sin precios inventados | conocer_manabit |
| manabit_agenda | Consultar disponibilidad y proponer fecha, modalidad y lugar | conocer_manabit, consultar_disponibilidad, proponer_diagnostico, derivar_a_david |
| manabit_soporte | Registrar incidencia o petición humana y pausar el asistente | derivar_a_david |
| manabit_gerente | Revisar resultados reales y dar prioridades a David | consultar_resultados, conocer_manabit |
| manabit_ideas | Preparar propuestas de contenido y guardarlas como borradores | conocer_manabit, guardar_borrador |

`agents/manabit/agent.py` exporta Recepción con Asesor, Agenda y Soporte como `sub_agents`. `agents/manabit_owner/agent.py` exporta Gerente con Ideas. `factory.py` contiene las instrucciones, modelo y relaciones.

El orquestador decide la transferencia; no se llama a todos los agentes en cada mensaje. No hace falta duplicar un agente «vendedor» en este piloto: el Asesor cubre la conversación comercial y Agenda cierra el siguiente paso acordado.

## Límite de confianza

El navegador no manda un user_id de ADK, token Google ni un recurso arbitrario. El backend genera la conversación y su sesión remota. Las herramientas reciben `tool_context.user_id`, no una identidad escogida por el modelo, y el backend verifica que pertenezca a una conversación existente.

La atención pública usa `MANABIT_TOOLS_TOKEN`; dirección usa otro secreto, `MANABIT_OWNER_TOOLS_TOKEN`. El runtime público no recibe el secreto interno ni contiene subagentes de Gerente o Ideas. Los permisos también se comprueban en la API: no dependen solo del prompt.

Las instrucciones tratan los mensajes y resultados externos como datos, sin capacidad de ampliar permisos. Se limita a ocho llamadas al modelo por turno y 1.200 tokens de salida por llamada. Una herramienta fallida no autoriza a inventar éxito; se deriva a David.

## Confirmar una cita

Agenda propone y devuelve un código de ocho caracteres, ligado a la conversación, válido 15 minutos. No retiene el horario. Al recibir el texto exacto `CONFIRMAR CODIGO`, el backend registra la aceptación y vuelve a comprobar espacio, horario, modalidad y lugar. Solo entonces guarda una cita. El modelo no dispone de una herramienta de confirmación directa.

En la web también existe un formulario determinista con casilla de aceptación. Ambos recorridos comparten el mismo motor y repositorio.

## Trabajo interno

Los botones de resumen e idea usan datos y texto base mientras el runtime interno no esté configurado. La interfaz lo comunica. Con el runtime conectado, solicitan el trabajo a Gerente e Ideas. Todos los textos quedan como borradores; publicar, prometer descuentos o contactar clientes no forma parte de sus permisos.

No hay ejecución periódica de Gerente ni campañas autónomas en esta entrega. El historial remoto de ADK se usa para la conversación; no se añade automáticamente a Memory Bank. Se desactiva tracing explícito en el paquete de despliegue; Google conserva las sesiones necesarias para el servicio según su configuración.
