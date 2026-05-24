import { randomUUID } from "node:crypto";
import { estimateTokens, preview } from "./pii.js";

function serializeInput(messages) {
  return messages.map((message) => `${message.role}: ${message.content}`).join("\n");
}

async function postLog(log) {
  const url = process.env.INGESTION_URL || `http://localhost:${process.env.PORT || 8080}/api/ingest/logs`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(log)
  });
  if (!response.ok) {
    throw new Error(`Ingestion failed: ${response.status}`);
  }
}

export async function streamWithInferenceLogging({ providerClient, conversationId, messages, signal, onToken }) {
  const id = randomUUID();
  const startedAt = new Date();
  const inputText = serializeInput(messages);
  let outputText = "";
  let firstTokenMs = null;
  let status = "success";
  let errorMessage = null;

  try {
    for await (const token of providerClient.stream({ messages, signal })) {
      if (firstTokenMs === null) firstTokenMs = Date.now() - startedAt.getTime();
      outputText += token;
      onToken(token);
    }
  } catch (error) {
    status = error.name === "AbortError" || signal?.aborted ? "cancelled" : "error";
    errorMessage = error.message;
    throw error;
  } finally {
    const completedAt = new Date();
    const inputTokens = estimateTokens(inputText);
    const outputTokens = estimateTokens(outputText);
    const log = {
      id,
      conversationId,
      provider: providerClient.provider,
      model: providerClient.model,
      status,
      errorMessage,
      latencyMs: completedAt.getTime() - startedAt.getTime(),
      firstTokenMs,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      inputPreview: preview(inputText),
      outputPreview: preview(outputText),
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString()
    };

    try {
      await postLog(log);
    } catch (ingestionError) {
      console.error("Failed to ingest inference log", ingestionError);
    }
  }

  return {
    id,
    content: outputText,
    provider: providerClient.provider,
    model: providerClient.model
  };
}
