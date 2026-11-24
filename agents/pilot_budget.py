"""Límite local compartido entre los seis agentes. Importes en microdólares."""
import math
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4
from google import genai
from google.genai import types


class BudgetExceeded(RuntimeError):
    pass


class PilotBudget:
    # Vertex AI, Gemini 3.5 Flash global, precios estándar revisados 2026-11-23.
    MODEL = "gemini-3.5-flash"
    MAX_INPUT = 12000
    MAX_OUTPUT = 1200
    INPUT_RATE = 1.5
    OUTPUT_RATE = 9

    def __init__(self, filename, limit_usd=8, client=None):
        if not 0 < limit_usd <= 8:
            raise ValueError("El piloto admite un límite mensual de hasta USD 8.")
        self.filename = str(filename)
        self.limit = int(limit_usd * 1_000_000)
        self.client = client
        Path(filename).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY, month TEXT NOT NULL, amount INTEGER NOT NULL, settled INTEGER NOT NULL DEFAULT 0)")

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.filename, timeout=10)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    @staticmethod
    def month():
        return datetime.now(timezone(timedelta(hours=-5))).strftime("%Y-%m")

    def status(self):
        with self.connect() as db:
            row = db.execute("SELECT COALESCE(SUM(amount),0), COUNT(*), COALESCE(SUM(CASE WHEN settled=0 THEN amount ELSE 0 END),0) FROM calls WHERE month=?", (self.month(),)).fetchone()
        return {"month": self.month(), "limitUsd": self.limit / 1_000_000,
                "accountedUsd": row[0] / 1_000_000, "calls": row[1],
                "reservedUsd": row[2] / 1_000_000, "model": self.MODEL}

    def reserve(self):
        # Se reserva el máximo antes de enviar cada generación, incluso si luego falla.
        ceiling = math.ceil(self.MAX_INPUT * self.INPUT_RATE + self.MAX_OUTPUT * self.OUTPUT_RATE)
        identifier = uuid4().hex
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            spent = db.execute("SELECT COALESCE(SUM(amount),0) FROM calls WHERE month=?", (self.month(),)).fetchone()[0]
            if spent + ceiling > self.limit:
                raise BudgetExceeded("El piloto llegó al límite mensual de Gemini. David puede continuar la conversación.")
            db.execute("INSERT INTO calls(id,month,amount) VALUES(?,?,?)", (identifier, self.month(), ceiling))
        return identifier

    def settle(self, identifier, prompt_tokens, output_tokens):
        amount = math.ceil(prompt_tokens * self.INPUT_RATE + output_tokens * self.OUTPUT_RATE)
        with self.connect() as db:
            # Un resultado final duplicado no vuelve a modificar el consumo.
            db.execute("UPDATE calls SET amount=?,settled=1 WHERE id=? AND settled=0", (amount, identifier))

    async def before_model(self, callback_context, llm_request):
        if llm_request.model != self.MODEL:
            raise BudgetExceeded("El modelo no tiene una tarifa verificada para el piloto.")
        if self.client is None:
            self.client = genai.Client(vertexai=True, http_options=types.HttpOptions(timeout=15000, retry_options=types.HttpRetryOptions(attempts=1)))
        count = await self.client.aio.models.count_tokens(
            model=self.MODEL, contents=llm_request.contents,
            config=types.CountTokensConfig(system_instruction=llm_request.config.system_instruction,
                                          tools=llm_request.config.tools),
        )
        if count.total_tokens is None or not 0 < count.total_tokens <= self.MAX_INPUT:
            raise BudgetExceeded("La conversación excede el contexto permitido del piloto. Solicita atención de David.")
        llm_request.config.max_output_tokens = self.MAX_OUTPUT
        llm_request.config.http_options = types.HttpOptions(timeout=15000, retry_options=types.HttpRetryOptions(attempts=1))
        identifier = self.reserve()
        callback_context.state["temp:pilot_call"] = identifier

    async def after_model(self, callback_context, llm_response):
        if llm_response.partial:
            return
        identifier = callback_context.state.get("temp:pilot_call")
        usage = llm_response.usage_metadata
        if identifier and usage and usage.prompt_token_count is not None and usage.candidates_token_count is not None:
            self.settle(identifier, usage.prompt_token_count,
                        usage.candidates_token_count + (usage.thoughts_token_count or 0))
            callback_context.state["temp:pilot_call"] = ""

    def attach(self, agent):
        agent.before_model_callback = self.before_model
        agent.after_model_callback = self.after_model
        for child in agent.sub_agents:
            self.attach(child)
