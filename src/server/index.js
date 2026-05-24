import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, createStore } from "./db.js";
import { createIngestionRouter } from "./ingestion.js";
import { resolveProvider } from "./providers.js";
import { streamWithInferenceLogging } from "./llmLogger.js";
import { startIngestionWorker } from "./worker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 8080);
const databasePath = process.env.DATABASE_PATH || path.resolve(process.cwd(), "data/app.sqlite");
const db = openDatabase(databasePath);
const store = createStore(db);
startIngestionWorker(store);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, databasePath });
});

app.use("/api/ingest", createIngestionRouter(express, store));

app.get("/api/conversations", (req, res) => {
  res.json(store.listConversations());
});

app.post("/api/conversations", (req, res) => {
  const providerClient = resolveProvider(req.body || {});
  const conversation = store.createConversation({
    title: req.body?.title || "New conversation",
    provider: providerClient.provider,
    model: providerClient.model
  });
  res.status(201).json(conversation);
});

app.patch("/api/conversations/:id/status", (req, res) => {
  const status = req.body?.status;
  if (!["active", "cancelled", "archived"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  const conversation = store.setConversationStatus(req.params.id, status);
  if (!conversation) return res.status(404).json({ error: "Conversation not found" });
  res.json(conversation);
});

app.get("/api/conversations/:id/messages", (req, res) => {
  const conversation = store.getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: "Conversation not found" });
  res.json(store.listMessages(req.params.id));
});

app.get("/api/logs", (req, res) => {
  res.json(store.recentLogs(Number(req.query.limit || 25)));
});

app.get("/api/metrics", (req, res) => {
  res.json(store.metrics());
});

app.post("/api/chat", async (req, res) => {
  const userMessage = String(req.body?.message || "").trim();
  if (!userMessage) return res.status(400).json({ error: "Message is required" });

  const providerClient = resolveProvider(req.body || {});
  const conversation = store.upsertConversation({
    id: req.body?.conversationId,
    title: userMessage.slice(0, 48),
    provider: providerClient.provider,
    model: providerClient.model
  });

  store.addMessage({ conversationId: conversation.id, role: "user", content: userMessage });
  const context = [
    { role: "system", content: "You are a concise, helpful assistant. Keep answers practical." },
    ...store.getContextMessages(conversation.id, 8)
  ];

  const abortController = new AbortController();
  let streamClosed = false;
  res.on("close", () => {
    if (!streamClosed) abortController.abort();
  });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });

  const send = (event, data) => {
    if (res.destroyed) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send("conversation", conversation);

  try {
    const result = await streamWithInferenceLogging({
      providerClient,
      conversationId: conversation.id,
      messages: context,
      signal: abortController.signal,
      onToken: (token) => send("token", { token })
    });
    const assistant = store.addMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: result.content,
      provider: result.provider,
      model: result.model,
      inferenceLogId: result.id
    });
    send("done", { conversationId: conversation.id, message: assistant });
  } catch (error) {
    if (abortController.signal.aborted) {
      store.setConversationStatus(conversation.id, "cancelled");
      send("cancelled", { conversationId: conversation.id });
    } else {
      send("error", { message: error.message });
    }
  } finally {
    streamClosed = true;
    if (!res.destroyed) res.end();
  }
});

const distPath = path.resolve(__dirname, "../../dist");
app.use(express.static(distPath));
app.get(/.*/, (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(port, () => {
  console.log(`Inference logger listening on http://localhost:${port}`);
});
