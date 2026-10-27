import unittest
from unittest.mock import AsyncMock, patch
import os
from factory import customer_agent, owner_agent
from tools import _call


class GraphTest(unittest.TestCase):
    def test_customer_graph_has_only_public_specialists(self):
        root = customer_agent()
        self.assertEqual(root.name, "manabit_recepcion")
        self.assertEqual({a.name for a in root.sub_agents}, {"manabit_asesor", "manabit_agenda", "manabit_soporte"})
        self.assertNotIn("manabit_gerente", {a.name for a in root.sub_agents})

    def test_owner_graph_is_separate(self):
        root = owner_agent()
        self.assertEqual(root.name, "manabit_gerente")
        self.assertEqual([a.name for a in root.sub_agents], ["manabit_ideas"])
        self.assertEqual({t.__name__ for t in root.tools}, {"consultar_resultados", "conocer_manabit"})

    def test_agenda_proposes_but_cannot_directly_confirm(self):
        agenda = next(a for a in customer_agent().sub_agents if a.name == "manabit_agenda")
        self.assertIn("proponer_diagnostico", {t.__name__ for t in agenda.tools})
        self.assertNotIn("reservar_diagnostico", {t.__name__ for t in agenda.tools})

    def test_runtime_wrappers_can_be_serialized_without_cloud_calls(self):
        import cloudpickle
        import vertexai
        from vertexai.agent_engines import AdkApp
        vertexai.init(project="local-package-check", location="us-central1")
        for graph in [customer_agent(), owner_agent()]:
            app = AdkApp(agent=graph, enable_tracing=False)
            self.assertIsInstance(cloudpickle.loads(cloudpickle.dumps(app)), AdkApp)


class ToolTest(unittest.IsolatedAsyncioTestCase):
    async def test_missing_configuration_does_not_claim_success(self):
        with patch.dict(os.environ, {"MANABIT_TOOLS_API_URL": "", "MANABIT_TOOLS_TOKEN": ""}):
            result = await _call("proposal", {})
        self.assertFalse(result["ok"])


if __name__ == "__main__":
    unittest.main()
