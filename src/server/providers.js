import { setTimeout as delay } from "node:timers/promises";

function toOpenAiMessages(messages) {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}

async function* streamOpenAi({ apiKey, model, messages, signal }) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: toOpenAiMessages(messages),
      stream: true,
      temperature: 0.7
    }),
    signal
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      const json = JSON.parse(data);
      const token = json.choices?.[0]?.delta?.content;
      if (token) yield token;
    }
  }
}

async function* streamAnthropic({ apiKey, model, messages, signal }) {
  const system = messages.find((message) => message.role === "system")?.content || "";
  const conversation = messages.filter((message) => message.role !== "system");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: 800,
      system,
      messages: conversation.map((message) => ({ role: message.role, content: message.content })),
      stream: true
    }),
    signal
  });

  if (!response.ok) {
    throw new Error(`Anthropic request failed: ${response.status} ${await response.text()}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      const json = JSON.parse(data);
      if (json.type === "content_block_delta" && json.delta?.text) yield json.delta.text;
    }
  }
}

function toGeminiContents(messages) {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }]
    }));
}

async function* streamGemini({ apiKey, model, messages, signal }) {
  const system = messages.find((message) => message.role === "system")?.content;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: toGeminiContents(messages),
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 800
        }
      }),
      signal
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini request failed: ${response.status} ${await response.text()}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const json = JSON.parse(trimmed.slice(5).trim());
      const token = json.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
      if (token) yield token;
    }
  }
}

async function* streamMock({ messages, signal }) {
  const lastUser = [...messages].reverse().find((message) => message.role === "user")?.content || "there";
  const text = `I am running in mock-provider mode, so this is a deterministic streamed answer. You said: "${lastUser}". The logging wrapper still captures provider, model, timing, token estimates, previews, and status exactly like it would for a real model call.`;
  for (const token of text.split(/(\s+)/)) {
    if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
    await delay(25);
    yield token;
  }
}

export function resolveProvider({ provider, model }) {
  const selectedProvider = provider || process.env.DEFAULT_PROVIDER || "mock";
  const selectedModel =
    model ||
    (selectedProvider === "openai"
      ? process.env.OPENAI_MODEL
      : selectedProvider === "anthropic"
        ? process.env.ANTHROPIC_MODEL
        : selectedProvider === "gemini"
          ? process.env.GEMINI_MODEL
          : process.env.DEFAULT_MODEL) ||
    "mock-fast";

  if (selectedProvider === "openai" && process.env.OPENAI_API_KEY) {
    return {
      provider: "openai",
      model: selectedModel || "gpt-4o-mini",
      stream: (args) => streamOpenAi({ ...args, apiKey: process.env.OPENAI_API_KEY, model: selectedModel || "gpt-4o-mini" })
    };
  }

  if (selectedProvider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      model: selectedModel || "claude-3-5-haiku-latest",
      stream: (args) => streamAnthropic({ ...args, apiKey: process.env.ANTHROPIC_API_KEY, model: selectedModel || "claude-3-5-haiku-latest" })
    };
  }

  if (selectedProvider === "gemini" && process.env.GEMINI_API_KEY) {
    return {
      provider: "gemini",
      model: selectedModel || "gemini-2.5-flash",
      stream: (args) => streamGemini({ ...args, apiKey: process.env.GEMINI_API_KEY, model: selectedModel || "gemini-2.5-flash" })
    };
  }

  return {
    provider: "mock",
    model: selectedModel || "mock-fast",
    stream: (args) => streamMock(args)
  };
}
