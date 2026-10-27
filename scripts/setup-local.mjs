import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

if (existsSync(".env.local")) {
  console.log(".env.local ya existe. Se conserva sin cambios.");
} else {
  let text = readFileSync(".env.example", "utf8");
  for (const name of [
    "SESSION_SECRET",
    "ADMIN_PASSWORD",
    "MANABIT_TOOLS_TOKEN",
    "MANABIT_OWNER_TOOLS_TOKEN",
    "WORKER_TOKEN",
  ]) {
    text = text.replace(
      new RegExp(`^${name}=$`, "m"),
      `${name}=${randomBytes(32).toString("hex")}`,
    );
  }
  writeFileSync(".env.local", text, { flag: "wx", mode: 0o600 });
  console.log(
    "Creado .env.local con claves locales. Los valores no se muestran ni se suben a Git.",
  );
}
