import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

const now = () => new Date().toISOString();

export function openDatabase(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
  db.exec(schema);
  return db;
}

export function createStore(db) {
  const statements = {
    createConversation: db.prepare(`
      INSERT INTO conversations (id, title, status, provider, model, created_at, updated_at)
      VALUES (?, ?, 'active', ?, ?, ?, ?)
    `),
    updateConversation: db.prepare(`
      UPDATE conversations SET title = ?, provider = ?, model = ?, updated_at = ? WHERE id = ?
    `),
    setConversationStatus: db.prepare(`
      UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?
    `),
    touchConversation: db.prepare(`
      UPDATE conversations SET updated_at = ? WHERE id = ?
    `),
    listConversations: db.prepare(`
      SELECT c.*,
        (SELECT content FROM chat_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message
      FROM conversations c
      ORDER BY updated_at DESC
    `),
    getConversation: db.prepare(`SELECT * FROM conversations WHERE id = ?`),
    addMessage: db.prepare(`
      INSERT INTO chat_messages (id, conversation_id, role, content, provider, model, inference_log_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listMessages: db.prepare(`
      SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC
    `),
    getContextMessages: db.prepare(`
      SELECT role, content FROM chat_messages
      WHERE conversation_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `),
    insertLog: db.prepare(`
      INSERT OR REPLACE INTO inference_logs (
        id, conversation_id, provider, model, status, error_message, latency_ms, first_token_ms,
        input_tokens, output_tokens, total_tokens, input_preview, output_preview,
        started_at, completed_at, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertEvent: db.prepare(`
      INSERT INTO ingestion_events (id, inference_log_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    enqueueLog: db.prepare(`
      INSERT INTO inference_log_queue (id, inference_log_id, status, attempts, payload_json, created_at)
      VALUES (?, ?, 'pending', 0, ?, ?)
    `),
    pendingLogs: db.prepare(`
      SELECT * FROM inference_log_queue
      WHERE status IN ('pending', 'retry')
      ORDER BY created_at ASC
      LIMIT ?
    `),
    markQueueProcessed: db.prepare(`
      UPDATE inference_log_queue SET status = 'processed', processed_at = ? WHERE id = ?
    `),
    markQueueFailed: db.prepare(`
      UPDATE inference_log_queue
      SET status = CASE WHEN attempts >= 2 THEN 'failed' ELSE 'retry' END,
        attempts = attempts + 1,
        error_message = ?
      WHERE id = ?
    `),
    queueDepth: db.prepare(`
      SELECT status, COUNT(*) AS count FROM inference_log_queue GROUP BY status
    `),
    recentLogs: db.prepare(`
      SELECT * FROM inference_logs ORDER BY started_at DESC LIMIT ?
    `),
    metrics: db.prepare(`
      SELECT
        COUNT(*) AS total_requests,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successes,
        SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) AS errors,
        ROUND(AVG(latency_ms), 1) AS avg_latency_ms,
        ROUND(AVG(first_token_ms), 1) AS avg_first_token_ms,
        SUM(total_tokens) AS total_tokens
      FROM inference_logs
    `),
    providerBreakdown: db.prepare(`
      SELECT provider, model, COUNT(*) AS requests, ROUND(AVG(latency_ms), 1) AS avg_latency_ms,
        SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) AS errors
      FROM inference_logs
      GROUP BY provider, model
      ORDER BY requests DESC
    `),
    throughput: db.prepare(`
      SELECT substr(started_at, 1, 16) AS minute, COUNT(*) AS requests
      FROM inference_logs
      GROUP BY substr(started_at, 1, 16)
      ORDER BY minute DESC
      LIMIT 30
    `)
  };

  return {
    createConversation({ title, provider, model }) {
      const id = randomUUID();
      const timestamp = now();
      statements.createConversation.run(id, title, provider, model, timestamp, timestamp);
      return statements.getConversation.get(id);
    },
    upsertConversation({ id, title, provider, model }) {
      const existing = id ? statements.getConversation.get(id) : null;
      if (existing) {
        statements.updateConversation.run(title || existing.title, provider || existing.provider, model || existing.model, now(), id);
        return statements.getConversation.get(id);
      }
      return this.createConversation({ title: title || "New conversation", provider, model });
    },
    setConversationStatus(id, status) {
      statements.setConversationStatus.run(status, now(), id);
      return statements.getConversation.get(id);
    },
    listConversations() {
      return statements.listConversations.all();
    },
    getConversation(id) {
      return statements.getConversation.get(id);
    },
    addMessage({ conversationId, role, content, provider = null, model = null, inferenceLogId = null }) {
      const id = randomUUID();
      const timestamp = now();
      statements.addMessage.run(id, conversationId, role, content, provider, model, inferenceLogId, timestamp);
      statements.touchConversation.run(timestamp, conversationId);
      return { id, conversation_id: conversationId, role, content, provider, model, inference_log_id: inferenceLogId, created_at: timestamp };
    },
    listMessages(conversationId) {
      return statements.listMessages.all(conversationId);
    },
    getContextMessages(conversationId, limit = 8) {
      return statements.getContextMessages.all(conversationId, limit).reverse();
    },
    insertInferenceLog(log) {
      statements.insertLog.run(
        log.id,
        log.conversationId,
        log.provider,
        log.model,
        log.status,
        log.errorMessage || null,
        log.latencyMs,
        log.firstTokenMs || null,
        log.inputTokens || null,
        log.outputTokens || null,
        log.totalTokens || null,
        log.inputPreview || "",
        log.outputPreview || "",
        log.startedAt,
        log.completedAt,
        JSON.stringify(log)
      );
      statements.insertEvent.run(randomUUID(), log.id, "inference_log.ingested", JSON.stringify(log), now());
      return statements.recentLogs.get(1);
    },
    enqueueInferenceLog(log) {
      const timestamp = now();
      const queueId = randomUUID();
      statements.insertEvent.run(randomUUID(), log.id, "inference_log.received", JSON.stringify(log), timestamp);
      statements.enqueueLog.run(queueId, log.id, JSON.stringify(log), timestamp);
      return { id: queueId, inference_log_id: log.id, status: "pending" };
    },
    processQueuedLogs(limit = 25) {
      const rows = statements.pendingLogs.all(limit);
      const processed = [];
      for (const row of rows) {
        try {
          const log = JSON.parse(row.payload_json);
          this.insertInferenceLog(log);
          statements.markQueueProcessed.run(now(), row.id);
          statements.insertEvent.run(randomUUID(), log.id, "inference_log.processed", row.payload_json, now());
          processed.push(log.id);
        } catch (error) {
          statements.markQueueFailed.run(error.message, row.id);
          statements.insertEvent.run(randomUUID(), row.inference_log_id, "inference_log.processing_failed", row.payload_json, now());
        }
      }
      return processed;
    },
    recentLogs(limit = 25) {
      return statements.recentLogs.all(limit);
    },
    metrics() {
      const summary = statements.metrics.get();
      const providerBreakdown = statements.providerBreakdown.all();
      const throughput = statements.throughput.all().reverse();
      const queueDepth = statements.queueDepth.all();
      return { summary, providerBreakdown, throughput, queueDepth };
    }
  };
}
