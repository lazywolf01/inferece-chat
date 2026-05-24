export function startIngestionWorker(store, intervalMs = 1000) {
  const drain = () => {
    try {
      store.processQueuedLogs(50);
    } catch (error) {
      console.error("Ingestion worker failed", error);
    }
  };

  drain();
  const timer = setInterval(drain, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
