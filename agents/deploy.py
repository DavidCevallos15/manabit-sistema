"""Revisa el paquete sin red; --execute crea UN runtime en el proyecto indicado."""
import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlparse
import vertexai
from vertexai import types
from vertexai.agent_engines import AdkApp
from factory import customer_agent, owner_agent


def build_config(args):
    root = Path(__file__).resolve().parent
    scope = "OWNER_TOOLS" if args.audience == "owner" else "TOOLS"
    env = {
        "GOOGLE_GENAI_USE_VERTEXAI": "TRUE",
        "GOOGLE_CLOUD_PROJECT": args.project,
        "GOOGLE_CLOUD_LOCATION": args.model_location,
        "MANABIT_GEMINI_MODEL": args.model,
        "MANABIT_TOOLS_API_URL": args.api_url.rstrip("/"),
        f"MANABIT_{scope}_SECRET_VERSION": args.secret_version,
    }
    return types.AgentEngineConfig(
        display_name=f"manabit-{'direccion' if args.audience == 'owner' else 'atencion'}",
        description="Agentes internos de David" if args.audience == "owner" else "Recepción y agenda pública de Manabit",
        staging_bucket=args.bucket, service_account=args.service_account,
        requirements=str(root / "requirements.txt"),
        extra_packages=[str(root / "factory.py"), str(root / "tools.py")],
        env_vars=env, python_version="3.14", min_instances=0, max_instances=2,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audience", choices=["customer", "owner"], default="customer")
    parser.add_argument("--project", required=True)
    parser.add_argument("--location", default="us-central1", help="Región del runtime")
    parser.add_argument("--model-location", default="global", help="Endpoint de Gemini")
    parser.add_argument("--model", default="gemini-3.5-flash")
    parser.add_argument("--bucket", required=True, help="gs://bucket-existente")
    parser.add_argument("--service-account", required=True)
    parser.add_argument("--api-url", required=True, help="URL https de Manabit en Cloud Run")
    parser.add_argument("--secret-version", required=True, help="projects/ID/secrets/NOMBRE/versions/1; no el valor del secreto")
    parser.add_argument("--execute", action="store_true", help="Crea recursos facturables. Sin este flag solo valida localmente.")
    args = parser.parse_args()
    url = urlparse(args.api_url)
    if url.scheme != "https" or not url.hostname or url.hostname in ("localhost", "127.0.0.1"):
        parser.error("El runtime necesita una URL https pública del backend, no localhost.")
    if not args.bucket.startswith("gs://") or not args.secret_version.startswith("projects/"):
        parser.error("Revisa bucket y nombre de versión de Secret Manager.")
    if not args.service_account.endswith(".iam.gserviceaccount.com"):
        parser.error("Usa una cuenta de servicio específica del runtime.")
    # El modelo queda serializado dentro del grafo; se define antes de construirlo.
    os.environ["MANABIT_GEMINI_MODEL"] = args.model
    root = owner_agent() if args.audience == "owner" else customer_agent()
    config = build_config(args)
    if not args.execute:
        print(json.dumps({"checked": True, "deployed": False, "root": root.name,
            "subagents": [a.name for a in root.sub_agents], "project": args.project,
            "location": args.location, "model": args.model,
            "packages": config.extra_packages}, indent=2))
        return
    vertexai.init(project=args.project, location=args.location)
    app = AdkApp(agent=root, enable_tracing=False)
    client = vertexai.Client(project=args.project, location=args.location)
    remote = client.agent_engines.create(agent=app, config=config)
    print("Recurso creado:", remote.api_resource.name)
    print("Configura", "GOOGLE_OWNER_AGENT_ENGINE_ID" if args.audience == "owner" else "GOOGLE_AGENT_ENGINE_ID", "en el backend.")


if __name__ == "__main__":
    main()
