import asyncio
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from pilot_budget import PilotBudget, BudgetExceeded


class BudgetTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.filename = Path(self.directory.name) / "budget.sqlite"

    def tearDown(self):
        self.directory.cleanup()

    def test_parallel_reservations_cannot_overspend(self):
        budget = PilotBudget(self.filename, 0.04)
        def attempt(_):
            try:
                return budget.reserve()
            except BudgetExceeded:
                return None
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(attempt, range(4)))
        self.assertEqual(sum(bool(item) for item in results), 1)
        self.assertLessEqual(budget.status()["accountedUsd"], 0.04)

    def test_usage_survives_restart_and_settlement_is_idempotent(self):
        first = PilotBudget(self.filename)
        identifier = first.reserve()
        second = PilotBudget(self.filename)
        self.assertEqual(second.status()["calls"], 1)
        second.settle(identifier, 100, 50)
        second.settle(identifier, 10000, 500)
        self.assertEqual(second.status()["accountedUsd"], 0.0006)
        self.assertEqual(second.status()["reservedUsd"], 0)

    def test_failed_turn_keeps_its_conservative_reservation(self):
        first = PilotBudget(self.filename)
        first.reserve()
        self.assertGreater(PilotBudget(self.filename).status()["reservedUsd"], 0)


class CallbackTest(unittest.IsolatedAsyncioTestCase):
    async def test_large_context_rejected_before_a_generation_is_reserved(self):
        with tempfile.TemporaryDirectory() as directory:
            count = AsyncMock(return_value=SimpleNamespace(total_tokens=12001))
            client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(count_tokens=count)))
            budget = PilotBudget(Path(directory) / "budget.sqlite", client=client)
            request = SimpleNamespace(model=budget.MODEL, contents=[], config=SimpleNamespace(system_instruction="", tools=[]))
            with self.assertRaises(BudgetExceeded):
                await budget.before_model(SimpleNamespace(state={}), request)
            self.assertEqual(budget.status()["calls"], 0)


class GatewayTest(unittest.TestCase):
    def test_private_endpoint_and_owner_identity_are_checked_before_model(self):
        from local_server import build_app
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"MANABIT_ADK_DATA_DIR": directory, "MANABIT_LOCAL_ADK_TOKEN": "x" * 40}):
                with TestClient(build_app()) as client:
                    self.assertEqual(client.get("/status").status_code, 401)
                    response = client.post("/query", headers={"Authorization": "Bearer " + "x" * 40},
                        json={"audience": "owner", "user": "manabit:" + "a" * 24, "message": "Dame las métricas"})
                    self.assertEqual(response.status_code, 403)
                    self.assertEqual(client.get("/status", headers={"Authorization": "Bearer " + "x" * 40}).json()["calls"], 0)
