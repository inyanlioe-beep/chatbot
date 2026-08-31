const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

const ROOT_DIR = path.join(__dirname, "..");
const DEFAULT_BASE_URL = "https://agentrouter.org/v1";

function loadEnvFile(filePath = path.join(ROOT_DIR, ".env")) {
  if (!fs.existsSync(filePath)) return;

  const source = fs.readFileSync(filePath, "utf8");
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function readConfig(env = process.env) {
  const baseUrl = env.BLUEPACK_BASE_URL || env.AGENTROUTER_BASE_URL || DEFAULT_BASE_URL;
  return {
    apiKey: env.BLUEPACK_API_KEY || env.AGENTROUTER_API_KEY || "",
    baseUrl,
    model: env.BLUEPACK_MODEL || env.AGENTROUTER_MODEL || "gpt-4o-mini",
    provider: env.BLUEPACK_BASE_URL || env.BLUEPACK_API_KEY
      ? "bluepack"
      : (env.AGENTROUTER_PROVIDER || "openai-compatible")
  };
}

function resolveApiUrl(baseUrl, resource) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Base URL AgentRouter belum dikonfigurasi.");

  if (resource === "chat/completions" && /\/chat\/completions$/i.test(trimmed)) {
    return trimmed;
  }

  if (resource === "models" && /\/chat\/completions$/i.test(trimmed)) {
    return trimmed.replace(/\/chat\/completions$/i, "/models");
  }

  if (resource === "messages" && /\/messages$/i.test(trimmed)) {
    return trimmed;
  }

  return `${trimmed}/${resource}`;
}

function isBluepackConfig(config) {
  return config.provider === "bluepack" || /\/messages$/i.test(String(config.baseUrl || "").trim());
}

function sendJson(res, statusCode, payload) {
  if (typeof res?.status === "function") {
    const withStatus = res.status(statusCode);
    if (typeof withStatus?.json === "function") {
      return withStatus.json(payload);
    }
  }

  if (res && typeof res.setHeader === "function") {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(JSON.stringify(payload));
    return { statusCode, payload };
  }

  return { statusCode, payload };
}

async function parseJsonBody(request) {
  if (!request) return {};

  if (typeof request.text === "function") {
    const rawBody = await request.text();
    if (!rawBody) return {};

    try {
      return JSON.parse(rawBody);
    } catch {
      throw Object.assign(new Error("Body harus berupa JSON yang valid."), { statusCode: 400 });
    }
  }

  if (typeof request.body?.getReader === "function") {
    const text = await new Response(request.body).text();
    if (!text) return {};

    try {
      return JSON.parse(text);
    } catch {
      throw Object.assign(new Error("Body harus berupa JSON yang valid."), { statusCode: 400 });
    }
  }

  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error("Body harus berupa JSON yang valid."), { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw Object.assign(new Error("Pesan tidak boleh kosong."), { statusCode: 400 });
  }
  if (messages.length > 100) {
    throw Object.assign(new Error("Percakapan terlalu panjang (maksimal 100 pesan)."), {
      statusCode: 400
    });
  }

  const validRoles = new Set(["system", "user", "assistant"]);
  return messages.map((message) => {
    if (
      !message ||
      !validRoles.has(message.role) ||
      typeof message.content !== "string" ||
      !message.content.trim()
    ) {
      throw Object.assign(new Error("Format pesan tidak valid."), { statusCode: 400 });
    }
    if (message.content.length > 50000) {
      throw Object.assign(new Error("Salah satu pesan terlalu panjang."), { statusCode: 400 });
    }
    return { role: message.role, content: message.content };
  });
}

function getUpstreamError(body, status) {
  try {
    const parsed = JSON.parse(body);
    return parsed?.error?.message || parsed?.message || `AgentRouter merespons dengan status ${status}.`;
  } catch {
    return body.trim().slice(0, 500) || `AgentRouter merespons dengan status ${status}.`;
  }
}

async function proxyModels(res, config) {
  if (!config.apiKey) {
    return sendJson(res, 200, { models: [] });
  }

  if (isBluepackConfig(config)) {
    return sendJson(res, 200, { models: config.model ? [config.model] : [] });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const upstream = await fetch(resolveApiUrl(config.baseUrl, "models"), {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: controller.signal
    });
    const text = await upstream.text();

    if (!upstream.ok) {
      return sendJson(res, upstream.status, { error: getUpstreamError(text, upstream.status) });
    }

    const payload = JSON.parse(text);
    const models = Array.isArray(payload?.data)
      ? payload.data.map((item) => item?.id).filter(Boolean).sort()
      : [];
    return sendJson(res, 200, { models });
  } catch (error) {
    const message = error.name === "AbortError"
      ? "Permintaan daftar model ke AgentRouter melewati batas waktu."
      : `Tidak dapat mengambil daftar model: ${error.message}`;
    return sendJson(res, 502, { error: message });
  } finally {
    clearTimeout(timeout);
  }
}

async function proxyChat(request, res, config) {
  if (!config.apiKey) {
    return sendJson(res, 503, {
      error: "AGENTROUTER_API_KEY belum dikonfigurasi. Salin .env.example menjadi .env terlebih dahulu."
    });
  }

  let body;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    return sendJson(res, error.statusCode || 400, { error: error.message });
  }

  let messages;
  try {
    messages = validateMessages(body.messages);
  } catch (error) {
    return sendJson(res, error.statusCode || 400, { error: error.message });
  }

  const temperature = Number(body.temperature);
  const maxTokens = Number(body.maxTokens);
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : config.model;
  const boundedMaxTokens = Number.isFinite(maxTokens) ? Math.min(65536, Math.max(1, Math.round(maxTokens))) : 2048;
  const bluepack = isBluepackConfig(config);
  const systemMessages = messages.filter((message) => message.role === "system");
  const upstreamBody = bluepack
    ? {
        model,
        max_tokens: boundedMaxTokens,
        messages: messages.filter((message) => message.role !== "system"),
        ...(systemMessages.length ? { system: systemMessages.map((message) => message.content).join("\n\n") } : {})
      }
    : {
        model,
        messages,
        stream: true,
        temperature: Number.isFinite(temperature) ? Math.min(2, Math.max(0, temperature)) : 0.7,
        max_tokens: boundedMaxTokens
      };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);

  try {
    const upstream = await fetch(resolveApiUrl(config.baseUrl, bluepack ? "messages" : "chat/completions"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Accept: bluepack ? "application/json" : "text/event-stream, application/json"
      },
      body: JSON.stringify(upstreamBody),
      signal: controller.signal
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return sendJson(res, upstream.status, { error: getUpstreamError(text, upstream.status) });
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    if (typeof res.setHeader === "function") {
      res.statusCode = 200;
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("X-Content-Type-Options", "nosniff");
    } else if (typeof res.status === "function") {
      res.status(200);
      res.setHeader?.("Content-Type", contentType);
    }

    if (!upstream.body) {
      if (typeof res.end === "function") res.end();
      return { statusCode: 200 };
    }

    for await (const chunk of Readable.fromWeb(upstream.body)) {
      if (typeof res.write === "function") {
        if (!res.write(chunk)) {
          await new Promise((resolve) => res.once("drain", resolve));
        }
      }
    }

    if (typeof res.end === "function") res.end();
    return { statusCode: 200 };
  } catch (error) {
    if (error.name === "AbortError") {
      if (typeof res.end === "function") res.end();
      return sendJson(res, 499, { error: "Permintaan dihentikan atau melewati batas waktu." });
    }

    if (typeof res.end === "function") {
      return sendJson(res, 502, { error: `Tidak dapat terhubung ke AgentRouter: ${error.message}` });
    }

    return sendJson(res, 502, { error: `Tidak dapat terhubung ke AgentRouter: ${error.message}` });
  } finally {
    clearTimeout(timeout);
  }
}

async function handler(request, response) {
  loadEnvFile();
  const config = readConfig(process.env);
  const url = new URL(request.url || "/", "https://example.vercel.app");

  if (request.method === "GET" && url.pathname === "/api/health") {
    return sendJson(response, 200, { status: "ok" });
  }

  if (request.method === "GET" && url.pathname === "/api/config") {
    return sendJson(response, 200, {
      apiKeyConfigured: Boolean(config.apiKey),
      baseUrl: config.baseUrl,
      model: config.model,
      provider: config.provider
    });
  }

  if (request.method === "GET" && url.pathname === "/api/models") {
    return proxyModels(response, config);
  }

  if (request.method === "POST" && url.pathname === "/api/chat") {
    return proxyChat(request, response, config);
  }

  if (url.pathname.startsWith("/api/")) {
    return sendJson(response, 404, { error: "Endpoint tidak ditemukan." });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return sendJson(response, 405, { error: "Metode tidak diizinkan." });
  }

  return sendJson(response, 404, { error: "Route frontend tidak ditemukan." });
}

module.exports = handler;
module.exports.handler = handler;
module.exports.default = handler;
module.exports.loadEnvFile = loadEnvFile;
module.exports.parseJsonBody = parseJsonBody;
module.exports.readConfig = readConfig;
module.exports.resolveApiUrl = resolveApiUrl;
module.exports.validateMessages = validateMessages;
