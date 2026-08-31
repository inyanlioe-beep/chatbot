const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const MAX_BODY_BYTES = 1024 * 1024;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

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

function readConfig() {
  const baseUrl = process.env.BLUEPACK_BASE_URL || process.env.AGENTROUTER_BASE_URL || "https://agentrouter.org/v1";
  return {
    apiKey: process.env.BLUEPACK_API_KEY || process.env.AGENTROUTER_API_KEY || "",
    baseUrl,
    model: process.env.BLUEPACK_MODEL || process.env.AGENTROUTER_MODEL || "gpt-4o-mini",
    provider: process.env.BLUEPACK_BASE_URL || process.env.BLUEPACK_API_KEY
      ? "bluepack"
      : (process.env.AGENTROUTER_PROVIDER || "openai-compatible"),
    port: Number(process.env.PORT) || 3000
  };
}

function resolveApiUrl(baseUrl, resource) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Base URL AI Provider belum dikonfigurasi.");

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

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(payload));
}

function parseJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Payload terlalu besar."), { statusCode: 413 }));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
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
    return parsed?.error?.message || parsed?.message || `AI Provider merespons dengan status ${status}.`;
  } catch {
    return body.trim().slice(0, 500) || `AI Provider merespons dengan status ${status}.`;
  }
}

async function proxyModels(response, config) {
  if (!config.apiKey) {
    return sendJson(response, 503, { error: "API Provider key belum dikonfigurasi." });
  }

  if (isBluepackConfig(config)) {
    return sendJson(response, 200, { models: config.model ? [config.model] : [] });
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
      return sendJson(response, upstream.status, { error: getUpstreamError(text, upstream.status) });
    }

    const payload = JSON.parse(text);
    const models = Array.isArray(payload?.data)
      ? payload.data.map((item) => item?.id).filter(Boolean).sort()
      : [];
    return sendJson(response, 200, { models });
  } catch (error) {
    const message = error.name === "AbortError"
      ? "Permintaan daftar model ke AI Provider melewati batas waktu."
      : `Tidak dapat mengambil daftar model: ${error.message}`;
    return sendJson(response, 502, { error: message });
  } finally {
    clearTimeout(timeout);
  }
}

async function proxyChat(request, response, config) {
  if (!config.apiKey) {
    return sendJson(response, 503, {
      error: "API Provider key belum dikonfigurasi. Salin .env.example menjadi .env terlebih dahulu."
    });
  }

  let body;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    if (!response.headersSent) sendJson(response, error.statusCode || 400, { error: error.message });
    return;
  }

  let messages;
  try {
    messages = validateMessages(body.messages);
  } catch (error) {
    return sendJson(response, error.statusCode || 400, { error: error.message });
  }

  const temperature = Number(body.temperature);
  const maxTokens = Number(body.maxTokens);
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : config.model;
  const boundedTemperature = Number.isFinite(temperature) ? Math.min(2, Math.max(0, temperature)) : 0.7;
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
        temperature: boundedTemperature,
        max_tokens: boundedMaxTokens
      };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);
  response.on("close", () => controller.abort());

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
      return sendJson(response, upstream.status, { error: getUpstreamError(text, upstream.status) });
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff"
    });

    if (!upstream.body) {
      response.end();
      return;
    }

    for await (const chunk of Readable.fromWeb(upstream.body)) {
      if (!response.write(chunk)) {
        await new Promise((resolve) => response.once("drain", resolve));
      }
    }
    response.end();
  } catch (error) {
    if (error.name === "AbortError") {
      if (!response.headersSent) sendJson(response, 499, { error: "Permintaan dihentikan atau melewati batas waktu." });
      else response.end();
      return;
    }

    if (!response.headersSent) {
      sendJson(response, 502, { error: `Tidak dapat terhubung ke AI Provider: ${error.message}` });
    } else {
      response.end();
    }
  } finally {
    clearTimeout(timeout);
  }
}

function serveStatic(request, response, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return sendJson(response, 400, { error: "Path tidak valid." });
  }

  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const filePath = path.resolve(PUBLIC_DIR, relativePath);

  if (!filePath.toLowerCase().startsWith(PUBLIC_DIR.toLowerCase() + path.sep)) {
    return sendJson(response, 403, { error: "Akses ditolak." });
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      if (path.extname(relativePath)) return sendJson(response, 404, { error: "File tidak ditemukan." });
      return serveStatic(request, response, "/");
    }

    const ext = path.extname(filePath).toLowerCase();
    const cachePolicy = [".html", ".js", ".css"].includes(ext) ? "no-cache" : "public, max-age=3600";

    response.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": cachePolicy,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'",
      "Referrer-Policy": "no-referrer"
    });
    if (request.method === "HEAD") return response.end();
    fs.createReadStream(filePath).pipe(response);
  });
}

function createAppServer(config = readConfig()) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

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

    return serveStatic(request, response, url.pathname);
  });
}

if (require.main === module) {
  loadEnvFile();
  const config = readConfig();
  const server = createAppServer(config);
  server.listen(config.port, () => {
    console.log(`AI Provider Chat siap di http://localhost:${config.port}`);
    if (!config.apiKey) {
      console.warn("Peringatan: API Provider key belum dikonfigurasi di file .env.");
    }
  });
}

module.exports = {
  createAppServer,
  loadEnvFile,
  readConfig,
  resolveApiUrl,
  validateMessages
};
