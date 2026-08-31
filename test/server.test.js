const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createAppServer, resolveApiUrl, validateMessages } = require("../server");

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("resolveApiUrl menyusun endpoint dengan benar", () => {
  assert.equal(resolveApiUrl("https://agentrouter.org/v1/", "chat/completions"), "https://agentrouter.org/v1/chat/completions");
  assert.equal(resolveApiUrl("https://example.test/v1/chat/completions", "chat/completions"), "https://example.test/v1/chat/completions");
  assert.equal(resolveApiUrl("https://example.test/v1/chat/completions", "models"), "https://example.test/v1/models");
});

test("validateMessages membuang properti yang tidak diperlukan", () => {
  assert.deepEqual(validateMessages([{ role: "user", content: "Halo", private: true }]), [
    { role: "user", content: "Halo" }
  ]);
  assert.throws(() => validateMessages([]), /tidak boleh kosong/i);
  assert.throws(() => validateMessages([{ role: "tool", content: "x" }]), /tidak valid/i);
});

test("server menyajikan konfigurasi tanpa membocorkan API key", async () => {
  const server = createAppServer({
    apiKey: "rahasia-sekali",
    baseUrl: "https://agentrouter.org/v1",
    model: "model-test"
  });
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/config`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.apiKeyConfigured, true);
    assert.equal(payload.model, "model-test");
    assert.equal(JSON.stringify(payload).includes("rahasia-sekali"), false);
  } finally {
    await close(server);
  }
});

test("endpoint chat meneruskan payload dan stream AI Provider", async () => {
  let receivedAuthorization = "";
  let receivedBody = null;
  const upstream = http.createServer((request, response) => {
    receivedAuthorization = request.headers.authorization;
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      receivedBody = JSON.parse(body);
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end('data: {"choices":[{"delta":{"content":"Halo dari router"}}]}\n\ndata: [DONE]\n\n');
    });
  });
  const upstreamPort = await listen(upstream);

  const app = createAppServer({
    apiKey: "key-test",
    baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
    model: "model-default"
  });
  const appPort = await listen(app);

  try {
    const response = await fetch(`http://127.0.0.1:${appPort}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Halo" }] })
    });
    const stream = await response.text();

    assert.equal(response.status, 200);
    assert.equal(receivedAuthorization, "Bearer key-test");
    assert.equal(receivedBody.model, "model-default");
    assert.equal(receivedBody.stream, true);
    assert.match(stream, /Halo dari router/);
  } finally {
    await close(app);
    await close(upstream);
  }
});

test("endpoint chat mendukung format Bluepack /messages", async () => {
  let receivedPath = "";
  let receivedAuthorization = "";
  let receivedBody = null;
  const upstream = http.createServer((request, response) => {
    receivedPath = request.url;
    receivedAuthorization = request.headers.authorization;
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      receivedBody = JSON.parse(body);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ content: [{ type: "thinking", thinking: "internal" }, { type: "text", text: "Halo dari Bluepack" }] }));
    });
  });
  const upstreamPort = await listen(upstream);
  const app = createAppServer({
    apiKey: "bluepack-key",
    baseUrl: `http://127.0.0.1:${upstreamPort}/messages`,
    model: "claude-opus-5",
    provider: "bluepack"
  });
  const appPort = await listen(app);

  try {
    const response = await fetch(`http://127.0.0.1:${appPort}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "Jawab singkat" },
          { role: "user", content: "Halo" }
        ]
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(receivedPath, "/messages");
    assert.equal(receivedAuthorization, "Bearer bluepack-key");
    assert.equal(receivedBody.model, "claude-opus-5");
    assert.equal(receivedBody.system, "Jawab singkat");
    assert.deepEqual(receivedBody.messages, [{ role: "user", content: "Halo" }]);
    assert.equal(receivedBody.stream, undefined);
    assert.deepEqual(payload.content[1], { type: "text", text: "Halo dari Bluepack" });
  } finally {
    await close(app);
    await close(upstream);
  }
});

test("handler Vercel menanggapi /api/config dan /api/models dengan payload yang aman", async () => {
  const { handler } = require("../api/index");
  const previous = {
    AGENTROUTER_API_KEY: process.env.AGENTROUTER_API_KEY,
    AGENTROUTER_BASE_URL: process.env.AGENTROUTER_BASE_URL,
    AGENTROUTER_MODEL: process.env.AGENTROUTER_MODEL
  };

  process.env.AGENTROUTER_API_KEY = "";
  process.env.AGENTROUTER_BASE_URL = "https://agentrouter.org/v1";
  process.env.AGENTROUTER_MODEL = "gpt-4o-mini";

  try {
    const configRes = await handler({
      method: "GET",
      url: "/api/config",
      headers: {}
    }, {
      status: (code) => ({
        json: (payload) => ({ code, payload })
      })
    });

    assert.equal(configRes.code, 200);
    assert.equal(configRes.payload.apiKeyConfigured, false);
    assert.equal(configRes.payload.baseUrl, "https://agentrouter.org/v1");

    const modelsRes = await handler({
      method: "GET",
      url: "/api/models",
      headers: {}
    }, {
      status: (code) => ({
        json: (payload) => ({ code, payload })
      })
    });

    assert.equal(modelsRes.code, 200);
    assert.deepEqual(modelsRes.payload.models, []);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("parseJsonBody menerima request berbasis Web Request seperti Vercel", async () => {
  const { parseJsonBody } = require("../api/index");
  const request = new Request("https://example.com/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "Halo" }] })
  });

  const payload = await parseJsonBody(request);
  assert.deepEqual(payload.messages, [{ role: "user", content: "Halo" }]);
});
