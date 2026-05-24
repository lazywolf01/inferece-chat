PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  provider TEXT NOT NULL DEFAULT 'mock',
  model TEXT NOT NULL DEFAULT 'mock-fast',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  inference_log_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE TABLE IF NOT EXISTS inference_logs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  latency_ms INTEGER NOT NULL,
  first_token_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  input_preview TEXT,
  output_preview TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE TABLE IF NOT EXISTS ingestion_events (
  id TEXT PRIMARY KEY,
  inference_log_id TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inference_log_queue (
  id TEXT PRIMARY KEY,
  inference_log_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON chat_messages(conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_logs_conversation_started
  ON inference_logs(conversation_id, started_at);

CREATE INDEX IF NOT EXISTS idx_logs_provider_model
  ON inference_logs(provider, model);

CREATE INDEX IF NOT EXISTS idx_queue_status_created
  ON inference_log_queue(status, created_at);
