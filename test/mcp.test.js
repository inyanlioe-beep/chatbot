const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { handler } = require("../api/index");

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

test("handler Vercel menggunakan MCP tools dan mengirim versi protokol setelah inisialisasi", async () => {
  const mcpRequests = [];
  const mcpServer = http.createServer(async (request, response) => {
    const payload = await readBody(request);
    mcpRequests.push({
      method: payload.method,
      body: payload,
      protocolVersion: request.headers["mcp-protocol-version"],
      sessionId: request.headers["mcp-session-id"],
      apiKey: request.headers["x-api-key"]
    });

    response.setHeader("Mcp-Session-Id", "mcp-session-test");
    if (payload.method === "notifications/initialized") {
      response.writeHead(202);
      response.end();
      return;
    }

    const result = payload.method === "initialize"
      ? {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "mock-mcp", version: "1.0.0" }
        }
      : payload.method === "tools/list"
        ? { tools: [{ name: "lookup", description: "Cari informasi", inputSchema: { type: "object", properties: {} } }] }
        : payload.method === "tools/call"
          ? { content: [{ type: "text", text: "Hasil MCP" }] }
          : null;

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }));
  });
  const mcpPort = await listen(mcpServer);

  const providerBodies = [];
  const providerServer = http.createServer(async (request, response) => {
    providerBodies.push(await readBody(request));
    response.writeHead(200, { "Content-Type": "application/json" });
    const result = providerBodies.length === 1
      ? {
          choices: [{
            message: {
              role: "assistant",
              tool_calls: [{
                id: "call-1",
                type: "function",
                function: { name: "tinyfish__lookup", arguments: "{}" }
              }]
            }
          }]
        }
      : { choices: [{ message: { role: "assistant", content: "Selesai dengan MCP." } }] };
    response.end(JSON.stringify(result));
  });
  const providerPort = await listen(providerServer);

  const envKeys = ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "MCP_SERVERS"];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    OPENAI_API_KEY: "provider-test-key",
    OPENAI_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
    OPENAI_MODEL: "model-test",
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_BASE_URL: "",
    MCP_SERVERS: JSON.stringify({
      tinyfish: {
        url: `http://127.0.0.1:${mcpPort}/mcp`,
        headers: { "X-API-Key": "mcp-test-key" }
      }
    })
  });

  try {
    const response = await handler(new Request("https://example.test/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Cari sesuatu" }] })
    }), {
      status: (code) => ({
        json: (payload) => ({ code, payload })
      })
    });

    assert.equal(response.code, 200);
    assert.equal(response.payload.choices[0].message.content, "Selesai dengan MCP.");
    assert.equal(providerBodies.length, 2);
    assert.equal(providerBodies[0].stream, false);
    assert.equal(providerBodies[0].tools[0].function.name, "tinyfish__lookup");
    assert.equal(providerBodies[1].messages.at(-1).content, "Hasil MCP");
    assert.deepEqual(mcpRequests.map(({ method }) => method), [
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/call"
    ]);
    assert.equal(mcpRequests[0].protocolVersion, undefined);
    for (const request of mcpRequests.slice(1)) {
      assert.equal(request.protocolVersion, "2025-06-18");
      assert.equal(request.sessionId, "mcp-session-test");
      assert.equal(request.apiKey, "mcp-test-key");
    }

    providerBodies.length = 0;
    mcpRequests.length = 0;
    const { createAppServer } = require("../server");
    const app = createAppServer({
      apiKey: "provider-test-key",
      baseUrl: `http://127.0.0.1:${providerPort}/v1`,
      model: "model-test",
      mcpServers: JSON.stringify({
        tinyfish: {
          url: `http://127.0.0.1:${mcpPort}/mcp`,
          headers: { "X-API-Key": "mcp-test-key" }
        }
      })
    });
    const appPort = await listen(app);
    try {
      const appResponse = await fetch(`http://127.0.0.1:${appPort}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "Cari sesuatu" }] })
      });
      const appPayload = await appResponse.json();

      assert.equal(appResponse.status, 200);
      assert.equal(appPayload.choices[0].message.content, "Selesai dengan MCP.");
      assert.equal(providerBodies.length, 2);
      assert.equal(providerBodies[0].tools[0].function.name, "tinyfish__lookup");
      assert.equal(providerBodies[1].messages.at(-1).content, "Hasil MCP");
      assert.deepEqual(mcpRequests.map(({ method }) => method), [
        "initialize",
        "notifications/initialized",
        "tools/list",
        "tools/call"
      ]);
    } finally {
      await close(app);
    }
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await close(providerServer);
    await close(mcpServer);
  }
});
