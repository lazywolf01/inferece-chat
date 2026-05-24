# Architecture Notes

## Ingestion Flow

1. Browser sends a user message to `POST /api/chat`.
2. The chat route stores the user message and loads the last eight conversation messages as short context.
3. The LLM wrapper streams from the selected provider and forwards tokens to the browser over Server-Sent Events.
4. The wrapper records timing, status, token estimates, previews, and provider metadata.
5. The wrapper posts the normalized payload to `POST /api/ingest/logs`.
6. The ingestion endpoint validates the payload, redacts previews, appends `inference_log.received`, and writes a pending row to `inference_log_queue`.
7. The background worker drains pending queue rows, writes `inference_logs`, and appends `inference_log.processed` or `inference_log.processing_failed`.
8. Dashboard APIs read aggregate metrics and queue depth from SQLite.

## Logging Strategy

The wrapper treats observability as part of the model-call boundary. It logs both successes and failures, including cancelled streams. Logging is best-effort from the chat path: once the ingestion API accepts the event, the worker owns durable processing and retry state.

Previews are deliberately short and redacted. Full chat messages are stored for the application experience, while telemetry rows store only enough prompt/response content for debugging and dashboard inspection.

## Scaling Considerations

- Replace the SQLite-backed event queue with Kafka, Redpanda, SQS, or NATS JetStream.
- Store operational chat data in Postgres and high-cardinality inference events in ClickHouse or a columnar warehouse.
- Add tenant IDs and partitioning keys to all event rows.
- Batch ingestion writes in workers while keeping the SDK API asynchronous and retryable.
- Export metrics to Prometheus and traces to OpenTelemetry for cross-service latency analysis.
- Horizontally scale stateless API pods; avoid local SQLite for multi-replica production.

## Failure Handling Assumptions

- Provider errors are returned to the client and logged with status `error`.
- Client aborts are treated as status `cancelled`.
- Ingestion validation failures return HTTP 400 and do not write rows.
- Ingestion processing failures move queue rows to `retry`, then `failed` after repeated attempts.
- A production SDK should also buffer locally and retry with backoff if the ingestion API is unreachable.
- If no real provider key is present, provider selection falls back to `mock` so chat and logging still work.
