"""Puente privado entre Next.js local y los grafos ADK, con Gemini en Vertex AI."""
import asyncio
import hmac
import logging
import os
from pathlib import Path
from typing import Literal
from contextlib import asynccontextmanager
from uuid import uuid4
from fastapi import FastAPI, Header, HTTPException, Depends
from pydantic import BaseModel, Field
from google.adk import Runner
from google.adk.agents import RunConfig
from google.adk.sessions import DatabaseSessionService
from google.genai import types
from factory import customer_agent, owner_agent
from pilot_budget import PilotBudget, BudgetExceeded


class Query(BaseModel):
    audience: Literal["customer", "owner"] = "customer"
    user: str = Field(min_length=8, max_length=100)
    message: str = Field(min_length=1, max_length=4000)
    session: str | None = Field(default=None, max_length=100)


def authorize(authorization: str = Header(default="")):
    token = os.environ.get("MANABIT_LOCAL_ADK_TOKEN", "")
    if len(token) < 32 or not hmac.compare_digest(authorization, f"Bearer {token}"):
        raise HTTPException(401, "Puente ADK no autorizado.")


def build_app():
    directory = Path(os.getenv("MANABIT_ADK_DATA_DIR", ".data/adk")).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    budget = PilotBudget(directory / "usage.sqlite", float(os.getenv("MANABIT_PILOT_BUDGET_USD", "8")))
    sessions = DatabaseSessionService(db_url=f"sqlite+aiosqlite:///{(directory / 'sessions.sqlite').as_posix()}")
    runners = {}
    for audience, graph in [("customer", customer_agent()), ("owner", owner_agent())]:
        budget.attach(graph)
        runners[audience] = Runner(agent=graph, app_name=f"manabit_pilot_{audience}", session_service=sessions)

    @asynccontextmanager
    async def lifespan(app):
        yield
        await sessions.close()
        if budget.client:
            await budget.client.aio.aclose()

    app = FastAPI(title="Manabit · ADK local", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    locks = {"customer": asyncio.Lock(), "owner": asyncio.Lock()}

    @app.get("/health")
    async def health():
        return {"ok": True, "mode": "local-adk-vertex"}

    @app.get("/status", dependencies=[Depends(authorize)])
    async def status():
        return budget.status()

    @app.post("/query", dependencies=[Depends(authorize)])
    async def query(value: Query):
        import re
        valid = value.user == "manabit:owner:david" if value.audience == "owner" else re.fullmatch(r"manabit:[a-f0-9]{24}", value.user)
        if not valid:
            raise HTTPException(403, "La identidad no corresponde a esta audiencia.")
        runner = runners[value.audience]
        async with locks[value.audience]:
            session = await sessions.get_session(app_name=runner.app_name, user_id=value.user, session_id=value.session) if value.session else None
            if value.session and not session:
                raise HTTPException(403, "La sesión no pertenece a este contacto.")
            if not session:
                session = await sessions.create_session(app_name=runner.app_name, user_id=value.user, session_id=uuid4().hex)
            text, author, tools = [], "manabit_recepcion", []
            try:
                async with asyncio.timeout(80):
                    async for event in runner.run_async(user_id=value.user, session_id=session.id,
                            new_message=types.Content(role="user", parts=[types.Part(text=value.message)]),
                            run_config=RunConfig(max_llm_calls=8)):
                        if event.error_code:
                            raise RuntimeError("El modelo no completó el turno.")
                        if event.partial:
                            continue
                        for part in event.content.parts if event.content else []:
                            if part.function_call:
                                tools.append(part.function_call.name)
                            if part.text and not part.thought:
                                text.append(part.text)
                                author = event.author
                if not text:
                    raise RuntimeError("El agente terminó sin texto visible.")
                return {"text": "\n".join(text), "session": session.id, "author": author,
                        "toolsUsed": tools, "budget": budget.status()}
            except BudgetExceeded as error:
                raise HTTPException(429, str(error)) from error
            except Exception as error:
                # El registro local identifica el fallo sin volcar datos ni credenciales.
                logging.getLogger("manabit").error("ADK no completó el turno: %s", type(error).__name__)
                raise HTTPException(502, "No se completó la respuesta de Gemini. Revisa las credenciales, el modelo o el registro local.") from error

    return app


if __name__ == "__main__":
    import uvicorn
    if os.environ.get("K_SERVICE"):
        raise RuntimeError("Este puente es para pruebas locales; no se publica en Cloud Run.")
    if len(os.environ.get("MANABIT_LOCAL_ADK_TOKEN", "")) < 32:
        raise RuntimeError("Ejecuta npm run agents:local para preparar la configuración privada.")
    uvicorn.run(build_app(), host="127.0.0.1", port=8001, access_log=False)
