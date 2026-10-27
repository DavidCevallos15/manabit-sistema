"""Revisa el paquete sin red; --execute crea UN runtime, o actualiza uno existente con --update."""
import argparse
import re
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
        # Rutas relativas: el SDK usa tar.add(ruta) y el runtime importa `factory` y `tools`
        # desde la raíz del paquete. Con rutas absolutas quedarían en Users/.../agents/.
        extra_packages=["factory.py", "tools.py"],
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
    parser.add_argument("--update", metavar="RESOURCE", default="",
        help="projects/ID/locations/REGION/reasoningEngines/NUM existente: con --execute lo actualiza en vez de crear otro.")
    args = parser.parse_args()
    os.chdir(Path(__file__).resolve().parent)
    for name in ("factory.py", "tools.py", "requirements.txt"):
        if not Path(name).is_file():
            parser.error(f"Falta {name} junto a deploy.py.")
    url = urlparse(args.api_url)
    if url.scheme != "https" or not url.hostname or url.hostname in ("localhost", "127.0.0.1"):
        parser.error("El runtime necesita una URL https pública del backend, no localhost.")
    if not args.bucket.startswith("gs://") or not args.secret_version.startswith("projects/"):
        parser.error("Revisa bucket y nombre de versión de Secret Manager.")
    if not args.service_account.endswith(".iam.gserviceaccount.com"):
        parser.error("Usa una cuenta de servicio específica del runtime.")
    if args.update and not re.fullmatch(r"projects/[^/]+/locations/[^/]+/reasoningEngines/[^/]+", args.update):
        parser.error("--update necesita el nombre completo del recurso reasoningEngines.")
    if args.update and f"/locations/{args.location}/" not in args.update:
        parser.error("La región de --update no coincide con --location.")
    # El modelo queda serializado dentro del grafo; se define antes de construirlo.
    os.environ["MANABIT_GEMINI_MODEL"] = args.model
    root = owner_agent() if args.audience == "owner" else customer_agent()
    config = build_config(args)
    if not args.execute:
        print(json.dumps({"checked": True, "deployed": False, "root": root.name,
            "subagents": [a.name for a in root.sub_agents], "project": args.project,
            "location": args.location, "model": args.model,
            "action": "update" if args.update else "create", "target": args.update or None,
            "packages": config.extra_packages}, indent=2))
        return
    vertexai.init(project=args.project, location=args.location)
    app = AdkApp(agent=root, enable_tracing=False)
    client = vertexai.Client(project=args.project, location=args.location)
    if args.update:
        remote = client.agent_engines.update(name=args.update, agent=app, config=config)
        print("Recurso actualizado:", remote.api_resource.name)
        return
    remote = client.agent_engines.create(agent=app, config=config)
    print("Recurso creado:", remote.api_resource.name)
    print("Configura", "GOOGLE_OWNER_AGENT_ENGINE_ID" if args.audience == "owner" else "GOOGLE_AGENT_ENGINE_ID", "en el backend.")


if __name__ == "__main__":
    main()
