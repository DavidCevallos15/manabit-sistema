import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { askGoogle } from "../src/server/google-agent.ts";

test("el puente conserva la identidad de servidor y marca sus sesiones locales", async () => {
  const oldUrl = process.env.MANABIT_LOCAL_ADK_URL;
  const oldToken = process.env.MANABIT_LOCAL_ADK_TOKEN;
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, "Bearer " + "x".repeat(40));
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(body.user, "manabit:123");
    assert.equal(body.session, "session-123");
    assert.equal(body.audience, "customer");
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        text: "Horario consultado",
        session: "session-123",
        author: "manabit_agenda",
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  process.env.MANABIT_LOCAL_ADK_URL = `http://127.0.0.1:${address.port}`;
  process.env.MANABIT_LOCAL_ADK_TOKEN = "x".repeat(40);
  try {
    const result = await askGoogle({
      user: "manabit:123",
      message: "Quiero un horario",
      session: "local:session-123",
    });
    assert.equal(result.session, "local:session-123");
    assert.equal(result.author, "manabit_agenda");
    process.env.MANABIT_LOCAL_ADK_URL = "https://external.example";
    await assert.rejects(
      askGoogle({ user: "manabit:123", message: "hola" }),
      /no es válida/,
    );
  } finally {
    if (oldUrl === undefined) delete process.env.MANABIT_LOCAL_ADK_URL;
    else process.env.MANABIT_LOCAL_ADK_URL = oldUrl;
    if (oldToken === undefined) delete process.env.MANABIT_LOCAL_ADK_TOKEN;
    else process.env.MANABIT_LOCAL_ADK_TOKEN = oldToken;
    server.close();
  }
});
