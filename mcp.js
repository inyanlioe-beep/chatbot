const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

function parseServerConfig(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`MCP_SERVERS bukan JSON yang valid: ${error.message}`);
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("MCP_SERVERS harus berupa object dengan nama server sebagai key.");
  }
  return parsed;
}

function getErrorMessage(error) {
  if (!error) return "MCP request failed.";
  if (typeof error === "string") return error;
  return error.message || JSON.stringify(error);
}

class MCPClient {
  constructor(options = {}) {
    this.servers = parseServerConfig(options.servers || {});
    this.timeout = Number(options.timeout) || 30000;
    this.protocolVersion = options.protocolVersion || DEFAULT_PROTOCOL_VERSION;
    this.states = new Map();
    this.tools = [];
  }

  static fromEnv(value) {
    if (!value) return null;
    return new MCPClient({ servers: value });
  }

  async initialize() {
    const entries = Object.entries(this.servers);
    await Promise.all(entries.map(async ([name, config]) => {
      const state = { name, url: config.url, configured: true, connected: false, tools: [], error: null };
      this.states.set(name, state);
      try {
        if (!config || typeof config.url !== "string" || !/^https?:\/\//i.test(config.url)) {
          throw new Error("URL MCP harus menggunakan http:// atau https://.");
        }
        const init = await this.request(name, "initialize", {
          protocolVersion: this.protocolVersion,
          capabilities: { tools: {} },
          clientInfo: { name: "ruang-ai", version: "1.0.0" }
        });
        state.connected = true;
        state.serverInfo = init?.serverInfo || null;
        state.protocolVersion = init?.protocolVersion || this.protocolVersion;
        await this.notify(name, "notifications/initialized", {});
        state.tools = await this.listTools(name);
      } catch (error) {
        state.error = getErrorMessage(error);
      }
    }));
    this.tools = [...this.states.values()].flatMap((state) => state.tools);
    return this.getStatus();
  }

  getStatus() {
    return [...this.states.values()].map(({ name, url, configured, connected, error, tools, serverInfo }) => ({
      name,
      url,
      configured,
      connected,
      error,
      toolCount: tools.length,
      serverInfo: serverInfo || null
    }));
  }

  getTools() {
    return this.tools.map((tool) => ({ ...tool }));
  }

  getOpenAITools() {
    return this.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description || `Tool MCP ${tool.server}`,
        parameters: tool.inputSchema || { type: "object", properties: {} }
      }
    }));
  }

  getAnthropicTools() {
    return this.tools.map((tool) => ({
      name: tool.name,
      description: tool.description || `Tool MCP ${tool.server}`,
      input_schema: tool.inputSchema || { type: "object", properties: {} }
    }));
  }

  async listTools(serverName) {
    const tools = [];
    let cursor;
    do {
      const result = await this.request(serverName, "tools/list", cursor ? { cursor } : {});
      for (const tool of Array.isArray(result?.tools) ? result.tools : []) {
        if (!tool || typeof tool.name !== "string") continue;
        tools.push({
          name: `${serverName}__${tool.name}`,
          originalName: tool.name,
          server: serverName,
          description: tool.description || "",
          inputSchema: tool.inputSchema || tool.input_schema || { type: "object", properties: {} }
        });
      }
      cursor = result?.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(toolName, args = {}) {
    const tool = this.tools.find((candidate) => candidate.name === toolName);
    if (!tool) throw new Error(`MCP tool tidak ditemukan: ${toolName}`);
    const result = await this.request(tool.server, "tools/call", {
      name: tool.originalName,
      arguments: args
    });
    return result || { content: [] };
  }

  async notify(serverName, method, params) {
    await this.request(serverName, method, params, true);
  }

  async request(serverName, method, params = {}, notification = false) {
    const config = this.servers[serverName];
    const state = this.states.get(serverName) || {};
    if (!config) throw new Error(`MCP server tidak ditemukan: ${serverName}`);

    const headers = {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...(config.headers || {})
    };
    if (state.sessionId) headers["Mcp-Session-Id"] = state.sessionId;
    if (state.protocolVersion && method !== "initialize") {
      headers["MCP-Protocol-Version"] = state.protocolVersion;
    }

    const payload = notification
      ? { jsonrpc: "2.0", method, params }
      : { jsonrpc: "2.0", id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, method, params };
    const response = await fetch(config.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeout)
    });

    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) state.sessionId = sessionId;
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`MCP ${serverName} HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    if (notification || response.status === 202 || response.status === 204) return null;

    const data = await this.readResponse(response);
    if (data?.error) throw new Error(`MCP ${serverName}: ${data.error.message || JSON.stringify(data.error)}`);
    return data?.result ?? data;
  }

  async readResponse(response) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) return response.json();
    const text = await response.text();
    if (contentType.includes("text/event-stream")) {
      const events = text.split(/\r?\n\r?\n/).map((block) => block.split(/\r?\n/).find((line) => line.startsWith("data:"))).filter(Boolean);
      const last = events.at(-1);
      if (!last) return {};
      return JSON.parse(last.slice(5).trim());
    }
    return text ? JSON.parse(text) : {};
  }
}

module.exports = MCPClient;
module.exports.parseServerConfig = parseServerConfig;
