const CHAT_STORAGE_KEY = "ruang_ai_conversations_v1";
const SETTINGS_STORAGE_KEY = "ruang_ai_settings_v1";

const defaultSettings = {
  model: "",
  systemPrompt: "Kamu adalah asisten AI yang membantu, akurat, dan ringkas. Jawab menggunakan bahasa yang sama dengan pengguna.",
  temperature: 0.7,
  maxTokens: 2048
};

const state = {
  conversations: [],
  activeId: null,
  settings: { ...defaultSettings },
  serverConfig: null,
  controller: null,
  streaming: false,
  toastTimer: null,
  theme: "light",
  pastedImages: [],
  attachments: []
};

const elements = {
  activeModelLabel: document.querySelector("#activeModelLabel"),
  baseUrlInput: document.querySelector("#baseUrlInput"),
  chatForm: document.querySelector("#chatForm"),
  chatScroll: document.querySelector("#chatScroll"),
  closeSettingsButton: document.querySelector("#closeSettingsButton"),
  closeSidebarButton: document.querySelector("#closeSidebarButton"),
  configBanner: document.querySelector("#configBanner"),
  configBannerText: document.querySelector("#configBannerText"),
  configBannerTitle: document.querySelector("#configBannerTitle"),
  connectionStatus: document.querySelector("#connectionStatus"),
  connectionText: document.querySelector("#connectionText"),
  conversationList: document.querySelector("#conversationList"),
  maxTokensInput: document.querySelector("#maxTokensInput"),
  menuButton: document.querySelector("#menuButton"),
  messageInput: document.querySelector("#messageInput"),
  messageList: document.querySelector("#messageList"),
  modelButton: document.querySelector("#modelButton"),
  modelInput: document.querySelector("#modelInput"),
  modelList: document.querySelector("#modelList"),
  newChatButton: document.querySelector("#newChatButton"),
  pastedImagePreview: document.querySelector("#pastedImagePreview"),
  refreshModelsButton: document.querySelector("#refreshModelsButton"),
  searchInput: document.querySelector("#searchInput"),
  sendButton: document.querySelector("#sendButton"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  settingsForm: document.querySelector("#settingsForm"),
  sidebarBackdrop: document.querySelector("#sidebarBackdrop"),
  sidebarStatusDot: document.querySelector("#sidebarStatusDot"),
  stopButton: document.querySelector("#stopButton"),
  suggestionGrid: document.querySelector("#suggestionGrid"),
  systemPromptInput: document.querySelector("#systemPromptInput"),
  temperatureInput: document.querySelector("#temperatureInput"),
  themeToggle: document.querySelector("#themeToggle"),
  toast: document.querySelector("#toast"),
  welcomeView: document.querySelector("#welcomeView"),
  lightbox: document.querySelector("#lightbox"),
  lightboxImage: document.querySelector("#lightboxImage"),
  lightboxClose: document.querySelector("#lightboxClose"),
  attachmentButton: document.querySelector("#attachmentButton"),
  attachmentPreview: document.querySelector("#attachmentPreview"),
  fileInput: document.querySelector("#fileInput")
};

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createConversation() {
  const now = new Date().toISOString();
  return {
    id: makeId(),
    title: "Percakapan baru",
    createdAt: now,
    updatedAt: now,
    messages: []
  };
}

function loadState() {
  try {
    const savedChats = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || "[]");
    state.conversations = Array.isArray(savedChats)
      ? savedChats.filter((chat) => chat && chat.id && Array.isArray(chat.messages))
      : [];
  } catch {
    state.conversations = [];
  }

  try {
    const savedSettings = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
    state.settings = { ...defaultSettings, ...savedSettings };
  } catch {
    state.settings = { ...defaultSettings };
  }

  if (!state.conversations.length) state.conversations.push(createConversation());
  state.activeId = state.conversations[0].id;
}

function saveConversations() {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(state.conversations));
  } catch {
    // ponytail: kuota localStorage habis karena gambar base64 — simpan tanpa data gambar; upgrade: IndexedDB/server upload.
    const stripped = state.conversations.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) =>
        message.images?.length
          ? { ...message, images: message.images.map(({ id, fileName }) => ({ id, fileName, dataUrl: "" })) }
          : message
      )
    }));
    try {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(stripped));
    } catch {
      // State tetap di memori; dicoba lagi pada aksi berikutnya.
    }
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state.settings));
}

function loadTheme() {
  const saved = localStorage.getItem("ruang_ai_theme");
  const theme = saved || "dark";
  state.theme = theme;
  setTheme(theme);
}

function saveTheme() {
  localStorage.setItem("ruang_ai_theme", state.theme);
}

function setTheme(theme) {
  state.theme = theme;
  const html = document.documentElement;
  if (theme === "dark") {
    html.setAttribute("data-theme", "dark");
    if (elements.themeToggle) elements.themeToggle.textContent = "☀️";
  } else {
    html.removeAttribute("data-theme");
    if (elements.themeToggle) elements.themeToggle.textContent = "🌙";
  }
  saveTheme();
}

function toggleTheme() {
  const newTheme = state.theme === "dark" ? "light" : "dark";
  setTheme(newTheme);
}

function getActiveConversation() {
  return state.conversations.find((conversation) => conversation.id === state.activeId);
}

function formatTime(isoDate) {
  return new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" }).format(new Date(isoDate));
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  state.toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 3200);
}

function setConnectionState(connected, text) {
  elements.connectionStatus.classList.toggle("connected", connected);
  elements.connectionStatus.classList.toggle("disconnected", !connected);
  elements.sidebarStatusDot.classList.toggle("connected", connected);
  elements.sidebarStatusDot.classList.toggle("disconnected", !connected);
  elements.connectionText.textContent = text;
}

function getSelectedModel() {
  return state.settings.model || state.serverConfig?.model || "";
}

function updateModelLabel() {
  elements.activeModelLabel.textContent = getSelectedModel() || "Model default server";
}

function openLightbox(imageUrl) {
  elements.lightboxImage.src = imageUrl;
  elements.lightboxImage.alt = "Gambar yang diperbesar";
  elements.lightbox.classList.add("active");
}

function closeLightbox() {
  elements.lightbox.classList.remove("active");
  elements.lightboxImage.src = "";
}

function renderSidebar() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const conversations = [...state.conversations]
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .filter((conversation) => conversation.title.toLowerCase().includes(query));

  elements.conversationList.replaceChildren();
  if (!conversations.length) {
    const empty = document.createElement("p");
    empty.className = "empty-history";
    empty.textContent = query ? "Tidak ada percakapan yang cocok." : "Belum ada percakapan.";
    elements.conversationList.append(empty);
    return;
  }

  for (const conversation of conversations) {
    const row = document.createElement("div");
    row.className = `conversation-row${conversation.id === state.activeId ? " active" : ""}`;

    const select = document.createElement("button");
    select.type = "button";
    select.className = "conversation-select";
    select.textContent = conversation.title;
    select.title = conversation.title;
    select.addEventListener("click", () => {
      state.activeId = conversation.id;
      renderAll();
      closeSidebar();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "conversation-delete";
    remove.textContent = "Hapus";
    remove.setAttribute("aria-label", `Hapus ${conversation.title}`);
    remove.addEventListener("click", () => deleteConversation(conversation.id));

    row.append(select, remove);
    elements.conversationList.append(row);
  }
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

function formatIndonesianNumber(value) {
  if (!value || Number.isNaN(Number(value.replace(/\./g, "").replace(/,/g, ".")))) return value;

  const normalized = value.replace(/\./g, "").replace(/,/g, ".");
  const [integerPartRaw, decimalPartRaw] = normalized.split(".");
  const integerPart = Number(integerPartRaw).toLocaleString("id-ID");
  if (decimalPartRaw === undefined) return integerPart;
  return `${integerPart},${decimalPartRaw}`;
}

function formatIndonesianNumbersInText(text) {
  return text.replace(/(?<![\w/])\d{1,3}(?:\.\d{3})+(?:,\d+)?(?!(?:[\w/]|\.|,))|(?<![\w/])\d+(?:,\d+)?(?!(?:[\w/]|\.|,))/g, (match) => {
    const cleaned = match.replace(/\s/g, "");
    if (!cleaned || cleaned.includes("/") || cleaned.includes("-")) return match;
    return formatIndonesianNumber(cleaned);
  });
}

function parseInlineMarkdown(text) {
  let html = escapeHtml(text);
  html = formatIndonesianNumbersInText(html);

  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/_([^_]+)_/g, "<em>$1</em>");
  html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  return html;
}

function isTableRow(line) {
  return line.trim().startsWith("|") && line.trim().endsWith("|");
}

function isSeparatorRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return false;
  const cells = trimmed.split("|").map((c) => c.trim());
  return cells.slice(1, -1).every((c) => /^-+$/.test(c));
}

function parseTableRow(line) {
  return line
    .trim()
    .split("|")
    .map((cell) => cell.trim())
    .filter((_, i, arr) => i > 0 && i < arr.length - 1);
}

function renderTable(lines, startIndex) {
  const headerRow = parseTableRow(lines[startIndex]);
  let bodyRows = [];
  let endIndex = startIndex + 2;

  while (endIndex < lines.length && isTableRow(lines[endIndex])) {
    bodyRows.push(parseTableRow(lines[endIndex]));
    endIndex += 1;
  }

  const headerHtml = headerRow.map((cell) => `<th>${parseInlineMarkdown(cell)}</th>`).join("");
  const bodyHtml = bodyRows
    .map((row) => `<tr>${row.map((cell) => `<td>${parseInlineMarkdown(cell)}</td>`).join("")}</tr>`)
    .join("");

  return {
    html: `<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`,
    endIndex: endIndex - 1
  };
}

function renderMathExpressions(html) {
  if (!html || typeof window === "undefined" || !window.katex) {
    return html;
  }

  let rendered = html;

  rendered = rendered.replace(/\$\$([\s\S]+?)\$\$/g, (match, expression) => {
    try {
      return `<div class="katex-display">${window.katex.renderToString(expression.trim(), { throwOnError: false, displayMode: true })}</div>`;
    } catch {
      return match;
    }
  });

  rendered = rendered.replace(/\$([^$\n]+?)\$/g, (match, expression) => {
    try {
      return `<span class="katex-inline">${window.katex.renderToString(expression.trim(), { throwOnError: false, displayMode: false })}</span>`;
    } catch {
      return match;
    }
  });

  return rendered;
}

function renderMarkdownToHtml(markdown) {
  const normalized = String(markdown || "").replace(/\r\n/g, "\n");
  // Remove internal model tags (e.g., <close>, <response>, <sepl>, <message>) that shouldn't appear in output
  const cleaned = normalized.replace(/<\/?(?:close|response|sepl|message)[^>]*>/gi, "");
  if (!cleaned.trim()) return "";

  const lines = cleaned.split("\n");
  const output = [];
  let paragraphBuffer = [];
  let listBuffer = [];
  let listType = "ul";
  let quoteBuffer = [];
  let codeBuffer = null;
  let codeLanguage = "";

  const flushParagraph = () => {
    if (!paragraphBuffer.length) return;
    const paragraph = paragraphBuffer.join(" ").trim();
    if (paragraph) output.push(`<p>${parseInlineMarkdown(paragraph)}</p>`);
    paragraphBuffer = [];
  };

  const flushList = () => {
    if (!listBuffer.length) return;
    const tag = listType === "ol" ? "ol" : "ul";
    output.push(`<${tag}>${listBuffer.map((item) => `<li>${parseInlineMarkdown(item)}</li>`).join("")}</${tag}>`);
    listBuffer = [];
  };

  const flushQuote = () => {
    if (!quoteBuffer.length) return;
    output.push(`<blockquote>${quoteBuffer.map((item) => `<p>${parseInlineMarkdown(item)}</p>`).join("")}</blockquote>`);
    quoteBuffer = [];
  };

  const flushCode = () => {
    if (codeBuffer === null) return;
    const code = codeBuffer.join("\n");
    output.push(`<pre><code class="language-${escapeHtml(codeLanguage)}">${escapeHtml(code)}</code></pre>`);
    codeBuffer = null;
    codeLanguage = "";
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```") && codeBuffer === null) {
      flushParagraph();
      flushList();
      flushQuote();
      const match = trimmed.match(/^```\s*([A-Za-z0-9_-]+)?/);
      codeLanguage = match?.[1] || "";
      codeBuffer = [];
      continue;
    }

    if (codeBuffer !== null) {
      if (trimmed === "```") {
        flushCode();
      } else {
        codeBuffer.push(line);
      }
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      flushQuote();
      continue;
    }

    if (isTableRow(trimmed) && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      flushParagraph();
      flushList();
      flushQuote();
      const table = renderTable(lines, i);
      output.push(table.html);
      i = table.endIndex;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      flushQuote();
      const level = headingMatch[1].length;
      output.push(`<h${level}>${parseInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushParagraph();
      flushList();
      quoteBuffer.push(trimmed.replace(/^>\s?/, ""));
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      flushParagraph();
      flushQuote();
      listType = "ul";
      listBuffer.push(trimmed.replace(/^[-*+]\s+/, ""));
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph();
      flushQuote();
      listType = "ol";
      listBuffer.push(trimmed.replace(/^\d+\.\s+/, ""));
      continue;
    }

    if (listBuffer.length) {
      flushList();
    }

    paragraphBuffer.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushQuote();
  flushCode();

  if (output.length === 0) {
    return renderMathExpressions(`<p>${parseInlineMarkdown(normalized.trim())}</p>`);
  }

  return renderMathExpressions(output.join(""));
}

function appendTextBlocks(container, content) {
  const wrapper = document.createElement("div");
  wrapper.className = "markdown-body";
  wrapper.innerHTML = renderMarkdownToHtml(content);
  container.append(wrapper);
}

function createMessageElement(message, index, isLast) {
  const article = document.createElement("article");
  article.className = `message ${message.role}`;

  if (message.role === "assistant") {
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = "R";
    avatar.setAttribute("aria-hidden", "true");
    article.append(avatar);
  }

  const body = document.createElement("div");
  body.className = "message-body";

  const meta = document.createElement("div");
  meta.className = "message-meta";
  const author = document.createElement("span");
  author.className = "message-author";
  author.textContent = message.role === "assistant" ? "Ruang AI" : "Anda";
  const time = document.createElement("span");
  time.className = "message-time";
  time.textContent = formatTime(message.createdAt);
  meta.append(author, time);

  const content = document.createElement("div");
  content.className = "message-content";
  if (message.pending && !message.content) {
    const dots = document.createElement("div");
    dots.className = "typing-dots";
    dots.setAttribute("aria-label", "Asisten sedang menjawab");
    dots.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
    content.append(dots);
  } else {
    appendTextBlocks(content, message.content);
  }

  // Display pasted images if any
  let imageContainer = null;
  if (message.images && message.images.length > 0) {
    imageContainer = document.createElement("div");
    imageContainer.className = "message-images";
    imageContainer.style.display = "flex";
    imageContainer.style.flexWrap = "wrap";
    imageContainer.style.gap = "8px";
    imageContainer.style.marginTop = "12px";
    
    message.images.forEach((imgData) => {
      if (!imgData.dataUrl) return;
      const imgWrapper = document.createElement("div");
      imgWrapper.style.borderRadius = "8px";
      imgWrapper.style.overflow = "hidden";
      imgWrapper.style.border = "1px solid var(--line)";
      imgWrapper.style.maxWidth = "240px";
      imgWrapper.style.maxHeight = "240px";
      imgWrapper.style.cursor = "pointer";
      imgWrapper.style.transition = "opacity 150ms ease";
      imgWrapper.role = "button";
      imgWrapper.tabIndex = 0;
      imgWrapper.title = "Klik untuk melihat ukuran penuh";
      
      const img = document.createElement("img");
      img.src = imgData.dataUrl;
      img.alt = imgData.fileName;
      img.style.maxWidth = "100%";
      img.style.maxHeight = "100%";
      img.style.objectFit = "contain";
      img.style.display = "block";
      
      const clickHandler = () => openLightbox(imgData.dataUrl);
      imgWrapper.addEventListener("click", clickHandler);
      imgWrapper.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          clickHandler();
        }
      });
      imgWrapper.addEventListener("mouseenter", () => {
        imgWrapper.style.opacity = "0.8";
      });
      imgWrapper.addEventListener("mouseleave", () => {
        imgWrapper.style.opacity = "1";
      });
      
      imgWrapper.appendChild(img);
      imageContainer.appendChild(imgWrapper);
    });
  }

  body.append(meta, content);
  if (imageContainer) body.append(imageContainer);

  if (!message.pending) {
    const actions = document.createElement("div");
    actions.className = "message-actions";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Salin";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(message.content);
        showToast("Pesan disalin.");
      } catch {
        showToast("Browser tidak mengizinkan akses clipboard.");
      }
    });
    actions.append(copy);

    if (message.role === "assistant" && isLast && index > 0) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "Coba lagi";
      retry.addEventListener("click", regenerateLastResponse);
      actions.append(retry);
    }
    body.append(actions);
  }

  article.append(body);
  return article;
}

function renderMessages() {
  const conversation = getActiveConversation();
  const messages = conversation?.messages || [];
  elements.welcomeView.hidden = messages.length > 0;
  elements.messageList.hidden = messages.length === 0;
  elements.messageList.replaceChildren();

  messages.forEach((message, index) => {
    elements.messageList.append(createMessageElement(message, index, index === messages.length - 1));
  });
}

function renderAll() {
  renderSidebar();
  renderMessages();
  updateModelLabel();
}

function newConversation() {
  if (state.streaming) return showToast("Hentikan jawaban yang sedang berjalan terlebih dahulu.");
  const conversation = createConversation();
  state.conversations.unshift(conversation);
  state.activeId = conversation.id;
  saveConversations();
  renderAll();
  elements.messageInput.focus();
  closeSidebar();
}

function deleteConversation(id) {
  if (state.streaming && id === state.activeId) return showToast("Hentikan jawaban sebelum menghapus percakapan ini.");
  state.conversations = state.conversations.filter((conversation) => conversation.id !== id);
  if (!state.conversations.length) state.conversations.push(createConversation());
  if (!state.conversations.some((conversation) => conversation.id === state.activeId)) {
    state.activeId = state.conversations[0].id;
  }
  saveConversations();
  renderAll();
}

function autoResizeInput() {
  elements.messageInput.style.height = "auto";
  elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 190)}px`;
}

function scrollToBottom(smooth = true) {
  requestAnimationFrame(() => {
    elements.chatScroll.scrollTo({ top: elements.chatScroll.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  });
}

function setStreaming(streaming) {
  state.streaming = streaming;
  elements.sendButton.hidden = streaming;
  elements.stopButton.hidden = !streaming;
  elements.messageInput.disabled = streaming;
}

function extractDelta(payload) {
  const bluepackText = payload?.content
    ?.filter((part) => part?.type === "text")
    .map((part) => part.text || "")
    .join("");
  const text = bluepackText || (() => {
    const choice = payload?.choices?.[0];
    const delta = choice?.delta?.content ?? choice?.delta?.reasoning_content;
    if (typeof delta === "string") return delta;
    if (Array.isArray(delta)) {
      return delta.map((part) => part?.text || part?.content || "").join("");
    }
    return choice?.message?.content || "";
  })();
  
  // Remove internal model tags that shouldn't appear in output
  return String(text || "").replace(/<\/?(?:close|response|sepl|message)[^>]*>/gi, "");
}

async function consumeEventStream(response, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const event = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");

      if (!data || data === "[DONE]") continue;
      try {
        onDelta(extractDelta(JSON.parse(data)));
      } catch {
        // Abaikan event metadata yang bukan JSON completion.
      }
    }
  }
}

async function requestCompletion(conversation) {
  const assistantMessage = {
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
    pending: true
  };
  conversation.messages.push(assistantMessage);
  conversation.updatedAt = new Date().toISOString();
  saveConversations();
  renderAll();
  scrollToBottom();

  const messages = conversation.messages
    .filter((message) => !message.pending)
    .map(({ role, content, images }) => {
      if (role !== "user" || !images?.length) return { role, content };
      const imageParts = images
        .filter((img) => img.dataUrl)
        .map((img) => ({ type: "image_url", image_url: { url: img.dataUrl } }));
      const parts = content?.trim()
        ? [{ type: "text", text: content }, ...imageParts]
        : imageParts;
      return { role, content: parts };
    });
  if (state.settings.systemPrompt.trim()) {
    messages.unshift({ role: "system", content: state.settings.systemPrompt.trim() });
  }

  const controller = new AbortController();
  state.controller = controller;
  setStreaming(true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        model: getSelectedModel(),
        temperature: state.settings.temperature,
        maxTokens: state.settings.maxTokens
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      let errorMessage = `Permintaan gagal (${response.status}).`;
      try {
        const payload = await response.json();
        errorMessage = payload.error || errorMessage;
      } catch {
        // Gunakan pesan status bawaan.
      }
      throw new Error(errorMessage);
    }

    const updateContent = (delta) => {
      if (!delta) return;
      assistantMessage.content += delta;
      assistantMessage.pending = false;
      renderMessages();
      scrollToBottom(false);
    };

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/event-stream")) {
      await consumeEventStream(response, updateContent);
    } else {
      const payload = await response.json();
      updateContent(extractDelta(payload));
    }

    assistantMessage.pending = false;
    if (!assistantMessage.content.trim()) {
      throw new Error("AI Provider tidak mengembalikan isi jawaban.");
    }
  } catch (error) {
    assistantMessage.pending = false;
    if (error.name === "AbortError") {
      if (!assistantMessage.content.trim()) conversation.messages.pop();
      showToast("Jawaban dihentikan.");
    } else {
      if (!assistantMessage.content.trim()) conversation.messages.pop();
      showToast(error.message);
    }
  } finally {
    conversation.updatedAt = new Date().toISOString();
    state.controller = null;
    setStreaming(false);
    saveConversations();
    renderAll();
    scrollToBottom(false);
    elements.messageInput.focus();
  }
}

async function sendMessage(text) {
  const trimmed = text.trim();
  const hasImages = state.pastedImages.length > 0;
  const hasAttachments = state.attachments && state.attachments.length > 0;
  if ((!trimmed && !hasImages && !hasAttachments) || state.streaming) return;

  const conversation = getActiveConversation();
  const now = new Date().toISOString();
  
  // Build content with attachments
  let content = trimmed;
  if (hasAttachments) {
    const attachmentTexts = state.attachments.map(a => `[File: ${a.fileName}]\n${a.content}`).join("\n\n");
    content = content ? `${content}\n\n${attachmentTexts}` : attachmentTexts;
  }
  
  // Create user message with attached images
  const userMessage = { 
    role: "user", 
    content: content, 
    createdAt: now,
    images: state.pastedImages && state.pastedImages.length > 0 ? [...state.pastedImages] : []
  };
  
  conversation.messages.push(userMessage);
  conversation.updatedAt = now;

  if (conversation.title === "Percakapan baru") {
    conversation.title = trimmed
      ? (trimmed.length > 42 ? `${trimmed.slice(0, 42).trim()}…` : trimmed)
      : hasImages ? "Gambar" : "Dokumen";
  }

  elements.messageInput.value = "";
  autoResizeInput();
  
  // Clear pasted images and attachments
  state.pastedImages = [];
  elements.pastedImagePreview.replaceChildren();
  elements.pastedImagePreview.classList.remove("active");
  clearAttachments();
  
  saveConversations();
  renderAll();
  await requestCompletion(conversation);
}

async function regenerateLastResponse() {
  if (state.streaming) return;
  const conversation = getActiveConversation();
  if (!conversation || conversation.messages.at(-1)?.role !== "assistant") return;
  conversation.messages.pop();
  saveConversations();
  await requestCompletion(conversation);
}

function openSidebar() {
  document.body.classList.add("sidebar-open");
}

function closeSidebar() {
  document.body.classList.remove("sidebar-open");
}

function populateSettings() {
  elements.modelInput.value = state.settings.model || state.serverConfig?.model || "";
  elements.systemPromptInput.value = state.settings.systemPrompt;
  elements.temperatureInput.value = state.settings.temperature;
  elements.maxTokensInput.value = state.settings.maxTokens;
  elements.baseUrlInput.value = state.serverConfig?.baseUrl || "Belum tersedia";
}

function openSettings() {
  populateSettings();
  if (typeof elements.settingsDialog.showModal === "function") {
    elements.settingsDialog.showModal();
  } else {
    elements.settingsDialog.setAttribute("open", "");
  }
}

async function loadModels() {
  elements.refreshModelsButton.disabled = true;
  elements.refreshModelsButton.textContent = "Memuat…";
  try {
    const response = await fetch("/api/models");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Gagal memuat model.");

    elements.modelList.replaceChildren();
    for (const model of payload.models || []) {
      const option = document.createElement("option");
      option.value = model;
      elements.modelList.append(option);
    }
    showToast(payload.models?.length ? `${payload.models.length} model berhasil dimuat.` : "Server tidak mengembalikan daftar model.");
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.refreshModelsButton.disabled = false;
    elements.refreshModelsButton.textContent = "Muat daftar model";
  }
}

async function loadServerConfig() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error("Konfigurasi server tidak dapat dibaca.");
    state.serverConfig = await response.json();

    if (state.serverConfig.apiKeyConfigured) {
      setConnectionState(true, "Server siap");
      elements.configBanner.classList.add("connected");
      elements.configBanner.classList.remove("disconnected");
      elements.configBannerTitle.textContent = "API key sudah dikonfigurasi";
      elements.configBannerText.textContent = "Kunci tersimpan aman di server dan tidak dikirim ke browser.";
    } else {
      setConnectionState(false, "API key belum diatur");
      elements.configBanner.classList.add("disconnected");
      elements.configBanner.classList.remove("connected");
      elements.configBannerTitle.textContent = "API key belum dikonfigurasi";
      elements.configBannerText.textContent = "Salin .env.example menjadi .env, lalu isi API Provider key."
    }
    populateSettings();
    updateModelLabel();
  } catch (error) {
    setConnectionState(false, "Server tidak terjangkau");
    elements.configBannerTitle.textContent = "Server tidak terjangkau";
    elements.configBannerText.textContent = error.message;
  }
}

elements.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(elements.messageInput.value);
});

elements.messageInput.addEventListener("input", autoResizeInput);
elements.messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    elements.chatForm.requestSubmit();
  }
});

elements.messageInput.addEventListener("paste", async (event) => {
  const clipboardData = event.clipboardData || window.clipboardData;
  if (!clipboardData) return;

  const items = clipboardData.items || [];
  let foundImage = false;

  // Check for images in clipboard
  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      foundImage = true;
      event.preventDefault();
      
      const file = item.getAsFile();
      if (!file) continue;

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        addPastedImage(dataUrl, file.name);
      };
      reader.readAsDataURL(file);
    }
  }

  // If no image, handle formatted text from Word
  if (!foundImage && clipboardData.types.includes("text/html")) {
    event.preventDefault();
    const html = clipboardData.getData("text/html");
    const text = clipboardData.getData("text/plain");
    
    // Extract text from HTML and preserve basic formatting
    const textarea = document.createElement("textarea");
    textarea.innerHTML = html;
    let extractedText = textarea.value;
    
    // Use plain text if extracted text is empty
    if (!extractedText.trim()) {
      extractedText = text;
    }
    
    // Preserve line breaks and clean up excess whitespace
    extractedText = extractedText
      .split(/\n+/)
      .map(line => line.trim())
      .filter(line => line)
      .join("\n");
    
    // Insert the formatted text into the input
    if (extractedText) {
      const currentText = elements.messageInput.value;
      const selectionStart = elements.messageInput.selectionStart;
      const selectionEnd = elements.messageInput.selectionEnd;
      
      const beforeText = currentText.slice(0, selectionStart);
      const afterText = currentText.slice(selectionEnd);
      
      elements.messageInput.value = beforeText + extractedText + afterText;
      elements.messageInput.selectionStart = selectionStart + extractedText.length;
      elements.messageInput.selectionEnd = selectionStart + extractedText.length;
      
      autoResizeInput();
    }
  }
});

function addPastedImage(dataUrl, fileName) {
  if (!state.pastedImages) {
    state.pastedImages = [];
  }
  
  const id = `img-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  state.pastedImages.push({ id, dataUrl, fileName });
  
  const preview = document.createElement("div");
  preview.className = "pasted-image-item";
  preview.dataset.imageId = id;
  
  const img = document.createElement("img");
  img.src = dataUrl;
  img.alt = fileName;
  
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "pasted-image-remove";
  removeBtn.innerHTML = "×";
  removeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    state.pastedImages = state.pastedImages.filter(img => img.id !== id);
    preview.remove();
    if (elements.pastedImagePreview.children.length === 0) {
      elements.pastedImagePreview.classList.remove("active");
    }
  });
  
  preview.appendChild(img);
  preview.appendChild(removeBtn);
  elements.pastedImagePreview.appendChild(preview);
  elements.pastedImagePreview.classList.add("active");
  
  showToast(`Gambar ditambahkan: ${fileName}`);
}

function addAttachment(file) {
  if (!state.attachments) {
    state.attachments = [];
  }
  
  const id = `att-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const isImage = file.type.startsWith("image/");
  
  if (isImage) {
    const reader = new FileReader();
    reader.onload = (e) => {
      addPastedImage(e.target.result, file.name);
    };
    reader.readAsDataURL(file);
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (e) => {
    const content = e.target.result;
    state.attachments.push({ id, fileName: file.name, content, type: file.type });
    
    const item = document.createElement("div");
    item.className = "attachment-item";
    item.dataset.attachmentId = id;
    
    const icon = document.createElement("span");
    icon.className = "attachment-item-icon";
    icon.textContent = "📄";
    
    const name = document.createElement("span");
    name.className = "attachment-item-name";
    name.textContent = file.name;
    name.title = file.name;
    
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "attachment-item-remove";
    removeBtn.innerHTML = "×";
    removeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      state.attachments = state.attachments.filter(a => a.id !== id);
      item.remove();
      if (elements.attachmentPreview.children.length === 0) {
        elements.attachmentPreview.classList.remove("active");
      }
    });
    
    item.appendChild(icon);
    item.appendChild(name);
    item.appendChild(removeBtn);
    elements.attachmentPreview.appendChild(item);
    elements.attachmentPreview.classList.add("active");
    
    showToast(`Dokumen ditambahkan: ${file.name}`);
  };
  reader.readAsText(file);
}

function clearAttachments() {
  state.attachments = [];
  elements.attachmentPreview.innerHTML = "";
  elements.attachmentPreview.classList.remove("active");
}

elements.attachmentButton.addEventListener("click", () => {
  elements.fileInput.click();
});

elements.fileInput.addEventListener("change", (e) => {
  const files = Array.from(e.target.files || []);
  files.forEach(file => addAttachment(file));
  e.target.value = "";
});

elements.stopButton.addEventListener("click", () => state.controller?.abort());
elements.newChatButton.addEventListener("click", newConversation);
elements.searchInput.addEventListener("input", renderSidebar);
elements.settingsButton.addEventListener("click", openSettings);
elements.modelButton.addEventListener("click", openSettings);
elements.menuButton.addEventListener("click", openSidebar);
elements.closeSidebarButton.addEventListener("click", closeSidebar);
elements.closeSettingsButton.addEventListener("click", () => elements.settingsDialog.close());
elements.sidebarBackdrop.addEventListener("click", closeSidebar);
elements.refreshModelsButton.addEventListener("click", loadModels);
elements.themeToggle.addEventListener("click", toggleTheme);

// Lightbox event listeners
elements.lightboxClose.addEventListener("click", closeLightbox);
elements.lightbox.addEventListener("click", (event) => {
  if (event.target === elements.lightbox) closeLightbox();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.lightbox.classList.contains("active")) {
    closeLightbox();
  }
});

elements.settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const temperature = Number(elements.temperatureInput.value);
  const maxTokens = Number(elements.maxTokensInput.value);
  state.settings = {
    model: elements.modelInput.value.trim(),
    systemPrompt: elements.systemPromptInput.value.trim(),
    temperature: Number.isFinite(temperature) ? Math.min(2, Math.max(0, temperature)) : 0.7,
    maxTokens: Number.isFinite(maxTokens) ? Math.min(65536, Math.max(1, Math.round(maxTokens))) : 2048
  };
  saveSettings();
  updateModelLabel();
  elements.settingsDialog.close();
  showToast("Pengaturan disimpan.");
});

elements.suggestionGrid.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-prompt]");
  if (!button) return;
  elements.messageInput.value = button.dataset.prompt;
  autoResizeInput();
  elements.messageInput.focus();
});

loadTheme();
loadState();
renderAll();
populateSettings();
loadServerConfig();
