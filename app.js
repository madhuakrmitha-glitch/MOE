(() => {
  "use strict";

  const STORAGE_KEY = "moe.rooms.v1";
  const MAX_AGENTS = 8;
  const COLORS = ["#648a6e", "#c17a63", "#6f80a6", "#9a7dba", "#6b9a9b", "#b38655", "#858d68", "#bd7180"];
  const $ = (selector, root = document) => root.querySelector(selector);
  const uid = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const presets = [
    { name: "Nova", provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", apiKey: "", systemPrompt: "You are the pragmatic analyst. Bring structure, evidence, and clear next steps. Point out assumptions when they matter.", temperature: 0.6 },
    { name: "Mira", provider: "ollama", baseUrl: "http://localhost:11434", model: "llama3.2", apiKey: "", systemPrompt: "You are the imaginative challenger. Explore unconventional ideas, notice blind spots, and make abstract ideas concrete.", temperature: 0.8 },
    { name: "Atlas", provider: "huggingface", baseUrl: "https://router.huggingface.co/v1", model: "Qwen/Qwen3-8B", apiKey: "", systemPrompt: "You are the careful synthesizer. Connect the strongest points from the group, surface trade-offs, and end with a concise synthesis.", temperature: 0.5 },
  ];

  function newAgent(preset = {}) {
    const number = Math.floor(Math.random() * 90) + 10;
    return { id: uid(), ...preset, name: preset.name || `Agent ${number}`, provider: preset.provider || "openai", baseUrl: preset.baseUrl || "https://api.openai.com/v1", model: preset.model || "", apiKey: preset.apiKey || "", systemPrompt: preset.systemPrompt || "You are a helpful participant in this group. Add a distinct perspective and respond to the latest topic.", temperature: preset.temperature ?? 0.7 };
  }

  function makeRoom(title = "New group chat", agents = presets.map((p) => newAgent(p))) {
    return {
      id: uid(), title, roomPrompt: "Stay focused on the user's topic. Each agent speaks in its own voice, adds a useful perspective, and responds to earlier agents when the room is in roundtable mode. Be concise and flag uncertainty.",
      interactionMode: "round", rounds: 2, agents, messages: [], updatedAt: Date.now(),
    };
  }

  function loadStore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (parsed?.rooms?.length) {
        parsed.rooms = parsed.rooms.map((room) => ({ ...makeRoom(room.title || "New group chat", []), ...room, agents: Array.isArray(room.agents) ? room.agents.map((agent) => ({ ...newAgent(), ...agent })) : presets.map((p) => newAgent(p)), messages: Array.isArray(room.messages) ? room.messages : [] }));
        return parsed;
      }
    } catch (error) {
      console.warn("Could not read the saved MOE workspace.", error);
    }
    const room = makeRoom();
    return { activeRoomId: room.id, rooms: [room] };
  }

  let store = loadStore();
  let isRunning = false;
  let abortController = null;
  let toastTimer = null;

  function currentRoom() {
    return store.rooms.find((room) => room.id === store.activeRoomId) || store.rooms[0];
  }

  function persist() {
    const room = currentRoom();
    if (room) room.updatedAt = Date.now();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }
    catch (error) { showToast("This browser could not save the workspace. Check local storage settings."); }
  }

  function esc(value = "") {
    return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }

  function colorFor(agent, index = 0) {
    let hash = 0;
    for (const char of agent.id || agent.name || String(index)) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    return COLORS[Math.abs(hash) % COLORS.length];
  }

  function initials(name = "AI") {
    return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "AI";
  }

  function providerLabel(provider) {
    return provider === "ollama" ? "Ollama" : provider === "huggingface" ? "Hugging Face" : "OpenAI compatible";
  }

  function providerDefaults(provider) {
    if (provider === "ollama") return { baseUrl: "http://localhost:11434", model: "llama3.2" };
    if (provider === "huggingface") return { baseUrl: "https://router.huggingface.co/v1", model: "Qwen/Qwen3-8B" };
    return { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" };
  }

  function icon(name, size = 16) {
    const paths = {
      plus: '<path d="M12 5v14M5 12h14"/>',
      chat: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>',
      copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
      trash: '<path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/>',
      eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
      eyeOff: '<path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a15.8 15.8 0 0 1-3 3.8M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7a10.7 10.7 0 0 0 4-.8"/>',
      send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
      stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
      lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
      sparkle: '<path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z"/><path d="m19 14 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z"/>',
      menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    };
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.chat}</svg>`;
  }

  function messageTime(timestamp) {
    try { return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(timestamp)); }
    catch { return ""; }
  }

  function renderMessage(message, index, room) {
    if (message.role === "user") {
      return `<article class="message-row user-row"><div class="message-body"><div class="message-head"><span class="message-name">You</span><time class="message-time">${messageTime(message.timestamp)}</time></div><div class="message-bubble">${esc(message.content)}</div></div><div class="message-avatar" style="background:#a78169">${icon("chat", 14)}</div></article>`;
    }
    const agentIndex = room.agents.findIndex((agent) => agent.id === message.agentId);
    const agent = room.agents[agentIndex] || { name: message.agentName || "Agent", provider: "openai", model: "", id: message.agentId || "unknown" };
    const isError = message.role === "error";
    const roundMarker = message.round && (index === 0 || room.messages[index - 1]?.round !== message.round) ? `<div class="round-label">${message.round === 1 ? "First pass" : `Round ${message.round}`}</div>` : "";
    return `${roundMarker}<article class="message-row ${isError ? "error-row" : ""}"><div class="message-avatar" style="background:${colorFor(agent, agentIndex)}">${esc(initials(agent.name))}</div><div class="message-body"><div class="message-head"><span class="message-name">${esc(agent.name)}</span><span class="message-model">${esc(providerLabel(agent.provider))}${agent.model ? ` · ${esc(agent.model)}` : ""}</span><time class="message-time">${messageTime(message.timestamp)}</time></div><div class="message-bubble">${esc(message.content)}</div></div></article>`;
  }

  function renderWelcome() {
    return `<section class="welcome"><div class="welcome-art"><div class="welcome-orbit">MOE</div></div><h1>Your room, your rules.</h1><p>Set a topic, give every agent a point of view, and watch different models think together.</p><div class="suggestion-grid"><button class="suggestion" data-prompt="Help me compare the pros and cons of a four-day work week. Have each agent take a distinct perspective, then find common ground."><span>Try a roundtable</span>Compare the case for a four-day work week</button><button class="suggestion" data-prompt="Help me brainstorm a small GenAI product idea for aviation maintenance teams. Be practical about the user and the first version."><span>Explore an idea</span>Brainstorm a useful GenAI product</button><button class="suggestion" data-prompt="Review my plan critically. What assumptions are weak, what might I be missing, and what would you test first?"><span>Pressure-test</span>Find the weak spots in a plan</button><button class="suggestion" data-prompt="Explain a difficult topic in plain language, then have the agents add examples and point out where the explanation could mislead."><span>Learn together</span>Make a tricky topic easier to grasp</button></div><div class="welcome-tip">${icon("sparkle", 13)} Add each agent's provider details in Room setup to begin.</div></section>`;
  }

  function agentReady(agent) {
    return agent.provider === "ollama" || Boolean(agent.apiKey);
  }

  function renderAgent(agent, index) {
    const color = colorFor(agent, index);
    const providerText = providerLabel(agent.provider);
    const status = agentReady(agent) ? (agent.provider === "ollama" ? "Local" : "Ready") : "Add key";
    const isOpen = index === 0;
    const providerNote = agent.provider === "ollama"
      ? "Uses Ollama's local /api/chat endpoint. Ollama must be running and allow browser access."
      : agent.provider === "huggingface"
        ? "Uses Hugging Face's OpenAI-compatible router. Paste a personal access token."
        : "Uses a chat-completions-compatible endpoint. Add /v1 to the base URL when required.";
    return `<details class="agent-card" ${isOpen ? "open" : ""} data-agent-card="${esc(agent.id)}"><summary class="agent-summary"><span class="agent-avatar" style="background:${color}">${esc(initials(agent.name))}</span><span class="agent-summary-copy"><span class="agent-summary-name" data-agent-name-preview="${esc(agent.id)}">${esc(agent.name)}</span><span class="agent-summary-model"><i class="provider-dot" style="background:${color}"></i><span data-agent-model-preview="${esc(agent.id)}">${esc(agent.model || providerText)}</span></span></span><span class="agent-summary-status ${agentReady(agent) ? "ready" : ""}" data-agent-status="${esc(agent.id)}">${status}</span></summary><div class="agent-fields">
      <div class="two-col"><label><span class="field-label">Agent name</span><input class="text-control" data-agent-field="name" data-agent-id="${esc(agent.id)}" value="${esc(agent.name)}" placeholder="e.g. The Analyst" /></label><label><span class="field-label">Provider</span><select class="select-control" data-agent-field="provider" data-agent-id="${esc(agent.id)}"><option value="openai" ${agent.provider === "openai" ? "selected" : ""}>OpenAI compatible</option><option value="ollama" ${agent.provider === "ollama" ? "selected" : ""}>Ollama</option><option value="huggingface" ${agent.provider === "huggingface" ? "selected" : ""}>Hugging Face</option></select></label></div>
      <label><span class="field-label">Model</span><input class="text-control" data-agent-field="model" data-agent-id="${esc(agent.id)}" value="${esc(agent.model)}" placeholder="Model name or ID" /></label>
      <label><span class="field-label">Base URL <span>${esc(providerText)}</span></span><input class="text-control" data-agent-field="baseUrl" data-agent-id="${esc(agent.id)}" value="${esc(agent.baseUrl)}" placeholder="https://…" spellcheck="false" /></label>
      <label class="${agent.provider === "ollama" ? "hidden" : ""}" data-key-field="${esc(agent.id)}"><span class="field-label">API key <span>stored on this device</span></span><span class="secret-wrap"><input class="key-control" data-agent-field="apiKey" data-agent-id="${esc(agent.id)}" type="password" value="${esc(agent.apiKey)}" placeholder="${agent.provider === "huggingface" ? "hf_…" : "sk-…"}" autocomplete="off" spellcheck="false" /><button class="reveal-key" type="button" data-action="reveal-key" aria-label="Show API key">${icon("eye", 14)}</button></span></label>
      <label><span class="field-label">Agent system prompt</span><textarea class="text-control" data-agent-field="systemPrompt" data-agent-id="${esc(agent.id)}" placeholder="What perspective and behavior should this agent bring?">${esc(agent.systemPrompt)}</textarea></label>
      <div class="two-col"><label><span class="field-label">Temperature <span data-temperature-value="${esc(agent.id)}">${Number(agent.temperature ?? 0.7).toFixed(1)}</span></span><input class="text-control" type="number" min="0" max="2" step="0.1" data-agent-field="temperature" data-agent-id="${esc(agent.id)}" value="${esc(agent.temperature ?? 0.7)}" /></label><div><span class="field-label">Connection</span><div class="text-control" style="color:${agentReady(agent) ? "#628668" : "#9b8170"};background:#fbfbf8">${esc(status)}</div></div></div>
      <p class="provider-note">${esc(providerNote)}</p>
      ${roomAgentCount() > 1 ? `<button class="agent-remove" type="button" data-action="remove-agent" data-agent-id="${esc(agent.id)}">${icon("trash", 12)} Remove agent</button>` : ""}
    </div></details>`;
  }

  function roomAgentCount() { return currentRoom()?.agents.length || 0; }

  function renderRoomItem(room) {
    const active = room.id === store.activeRoomId;
    const count = room.messages.filter((m) => m.role === "user").length;
    return `<div class="room-item ${active ? "active" : ""}" data-room-id="${esc(room.id)}" role="button" tabindex="0"><span class="room-icon">${icon("chat", 14)}</span><span class="room-info"><span class="room-title" data-room-title="${esc(room.id)}">${esc(room.title)}</span><span class="room-meta">${count ? `${count} ${count === 1 ? "message" : "messages"}` : "New conversation"}</span></span><button class="room-delete" type="button" data-action="delete-room" data-room-id="${esc(room.id)}" aria-label="Delete conversation">${icon("trash", 12)}</button></div>`;
  }

  function renderApp() {
    const room = currentRoom();
    const agentCount = room.agents.length;
    const avatars = room.agents.slice(0, 4).map((agent, index) => `<span class="participant-avatar" style="background:${colorFor(agent, index)}">${esc(initials(agent.name))}</span>`).join("");
    const messages = room.messages.length ? `<div class="message-list">${room.messages.map((message, index) => renderMessage(message, index, room)).join("")}</div>` : renderWelcome();
    const modeText = room.interactionMode === "round" ? `Roundtable · ${room.rounds} rounds` : "One pass · all agents";
    const recentRooms = [...store.rooms].sort((a, b) => b.updatedAt - a.updatedAt);
    $("#app").innerHTML = `<div class="app-shell">
      <aside class="sidebar" id="sidebar"><div class="brand"><span class="brand-mark">m</span><div><div class="brand-name">moe</div><div class="brand-caption">multi-agent rooms</div></div></div><button class="new-room-btn" data-action="new-room">${icon("plus", 16)} New conversation</button><div class="sidebar-label">Your rooms <span>${store.rooms.length}</span></div><nav class="room-list" aria-label="Conversations">${recentRooms.map(renderRoomItem).join("") || `<div class="empty-history">Your saved conversations appear here.</div>`}</nav><div class="sidebar-spacer"></div><div class="sidebar-note"><strong>A room for many minds.</strong><br />Mix models and personalities. You decide how the conversation flows.</div><div class="profile-row"><span class="profile-avatar">A</span><div class="profile-copy">Personal workspace<small>Saved in this browser</small></div></div></aside>
      <main class="workspace"><header class="topbar"><div class="topbar-leading"><button class="icon-btn mobile-rooms-btn" data-action="toggle-sidebar" aria-label="Open conversations">${icon("menu", 16)}</button><div><input class="room-title-input" data-field="title" aria-label="Conversation title" value="${esc(room.title)}" /><div class="room-subtitle"><span class="online-dot"></span>${agentCount} ${agentCount === 1 ? "agent" : "agents"} · ${esc(modeText)}</div></div></div><div class="topbar-actions"><div class="participant-stack" aria-label="Agents">${avatars}<span class="participant-count">${agentCount} in the room</span></div><span class="topbar-divider"></span><button class="icon-btn" data-action="copy" title="Copy conversation" aria-label="Copy conversation">${icon("copy", 15)}</button><button class="icon-btn danger" data-action="clear" title="Clear messages" aria-label="Clear messages">${icon("trash", 15)}</button></div></header><section class="chat-area"><div class="chat-scroll" id="chat-scroll">${messages}</div><div class="run-status" id="run-status"><span class="typing"><i></i><i></i><i></i></span><span id="run-label">Agents are thinking…</span></div><div class="composer-wrap"><form class="composer" id="composer"><textarea id="message-input" rows="2" placeholder="Message the group…" aria-label="Message the group"></textarea><div class="composer-bottom"><span class="composer-hint">Enter to send · Shift + Enter for a new line</span><div class="composer-controls"><span class="mode-pill">${icon("sparkle", 12)}<select data-field="mode" aria-label="Interaction mode"><option value="once" ${room.interactionMode === "once" ? "selected" : ""}>One pass</option><option value="round" ${room.interactionMode === "round" ? "selected" : ""}>Roundtable</option></select></span><button class="stop-btn" type="button" data-action="stop">${icon("stop", 12)} Stop</button><button class="send-btn" type="submit" ${isRunning ? "disabled" : ""} aria-label="Send message">${icon("send", 15)}</button></div></div></form><p class="composer-footnote">Responses come directly from each model provider. Review important answers before acting on them.</p></div></section></main>
      <aside class="setup-panel"><header class="setup-header"><div><div class="setup-kicker">Configure this room</div><h2>Room setup</h2></div><span class="setup-count">${agentCount} / ${MAX_AGENTS} agents</span></header><div class="setup-scroll"><section class="room-prompt-field"><div class="section-heading">Shared room instructions <span class="section-hint">applies to everyone</span></div><label><textarea class="text-control" data-field="roomPrompt" placeholder="Set the topic, rules, or interaction pattern for this room…">${esc(room.roomPrompt)}</textarea></label></section><section class="interaction-card"><div class="section-heading">How should they talk?</div><div class="interaction-grid"><label><span class="field-label">Conversation style</span><select class="select-control" data-field="mode"><option value="once" ${room.interactionMode === "once" ? "selected" : ""}>Each agent replies once</option><option value="round" ${room.interactionMode === "round" ? "selected" : ""}>Agents discuss together</option></select></label><label class="round-count ${room.interactionMode === "round" ? "visible" : ""}" id="round-count"><span class="field-label">Rounds</span><input class="text-control" type="number" min="1" max="5" step="1" data-field="rounds" value="${room.rounds}" /></label></div></section><div class="divider-label"><span>Agents</span><button class="add-agent-btn" data-action="add-agent" ${agentCount >= MAX_AGENTS ? "disabled" : ""}>${icon("plus", 12)} Add agent</button></div><section class="agent-list">${room.agents.map(renderAgent).join("")}</section><div class="privacy-note">${icon("lock", 13)}<span>API keys and room history are stored in this browser only. Requests go directly from this page to your selected provider.</span></div></div></aside>
      </div><div class="toast" id="toast" role="status" aria-live="polite"></div>`;
    updateComposerState();
  }

  function showToast(message) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
  }

  function updateComposerState() {
    const stop = $(".stop-btn");
    const send = $(".send-btn");
    if (stop) stop.classList.toggle("visible", isRunning);
    if (send) send.disabled = isRunning;
    const status = $("#run-status");
    if (status) status.classList.toggle("visible", isRunning);
  }

  function setRunLabel(text) {
    const label = $("#run-label");
    if (label) label.textContent = text;
  }

  function scrollToBottom() {
    const scroll = $("#chat-scroll");
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }

  function updateAgentPreview(agent) {
    const name = $(`[data-agent-name-preview="${CSS.escape(agent.id)}"]`);
    const model = $(`[data-agent-model-preview="${CSS.escape(agent.id)}"]`);
    const status = $(`[data-agent-status="${CSS.escape(agent.id)}"]`);
    if (name) name.textContent = agent.name || "Unnamed agent";
    if (model) model.textContent = agent.model || providerLabel(agent.provider);
    if (status) {
      status.textContent = agentReady(agent) ? (agent.provider === "ollama" ? "Local" : "Ready") : "Add key";
      status.classList.toggle("ready", agentReady(agent));
    }
  }

  function handleInput(event) {
    const target = event.target;
    const room = currentRoom();
    if (target.dataset.field && target.dataset.field !== "mode") {
      const field = target.dataset.field;
      if (field === "title") {
        room.title = target.value.trim() || "New group chat";
        const title = $(`[data-room-title="${CSS.escape(room.id)}"]`);
        if (title) title.textContent = room.title;
      } else if (field === "roomPrompt") room.roomPrompt = target.value;
      else if (field === "rounds") room.rounds = Math.max(1, Math.min(5, Number(target.value) || 1));
      persist();
    }
    if (target.dataset.agentField) {
      const agent = room.agents.find((item) => item.id === target.dataset.agentId);
      if (!agent) return;
      const field = target.dataset.agentField;
      agent[field] = field === "temperature" ? Math.max(0, Math.min(2, Number(target.value) || 0)) : target.value;
      if (field === "name" || field === "model" || field === "apiKey") updateAgentPreview(agent);
      const temperatureValue = $(`[data-temperature-value="${CSS.escape(agent.id)}"]`);
      if (temperatureValue && field === "temperature") temperatureValue.textContent = Number(agent.temperature).toFixed(1);
      persist();
    }
  }

  function handleChange(event) {
    const target = event.target;
    const room = currentRoom();
    if (target.dataset.field === "mode") {
      room.interactionMode = target.value;
      persist();
      renderApp();
    } else if (target.dataset.agentField === "provider") {
      const agent = room.agents.find((item) => item.id === target.dataset.agentId);
      if (!agent) return;
      const previousProvider = agent.provider;
      agent.provider = target.value;
      const defaults = providerDefaults(agent.provider);
      if (!agent.baseUrl || agent.baseUrl === providerDefaults(previousProvider).baseUrl) agent.baseUrl = defaults.baseUrl;
      if (!agent.model || agent.model === providerDefaults(previousProvider).model) agent.model = defaults.model;
      if (agent.provider === "ollama") agent.apiKey = "";
      persist();
      renderApp();
      const card = $(`[data-agent-card="${CSS.escape(agent.id)}"]`);
      if (card) card.open = true;
    } else if (target.dataset.field === "rounds") {
      room.rounds = Math.max(1, Math.min(5, Number(target.value) || 1));
      target.value = room.rounds;
      persist();
    }
  }

  function cloneAgents(room) {
    return room.agents.map((agent) => ({ ...agent, id: uid() }));
  }

  function addRoom() {
    if (isRunning) return showToast("Wait for the current round to finish before switching rooms.");
    const previous = currentRoom();
    const room = makeRoom("New group chat", cloneAgents(previous));
    store.rooms.unshift(room);
    store.activeRoomId = room.id;
    persist();
    renderApp();
    showToast("New conversation ready.");
  }

  function addAgent() {
    const room = currentRoom();
    if (room.agents.length >= MAX_AGENTS) return showToast(`A room can have up to ${MAX_AGENTS} agents.`);
    room.agents.push(newAgent({ name: `Agent ${room.agents.length + 1}` }));
    persist();
    renderApp();
    const card = $(".agent-card:last-child");
    if (card) { card.open = true; card.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  }

  function removeAgent(id) {
    const room = currentRoom();
    if (room.agents.length <= 1) return showToast("A room needs at least one agent.");
    const agent = room.agents.find((item) => item.id === id);
    room.agents = room.agents.filter((item) => item.id !== id);
    persist();
    renderApp();
    showToast(`${agent?.name || "Agent"} removed from the room.`);
  }

  function selectRoom(id) {
    if (isRunning) return showToast("Wait for the current round to finish before switching rooms.");
    if (!store.rooms.some((room) => room.id === id)) return;
    store.activeRoomId = id;
    persist();
    renderApp();
    $("#sidebar")?.classList.remove("open");
  }

  function deleteRoom(id) {
    if (store.rooms.length === 1) {
      const room = currentRoom();
      room.messages = [];
      room.title = "New group chat";
      persist();
      renderApp();
      return showToast("Conversation cleared.");
    }
    const room = store.rooms.find((item) => item.id === id);
    store.rooms = store.rooms.filter((item) => item.id !== id);
    if (store.activeRoomId === id) store.activeRoomId = store.rooms[0].id;
    persist();
    renderApp();
    showToast(`“${room?.title || "Conversation"}” deleted.`);
  }

  function endpointFor(agent) {
    let base = (agent.baseUrl || "").trim().replace(/\/+$/, "");
    if (!base) throw new Error("Add a provider base URL in Room setup.");
    if (agent.provider === "ollama") {
      if (/\/api\/chat$/i.test(base)) return base;
      if (/\/api$/i.test(base)) return `${base}/chat`;
      return `${base}/api/chat`;
    }
    if (/\/chat\/completions$/i.test(base)) return base;
    if (/\/v1$/i.test(base)) return `${base}/chat/completions`;
    return `${base}/v1/chat/completions`;
  }

  function buildMessages(room, agent) {
    const interaction = room.interactionMode === "round"
      ? `The group is in roundtable mode. This is one of ${room.rounds} rounds. Build on useful points from earlier agents, and disagree respectfully when your reasoning differs.`
      : "Each agent is replying once to the user. Give your own useful perspective without pretending to speak for other agents.";
    const system = `You are ${agent.name}, one AI agent in the group conversation “${room.title}”.\n\nShared room instructions:\n${room.roomPrompt || "Stay focused on the user's topic and contribute a useful perspective."}\n\nYour individual instructions:\n${agent.systemPrompt || "Be a helpful participant and add a distinct perspective."}\n\nInteraction pattern:\n${interaction}\n\nSpeak in your own voice. Refer to other agents by name when responding to their ideas. Do not invent what another agent said. Answer the latest user topic directly, and keep your response clear and conversational.`;
    const history = room.messages.filter((message) => message.role === "user" || message.role === "agent").slice(-36).map((message) => {
      if (message.role === "user") return { role: "user", content: message.content };
      const speaker = room.agents.find((item) => item.id === message.agentId)?.name || message.agentName || "Agent";
      return { role: "assistant", content: `${speaker}: ${message.content}` };
    });
    return [{ role: "system", content: system }, ...history];
  }

  async function readResponse(response) {
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!response.ok) {
      const detail = data?.error?.message || data?.error || data?.message || data?.raw || response.statusText;
      throw new Error(`${response.status} ${response.statusText}${detail ? ` — ${String(detail).slice(0, 280)}` : ""}`);
    }
    return data;
  }

  function extractText(data, provider) {
    const value = provider === "ollama" ? data?.message?.content : data?.choices?.[0]?.message?.content;
    if (typeof value === "string") return value.trim();
    if (Array.isArray(value)) return value.map((part) => typeof part === "string" ? part : part?.text || "").join("").trim();
    if (!value && data?.generated_text) return String(data.generated_text).trim();
    return "";
  }

  async function callAgent(room, agent, signal) {
    if (!agent.model?.trim()) throw new Error("Add a model name or ID in Room setup.");
    const endpoint = endpointFor(agent);
    const headers = { "Content-Type": "application/json" };
    if (agent.apiKey?.trim()) headers.Authorization = `Bearer ${agent.apiKey.trim()}`;
    const isOllama = agent.provider === "ollama";
    const payload = isOllama
      ? { model: agent.model.trim(), messages: buildMessages(room, agent), stream: false, options: { temperature: Number(agent.temperature ?? 0.7) } }
      : { model: agent.model.trim(), messages: buildMessages(room, agent), temperature: Number(agent.temperature ?? 0.7), stream: false };
    const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload), signal });
    const data = await readResponse(response);
    const text = extractText(data, agent.provider);
    if (!text) throw new Error("The provider returned an empty response. Check the model and endpoint settings.");
    return text;
  }

  function providerError(agent, error) {
    if (error?.name === "AbortError") return "Request stopped.";
    const detail = error?.message || "Unknown error";
    if (/failed to fetch|networkerror|load failed/i.test(detail)) return `${providerLabel(agent.provider)} connection failed. Check the endpoint, network access, and provider CORS settings. (${detail})`;
    return `${providerLabel(agent.provider)} request failed: ${detail}`;
  }

  async function sendMessage(rawText) {
    const text = rawText.trim();
    if (!text || isRunning) return;
    const room = currentRoom();
    if (!room.agents.length) return showToast("Add at least one agent in Room setup.");
    if (room.messages.length === 0 && room.title === "New group chat") room.title = text.length > 38 ? `${text.slice(0, 37).trimEnd()}…` : text;
    room.messages.push({ id: uid(), role: "user", content: text, timestamp: Date.now() });
    persist();
    isRunning = true;
    abortController = new AbortController();
    renderApp();
    scrollToBottom();
    const rounds = room.interactionMode === "round" ? Math.max(1, Math.min(5, Number(room.rounds) || 1)) : 1;
    const agents = [...room.agents];
    try {
      for (let round = 1; round <= rounds; round += 1) {
        for (let index = 0; index < agents.length; index += 1) {
          if (abortController.signal.aborted) break;
          const agent = agents[index];
          setRunLabel(rounds > 1 ? `${agent.name} is thinking · round ${round} of ${rounds}` : `${agent.name} is thinking…`);
          try {
            const content = await callAgent(room, agent, abortController.signal);
            if (abortController.signal.aborted) break;
            room.messages.push({ id: uid(), role: "agent", agentId: agent.id, agentName: agent.name, content, timestamp: Date.now(), round });
          } catch (error) {
            if (error?.name === "AbortError" || abortController.signal.aborted) break;
            room.messages.push({ id: uid(), role: "error", agentId: agent.id, agentName: agent.name, content: providerError(agent, error), timestamp: Date.now(), round });
          }
          persist();
          renderApp();
          scrollToBottom();
        }
        if (abortController.signal.aborted) break;
      }
    } finally {
      isRunning = false;
      abortController = null;
      persist();
      updateComposerState();
      const status = $("#run-status");
      if (status) status.classList.remove("visible");
      renderApp();
      scrollToBottom();
    }
  }

  async function copyConversation() {
    const room = currentRoom();
    const content = [`# ${room.title}`, `\nShared instructions: ${room.roomPrompt}`, "", ...room.messages.map((message) => {
      const name = message.role === "user" ? "You" : room.agents.find((agent) => agent.id === message.agentId)?.name || message.agentName || "Agent";
      return `**${name}:**\n${message.content}`;
    })].join("\n\n");
    try {
      await navigator.clipboard.writeText(content);
      showToast("Conversation copied to clipboard.");
    } catch {
      showToast("Clipboard access is unavailable in this browser.");
    }
  }

  function onClick(event) {
    const promptButton = event.target.closest("[data-prompt]");
    if (promptButton) {
      const input = $("#message-input");
      if (input) { input.value = promptButton.dataset.prompt; input.focus(); }
      return;
    }
    const actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      const action = actionButton.dataset.action;
      if (action === "new-room") addRoom();
      if (action === "add-agent") addAgent();
      if (action === "remove-agent") removeAgent(actionButton.dataset.agentId);
      if (action === "toggle-sidebar") $("#sidebar")?.classList.toggle("open");
      if (action === "copy") copyConversation();
      if (action === "stop" && abortController) abortController.abort();
      if (action === "clear") {
        if (!currentRoom().messages.length || window.confirm("Clear the messages in this conversation?")) {
          currentRoom().messages = [];
          persist();
          renderApp();
          showToast("Conversation cleared.");
        }
      }
      if (action === "delete-room") {
        event.stopPropagation();
        const targetRoom = store.rooms.find((room) => room.id === actionButton.dataset.roomId);
        if (targetRoom && (store.rooms.length === 1 || window.confirm(`Delete “${targetRoom.title}”?`))) deleteRoom(actionButton.dataset.roomId);
      }
      if (action === "reveal-key") {
        const input = actionButton.parentElement?.querySelector("input");
        if (input) {
          const show = input.type === "password";
          input.type = show ? "text" : "password";
          actionButton.innerHTML = icon(show ? "eyeOff" : "eye", 14);
          actionButton.setAttribute("aria-label", show ? "Hide API key" : "Show API key");
        }
      }
      return;
    }
    const roomItem = event.target.closest(".room-item");
    if (roomItem) selectRoom(roomItem.dataset.roomId);
  }

  function onKeydown(event) {
    if (event.target.matches(".room-item") && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      selectRoom(event.target.dataset.roomId);
    }
    if (event.target.id === "message-input" && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      $("#composer")?.requestSubmit();
    }
  }

  function onSubmit(event) {
    if (event.target.id !== "composer") return;
    event.preventDefault();
    const input = $("#message-input");
    const message = input?.value || "";
    if (input) input.value = "";
    sendMessage(message);
  }

  const app = $("#app");
  app.addEventListener("click", onClick);
  app.addEventListener("input", handleInput);
  app.addEventListener("change", handleChange);
  app.addEventListener("keydown", onKeydown);
  app.addEventListener("submit", onSubmit);
  renderApp();
})();
