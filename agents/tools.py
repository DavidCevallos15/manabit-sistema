"""Herramientas ADK. La API de Manabit decide permisos, horarios y escrituras."""
import os
import asyncio
import base64
from functools import lru_cache
import httpx
from google.adk.tools import ToolContext


@lru_cache(maxsize=2)
def _read_secret(version_name: str) -> str:
    """Carga solo el secreto declarado por el despliegue, nunca un nombre del modelo."""
    import google.auth
    from google.auth.transport.requests import AuthorizedSession
    credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    with AuthorizedSession(credentials) as session:
        response = session.get(f"https://secretmanager.googleapis.com/v1/{version_name}:access", timeout=10)
        response.raise_for_status()
        return base64.b64decode(response.json()["payload"]["data"]).decode("utf-8")


async def _call(action: str, args: dict, audience: str = "customer", user_id: str = "") -> dict:
    base = os.getenv("MANABIT_TOOLS_API_URL", "").rstrip("/")
    token = os.getenv("MANABIT_OWNER_TOOLS_TOKEN" if audience == "owner" else "MANABIT_TOOLS_TOKEN", "")
    if not token:
        version = os.getenv("MANABIT_OWNER_TOOLS_SECRET_VERSION" if audience == "owner" else "MANABIT_TOOLS_SECRET_VERSION", "")
        if version:
            try:
                token = await asyncio.to_thread(_read_secret, version)
            except Exception:
                return {"ok": False, "error": "No se pudo autorizar la herramienta. Solicita revisión de David."}
    if not base or len(token) < 32:
        return {"ok": False, "error": "La herramienta no está conectada. No afirmes que se ejecutó una acción."}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(f"{base}/api/tools/{audience}",
                headers={"Authorization": f"Bearer {token}"},
                json={"action": action, "args": args, "userId": user_id})
            if response.status_code >= 400:
                return {"ok": False, "error": response.json().get("error", "La operación fue rechazada.")}
            return {"ok": True, "result": response.json()}
    except (httpx.HTTPError, ValueError):
        return {"ok": False, "error": "La herramienta no respondió. Ofrece atención de David y no inventes un resultado."}


async def conocer_manabit(tool_context: ToolContext) -> dict:
    """Consulta servicios, planes y datos aprobados de Manabit. No contiene precios cerrados."""
    owner = tool_context.agent_name in ("manabit_gerente", "manabit_ideas")
    return await _call("knowledge", {}, "owner" if owner else "customer", tool_context.user_id)


async def consultar_disponibilidad(fecha: str, tool_context: ToolContext) -> dict:
    """Consulta horarios reales. fecha debe ser YYYY-MM-DD en Ecuador. No crea reservas."""
    return await _call("availability", {"date": fecha}, user_id=tool_context.user_id)


async def proponer_diagnostico(inicio: str, modalidad: str, direccion: str, tool_context: ToolContext) -> dict:
    """Prepara un resumen y código de aceptación; NO confirma la cita.

    inicio: ISO con offset -05:00 de un horario devuelto por disponibilidad.
    modalidad: videollamada o presencial. direccion: negocio y dirección si presencial; vacía en videollamada.
    La persona debe escribir exactamente CONFIRMAR seguido del código devuelto.
    """
    return await _call("proposal", {"startAt": inicio, "mode": modalidad, "address": direccion}, user_id=tool_context.user_id)


async def derivar_a_david(motivo: str, tool_context: ToolContext) -> dict:
    """Crea una tarea real para David y pausa la automatización en esta conversación."""
    return await _call("handoff", {"reason": motivo}, user_id=tool_context.user_id)


async def consultar_resultados(tool_context: ToolContext) -> dict:
    """Lee métricas reales de Manabit para el responsable. Solo existe en el agente interno."""
    return await _call("metrics", {}, "owner", tool_context.user_id)


async def guardar_borrador(texto: str, tool_context: ToolContext) -> dict:
    """Guarda una propuesta de contenido para David. No la publica ni la envía a redes."""
    return await _call("draft", {"text": texto}, "owner", tool_context.user_id)
