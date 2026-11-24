import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

if (!existsSync(".env.local"))
  throw new Error("Ejecuta node scripts/setup-local.mjs primero.");
let source = readFileSync(".env.local", "utf8");
const original = source;
process.loadEnvFile(".env.local");
const defaults = {
  MANABIT_LOCAL_ADK_URL: "http://127.0.0.1:8001",
  MANABIT_LOCAL_ADK_TOKEN: randomBytes(32).toString("hex"),
  MANABIT_PILOT_BUDGET_USD: "8",
};
for (const [name, fallback] of Object.entries(defaults)) {
  if (!process.env[name]) {
    source = source
      .split(/\r?\n/)
      .filter((line) => !line.startsWith(`${name}=`))
      .join("\n");
    source += `\n${name}=${fallback}\n`;
    process.env[name] = fallback;
  }
}
if (source !== original) writeFileSync(".env.local", source, { mode: 0o600 });
if (process.argv.includes("--status")) {
  const response = await fetch(`${process.env.MANABIT_LOCAL_ADK_URL}/status`, {
    headers: { Authorization: `Bearer ${process.env.MANABIT_LOCAL_ADK_TOKEN}` },
  });
  if (!response.ok)
    throw new Error("No se pudo consultar el puente ADK local.");
  console.log(await response.json());
} else {
  for (const name of ["MANABIT_TOOLS_TOKEN", "MANABIT_OWNER_TOOLS_TOKEN"])
    if ((process.env[name] || "").length < 32)
      throw new Error(`Falta configurar ${name}.`);
  const python =
    process.platform === "win32"
      ? "agents/.venv/Scripts/python.exe"
      : "agents/.venv/bin/python";
  const child = spawn(python, ["agents/local_server.py"], {
    stdio: "inherit",
    env: {
      ...process.env,
      GOOGLE_GENAI_USE_VERTEXAI: "TRUE",
      GOOGLE_CLOUD_PROJECT: "manabit-sistema",
      GOOGLE_CLOUD_LOCATION: "global",
      MANABIT_GEMINI_MODEL: "gemini-3.5-flash",
      MANABIT_TOOLS_API_URL: process.env.APP_URL || "http://127.0.0.1:3100",
    },
  });
  child.on("error", () => {
    console.error(
      "No se pudo iniciar Python. Instala agents/requirements-local.txt en agents/.venv.",
    );
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 0;
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill());
}
