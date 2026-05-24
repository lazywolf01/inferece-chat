# LLM Inference Logger

A lightweight full-stack chatbot with near-real-time inference logging, ingestion validation, SQLite storage, and basic observability dashboards.

## Features

- Multi-turn chatbot UI with short context windows.
- Streaming responses with cancel support.
- Multi-provider wrapper: `mock`, `openai`, `anthropic`, and `gemini`.
- SDK-style inference logging around every LLM call.
- Ingestion API with payload validation, metadata extraction, and PII redaction for previews.
- SQLite tables for conversations, chat messages, inference logs, ingestion events, and a durable ingestion queue.
- Latency, throughput, error, and provider breakdown dashboard.
- Docker Compose one-command setup.
- SQLite-backed event queue and background ingestion worker.
- Kubernetes manifests for self-hosted deployment.
- ChatGPT-style frontend with conversation list, resume, and cancel.

## Bonus Coverage

- Multi-provider support: mock, OpenAI, Anthropic, Gemini.
- Streaming responses: Server-Sent Events from provider wrapper to browser.
- Latency, throughput, and errors dashboard: built into the right telemetry panel.
- Docker Compose one-command setup: `docker compose up --build`.
- Event based architecture: ingestion API writes to `inference_log_queue`; worker processes events asynchronously.
- PII redaction: email, phone, and card-like values are redacted from telemetry previews.
- Self-hosted Kubernetes deployment: manifests in `k8s/deployment.yaml`.
- Frontend: modern chat UI with cancel, list conversations, and resume conversation.

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`.

The app works immediately with `DEFAULT_PROVIDER=mock`. To use a real provider, add `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY` in `.env` and select that provider in the UI.

## Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

Open `http://localhost:8080`.

## Scripts

- `npm run dev` starts the Express API and Vite UI.
- `npm run build` builds the frontend into `dist`.
- `npm start` serves the API and production frontend.
- `npm run smoke` sends a mock chat and verifies ingestion metrics.

## Architecture Overview

The Express app exposes both product APIs and ingestion APIs:

- `POST /api/chat` receives chat messages and streams SSE tokens back to the browser.
- `streamWithInferenceLogging` wraps provider calls and captures model, provider, latency, first-token latency, estimated token usage, status, errors, timestamps, conversation ID, and redacted input/output previews.
- The wrapper posts a log payload to `POST /api/ingest/logs`.
- The ingestion endpoint validates the payload with Zod, redacts previews again, and enqueues a durable event.
- A background ingestion worker drains the queue into structured SQLite rows and appends processing events.
- `GET /api/metrics` aggregates latency, throughput, errors, token counts, and provider usage for the dashboard.

## Schema Design

`conversations`

- One row per chat session.
- Stores title, status, provider/model defaults, and timestamps.

`chat_messages`

- One row per user or assistant message.
- Assistant messages can reference the inference log that produced them.
- Messages are kept separate from logs because product chat history and observability data have different retention and query patterns.

`inference_logs`

- One row per model call.
- Stores query-friendly metadata columns plus `raw_json` for the original normalized payload.
- Preview fields are redacted and truncated so dashboards are useful without storing full sensitive prompts in observability views.

`ingestion_events`

- Append-only event record for ingestion activity.
- Tracks received, processed, and processing-failed inference log events.

`inference_log_queue`

- Durable local queue for event-based ingestion.
- Stores pending, retry, processed, and failed states with attempt counts and error messages.

## Tradeoffs

- SQLite keeps the demo easy to run and review. For higher write volume, move logs to Postgres, ClickHouse, or a warehouse-backed event stream.
- Token usage is estimated for streamed responses unless a provider returns final usage metadata. This keeps the wrapper provider-neutral.
- The ingestion client posts over HTTP even though it is in the same service, because it mirrors a real SDK-to-ingestion boundary.
- The event bus is implemented as a SQLite-backed durable queue for a lightweight assignment build. The interface is intentionally close to what a Kafka/SQS/NATS worker would consume.
- The mock provider makes the demo deterministic and removes API key friction.
- PII redaction is regex-based. It catches common emails, phone numbers, and card-like values, but production redaction should use layered detection and policy controls.

## What I Would Improve

- Split chat API, ingestion workers, and analytics into separate deployable services.
- Replace the SQLite-backed queue with Kafka, Redpanda, SQS, or NATS JetStream when write volume grows.
- Add provider-specific token accounting from final stream events.
- Add auth, tenant IDs, retention policies, and encryption-at-rest controls.
- Add OpenTelemetry traces and export metrics to Prometheus/Grafana.
- Add pagination and full-text search for conversation history and logs.

## Deployment Notes

Kubernetes manifests are included under `k8s/` as a self-hosted starting point. They include namespace, app config, secret placeholders, persistent storage, deployment, and service. For real production, use Postgres or a managed database instead of local SQLite.

Apply to a self-hosted cluster after building and publishing the image:

```bash
kubectl apply -f k8s/deployment.yaml
```

Create real provider secrets without committing keys:

```bash
kubectl -n inference-logger create secret generic inference-logger-secrets \
  --from-literal=OPENAI_API_KEY=... \
  --from-literal=ANTHROPIC_API_KEY=... \
  --from-literal=GEMINI_API_KEY=...
```

## Demo

Run the project locally with either quick start path above. The UI itself demonstrates the full flow: send a chat, watch the streamed answer, then see the request appear in the telemetry panel.
