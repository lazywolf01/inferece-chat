const base = process.env.SMOKE_BASE_URL || "http://localhost:8080";

async function main() {
  const health = await fetch(`${base}/api/health`).then((response) => response.json());
  if (!health.ok) throw new Error("Health check failed");

  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Hello, verify logging works.", provider: "mock" })
  });

  if (!response.ok) throw new Error(`Chat failed: ${response.status}`);
  await response.text();

  let metrics;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    metrics = await fetch(`${base}/api/metrics`).then((res) => res.json());
    if (metrics.summary.total_requests) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!metrics.summary.total_requests) throw new Error("No inference logs were ingested");
  console.log(`Smoke test passed with ${metrics.summary.total_requests} logged request(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
