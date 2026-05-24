import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  BarChart3,
  Bot,
  CircleStop,
  Clock3,
  MessageSquarePlus,
  RefreshCw,
  Send,
  Sparkles,
  XCircle
} from "lucide-react";
import "./styles.css";

const providers = [
  { value: "mock", label: "Mock" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Gemini" }
];

async function api(path, options) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    ...options
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function useAppData() {
  const [conversations, setConversations] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [logs, setLogs] = useState([]);

  const refresh = async () => {
    const [conversationData, metricsData, logData] = await Promise.all([
      api("/api/conversations"),
      api("/api/metrics"),
      api("/api/logs?limit=12")
    ]);
    setConversations(conversationData);
    setMetrics(metricsData);
    setLogs(logData);
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3500);
    return () => clearInterval(interval);
  }, []);

  return { conversations, metrics, logs, refresh };
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="metric">
      <Icon size={17} />
      <span>{label}</span>
      <strong>{value ?? 0}</strong>
    </div>
  );
}

function Dashboard({ metrics, logs }) {
  const summary = metrics?.summary || {};
  const maxThroughput = Math.max(1, ...(metrics?.throughput || []).map((point) => point.requests));
  const queueDepth = metrics?.queueDepth || [];

  return (
    <aside className="dashboard">
      <div className="panelTitle">
        <BarChart3 size={18} />
        <h2>Telemetry</h2>
      </div>
      <div className="metrics">
        <Metric icon={Activity} label="Requests" value={summary.total_requests} />
        <Metric icon={Clock3} label="Latency" value={`${summary.avg_latency_ms || 0} ms`} />
        <Metric icon={XCircle} label="Errors" value={summary.errors} />
        <Metric icon={RefreshCw} label="Tokens" value={summary.total_tokens || 0} />
      </div>
      <section className="chart">
        <h3>Throughput</h3>
        <div className="bars">
          {(metrics?.throughput || []).slice(-18).map((point) => (
            <div
              className="bar"
              key={point.minute}
              title={`${point.minute}: ${point.requests}`}
              style={{ height: `${Math.max(8, (point.requests / maxThroughput) * 100)}%` }}
            />
          ))}
        </div>
      </section>
      <section className="tablePanel">
        <h3>Providers</h3>
        {(metrics?.providerBreakdown || []).map((row) => (
          <div className="providerRow" key={`${row.provider}-${row.model}`}>
            <span>{row.provider}</span>
            <small>{row.model}</small>
            <strong>{row.requests}</strong>
          </div>
        ))}
      </section>
      <section className="tablePanel">
        <h3>Event Queue</h3>
        {queueDepth.length === 0 && <p className="mutedLine">No queued events</p>}
        {queueDepth.map((row) => (
          <div className="queueRow" key={row.status}>
            <span>{row.status}</span>
            <strong>{row.count}</strong>
          </div>
        ))}
      </section>
      <section className="tablePanel logs">
        <h3>Recent Logs</h3>
        {logs.map((log) => (
          <div className="logRow" key={log.id}>
            <span className={log.status}>{log.status}</span>
            <p>{log.output_preview || log.input_preview}</p>
            <small>{log.latency_ms} ms</small>
          </div>
        ))}
      </section>
    </aside>
  );
}

function ConversationList({ conversations, activeId, onSelect, onNew }) {
  return (
    <aside className="sidebar">
      <div className="railBrand">
        <div className="brandMark"><Sparkles size={18} /></div>
        <span>Inference Chat</span>
      </div>
      <button className="newButton" onClick={onNew}>
        <MessageSquarePlus size={18} />
        <span>New chat</span>
      </button>
      <div className="conversationList">
        {conversations.map((conversation) => (
          <button
            className={`conversationItem ${conversation.id === activeId ? "selected" : ""}`}
            key={conversation.id}
            onClick={() => onSelect(conversation.id)}
          >
            <span>{conversation.title}</span>
            <small>{conversation.status} / {conversation.provider}</small>
          </button>
        ))}
      </div>
    </aside>
  );
}

function Message({ message }) {
  const isUser = message.role === "user";
  return (
    <article className={`messageRow ${isUser ? "fromUser" : "fromAssistant"}`}>
      <div className="avatar">{isUser ? "U" : <Bot size={18} />}</div>
      <div className="messageBubble">
        <p>{message.content}</p>
      </div>
    </article>
  );
}

function App() {
  const { conversations, metrics, logs, refresh } = useAppData();
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState("mock");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef(null);
  const messagesRef = useRef(null);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId),
    [conversations, activeId]
  );

  useEffect(() => {
    if (!activeId) return;
    api(`/api/conversations/${activeId}/messages`).then(setMessages).catch(console.error);
  }, [activeId]);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const startNew = () => {
    setActiveId(null);
    setMessages([]);
    setInput("");
  };

  const cancelConversation = async () => {
    abortRef.current?.abort();
    if (activeId) {
      await api(`/api/conversations/${activeId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "cancelled" })
      });
    }
    setStreaming(false);
    refresh();
  };

  const sendMessage = async (event) => {
    event.preventDefault();
    const content = input.trim();
    if (!content || streaming) return;

    const abortController = new AbortController();
    abortRef.current = abortController;
    setInput("");
    setStreaming(true);
    setMessages((current) => [...current, { role: "user", content }, { role: "assistant", content: "" }]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeId, message: content, provider }),
        signal: abortController.signal
      });

      if (!response.ok) throw new Error(await response.text());

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";
        for (const chunk of chunks) {
          const eventName = chunk.match(/^event: (.+)$/m)?.[1];
          const data = JSON.parse(chunk.match(/^data: (.+)$/m)?.[1] || "{}");
          if (eventName === "conversation") setActiveId(data.id);
          if (eventName === "token") {
            setMessages((current) => {
              const next = [...current];
              next[next.length - 1] = { ...next[next.length - 1], content: next[next.length - 1].content + data.token };
              return next;
            });
          }
          if (eventName === "done") {
            setMessages((current) => current.map((message, index) => index === current.length - 1 ? data.message : message));
          }
          if (eventName === "error") {
            throw new Error(data.message);
          }
        }
      }
      await refresh();
    } catch (error) {
      if (error.name !== "AbortError") {
        setMessages((current) => [...current, { role: "assistant", content: `Request failed: ${error.message}` }]);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  return (
    <main className="appShell">
      <ConversationList conversations={conversations} activeId={activeId} onSelect={setActiveId} onNew={startNew} />
      <section className="chatPane">
        <header className="topbar">
          <div>
            <strong>{activeConversation?.title || "New conversation"}</strong>
            <span>{streaming ? "Generating" : "Ready"} / {provider}</span>
          </div>
          <div className="controls">
            <select value={provider} onChange={(event) => setProvider(event.target.value)}>
              {providers.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
            </select>
            <button className="stopButton" onClick={cancelConversation} disabled={!streaming && !activeId} title="Cancel conversation">
              <CircleStop size={18} />
            </button>
          </div>
        </header>
        <div className="messages" ref={messagesRef}>
          {messages.length === 0 && (
            <div className="emptyState">
              <div className="emptyIcon"><Bot size={32} /></div>
              <h1>How can I help?</h1>
            </div>
          )}
          {messages.map((message, index) => <Message message={message} key={message.id || index} />)}
        </div>
        <form className="composer" onSubmit={sendMessage}>
          <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Message Inference Chat" />
          <button className="sendButton" disabled={!input.trim() || streaming} title="Send message">
            <Send size={18} />
          </button>
        </form>
      </section>
      <Dashboard metrics={metrics} logs={logs} />
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
