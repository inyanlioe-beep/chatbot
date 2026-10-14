const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const MAX_BODY_BYTES = 20 * 1024 * 1024;

// Load MCP client (plugin-based)
let MCPClient;
try {
  MCPClient = require("./mcp");
} catch (err) {
  console.warn("MCP module not found - tool support disabled:", err.message);
  MCPClient = null;
}

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
  const baseUrl = process.env.ANTHROPIC_BASE_URL || process.env.OPENAI_BASE_URL || "https://agentrouter.org/v1";
  return {
    apiKey: process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || "",
    baseUrl,
    model: process.env.ANTHROPIC_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini",
    provider: process.env.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_API_KEY
      ? "anthropic"
      : (process.env.OPENAI_PROVIDER || "openai-compatible"),
    port: Number(process.env.PORT) || 3000,
    mcpServers: process.env.MCP_SERVERS || null
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

function isAnthropicConfig(config) {
  return config.provider === "anthropic" || /\/messages$/i.test(String(config.baseUrl || "").trim());
}

/**
 * Load MCP servers once per application instance.
 */
async function loadMCP(config) {
  if (!config.mcpServers || !MCPClient) return null;
  const client = MCPClient.fromEnv(config.mcpServers);
  if (!client) return null;
  await client.initialize();
  return client;
}

function formatMCPStatus(mcp) {
  return mcp ? mcp.getStatus() : [];
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
  const dataUrlPattern = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i;

  return messages.map((message) => {
    if (!message || !validRoles.has(message.role)) {
      throw Object.assign(new Error("Format pesan tidak valid."), { statusCode: 400 });
    }

    if (typeof message.content === "string") {
      if (!message.content.trim()) {
        throw Object.assign(new Error("Format pesan tidak valid."), { statusCode: 400 });
      }
      if (message.content.length > 50000) {
        throw Object.assign(new Error("Salah satu pesan terlalu panjang."), { statusCode: 400 });
      }
      return { role: message.role, content: message.content };
    }

    if (Array.isArray(message.content)) {
      if (!message.content.length || message.content.length > 20) {
        throw Object.assign(new Error("Format pesan tidak valid."), { statusCode: 400 });
      }
      const parts = message.content.map((part) => {
        if (part?.type === "text") {
          if (typeof part.text !== "string" || !part.text.trim()) {
            throw Object.assign(new Error("Format pesan tidak valid."), { statusCode: 400 });
          }
          return { type: "text", text: part.text.slice(0, 50000) };
        }
        if (part?.type === "image_url") {
          const url = part.image_url?.url;
          if (typeof url !== "string" || !dataUrlPattern.test(url)) {
            throw Object.assign(new Error("Gambar harus berupa data URL base64 (png/jpeg/webp/gif)."), { statusCode: 400 });
          }
          return { type: "image_url", image_url: { url } };
        }
        throw Object.assign(new Error("Format pesan tidak valid."), { statusCode: 400 });
      });
      return { role: message.role, content: parts };
    }

    throw Object.assign(new Error("Format pesan tidak valid."), { statusCode: 400 });
  });
}

function toAnthropicContent(content) {
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text };
    const [, mediaType, data] = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(part.image_url.url);
    return { type: "image", source: { type: "base64", media_type: mediaType, data } };
  });
}

function extractMessageText(content) {
  if (typeof content === "string") return content;
  return content.filter((part) => part.type === "text").map((part) => part.text).join("\n\n");
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

  if (isAnthropicConfig(config)) {
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

function mcpResultToText(result) {
  if (typeof result === "string") return result;
  if (!result || !Array.isArray(result.content)) return JSON.stringify(result || {});
  return result.content.map((item) => {
    if (typeof item === "string") return item;
    if (item?.type === "text") return item.text || "";
    return item?.text || JSON.stringify(item);
  }).join("\n");
}

async function proxyChatWithMCP(response, config, body, messages, mcp) {
  const anthropic = isAnthropicConfig(config);
  const temperature = Number(body.temperature);
  const maxTokens = Number(body.maxTokens);
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : config.model;
  const boundedTemperature = Number.isFinite(temperature) ? Math.min(2, Math.max(0, temperature)) : 0.7;
  const boundedMaxTokens = Number.isFinite(maxTokens) ? Math.min(65536, Math.max(1, Math.round(maxTokens))) : 2048;
  const systemMessages = messages.filter((message) => message.role === "system");
  let currentMessages = messages.filter((message) => message.role !== "system");
  const tools = anthropic ? mcp.getAnthropicTools() : mcp.getOpenAITools();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const upstreamBody = anthropic
      ? {
          model,
          max_tokens: boundedMaxTokens,
          messages: currentMessages,
          ...(systemMessages.length ? { system: systemMessages.map((message) => extractMessageText(message.content)).join("\n\n") } : {}),
          tools
        }
      : {
          model,
          messages: systemMessages.concat(currentMessages),
          stream: false,
          temperature: boundedTemperature,
          max_tokens: boundedMaxTokens,
          tools,
          tool_choice: "auto"
        };

    const upstream = await fetch(resolveApiUrl(config.baseUrl, anthropic ? "messages" : "chat/completions"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(upstreamBody),
      signal: AbortSignal.timeout(5 * 60 * 1000)
    });
    const text = await upstream.text();
    if (!upstream.ok) return sendJson(response, upstream.status, { error: getUpstreamError(text, upstream.status) });

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return sendJson(response, 502, { error: "AI Provider mengembalikan JSON yang tidak valid saat memakai MCP." });
    }

    if (anthropic) {
      const blocks = Array.isArray(payload.content) ? payload.content : [];
      const toolUses = blocks.filter((block) => block?.type === "tool_use");
      if (!toolUses.length) return sendJson(response, 200, payload);
      currentMessages.push({ role: "assistant", content: blocks });
      const results = [];
      for (const toolUse of toolUses) {
        try {
          const result = await mcp.callTool(toolUse.name, toolUse.input || {});
          results.push({ type: "tool_result", tool_use_id: toolUse.id, content: mcpResultToText(result) });
        } catch (error) {
          results.push({ type: "tool_result", tool_use_id: toolUse.id, is_error: true, content: error.message });
        }
      }
      currentMessages.push({ role: "user", content: results });
      continue;
    }

    const assistant = payload?.choices?.[0]?.message;
    const toolCalls = Array.isArray(assistant?.tool_calls) ? assistant.tool_calls : [];
    if (!toolCalls.length) return sendJson(response, 200, payload);
    currentMessages.push(assistant);
    for (const call of toolCalls) {
      let args = {};
      try {
        args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }
      let content;
      try {
        content = mcpResultToText(await mcp.callTool(call.function.name, args));
      } catch (error) {
        content = `MCP tool error: ${error.message}`;
      }
      currentMessages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }

  return sendJson(response, 502, { error: "MCP tool call terlalu banyak dalam satu permintaan." });
}

async function proxyChat(request, response, config, mcp = null) {
  if (!config.apiKey) {
    return sendJson(response, 503, {
      error: "API Provider key belum dikonfigurasi. Salin .env.example menjadi .env terlebih dahulu."
    });
  }

  let body;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    return sendJson(response, error.statusCode || 400, { error: error.message });
  }

  let messages;
  try {
    messages = validateMessages(body.messages);
  } catch (error) {
    return sendJson(response, error.statusCode || 400, { error: error.message });
  }

  if (mcp?.getTools?.().length) {
    try {
      return await proxyChatWithMCP(response, config, body, messages, mcp);
    } catch (error) {
      return sendJson(response, error.name === "AbortError" ? 499 : 502, { error: error.message });
    }
  }

  const temperature = Number(body.temperature);
  const maxTokens = Number(body.maxTokens);
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : config.model;
  const boundedTemperature = Number.isFinite(temperature) ? Math.min(2, Math.max(0, temperature)) : 0.7;
  const boundedMaxTokens = Number.isFinite(maxTokens) ? Math.min(65536, Math.max(1, Math.round(maxTokens))) : 2048;
  const anthropic = isAnthropicConfig(config);
  const systemMessages = messages.filter((message) => message.role === "system");
  const upstreamBody = anthropic
    ? {
        model,
        max_tokens: boundedMaxTokens,
        messages: messages.filter((message) => message.role !== "system").map((message) => ({ role: message.role, content: toAnthropicContent(message.content) })),
        ...(systemMessages.length ? { system: systemMessages.map((message) => extractMessageText(message.content)).join("\n\n") } : {})
      }
    : { model, messages, stream: true, temperature: boundedTemperature, max_tokens: boundedMaxTokens };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);
  response.on("close", () => controller.abort());
  try {
    const upstream = await fetch(resolveApiUrl(config.baseUrl, anthropic ? "messages" : "chat/completions"), {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", Accept: anthropic ? "application/json" : "text/event-stream, application/json" },
      body: JSON.stringify(upstreamBody),
      signal: controller.signal
    });
    if (!upstream.ok) {
      const text = await upstream.text();
      return sendJson(response, upstream.status, { error: getUpstreamError(text, upstream.status) });
    }
    response.writeHead(200, { "Content-Type": upstream.headers.get("content-type") || "application/octet-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff" });
    if (!upstream.body) return response.end();
    for await (const chunk of Readable.fromWeb(upstream.body)) {
      if (!response.write(chunk)) await new Promise((resolve) => response.once("drain", resolve));
    }
    response.end();
  } catch (error) {
    if (error.name === "AbortError") {
      if (!response.headersSent) sendJson(response, 499, { error: "Permintaan dihentikan atau melewati batas waktu." });
      else response.end();
    } else if (!response.headersSent) sendJson(response, 502, { error: `Tidak dapat terhubung ke AI Provider: ${error.message}` });
    else response.end();
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
      "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data: https:; connect-src 'self'; font-src 'self' https:",
      "Referrer-Policy": "no-referrer"
    });
    if (request.method === "HEAD") return response.end();
    fs.createReadStream(filePath).pipe(response);
  });
}

function createAppServer(config = readConfig()) {
  let mcpPromise = null;
  const getMCP = () => {
    if (!mcpPromise) mcpPromise = loadMCP(config).catch((error) => {
      console.error("MCP initialization failed:", error.message);
      return null;
    });
    return mcpPromise;
  };

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
        provider: config.provider,
        mcp: formatMCPStatus(await getMCP())
      });
    }

    if (request.method === "GET" && url.pathname === "/api/mcp/servers") {
      return sendJson(response, 200, { servers: formatMCPStatus(await getMCP()) });
    }

    if (request.method === "GET" && url.pathname === "/api/models") {
      return proxyModels(response, config);
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      return proxyChat(request, response, config, await getMCP());
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
  validateMessages,
  loadMCP,
  proxyChatWithMCP
};
