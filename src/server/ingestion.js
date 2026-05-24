import { z } from "zod";
import { preview } from "./pii.js";

const inferenceLogSchema = z.object({
  id: z.string().min(8),
  conversationId: z.string().min(8),
  provider: z.string().min(1),
  model: z.string().min(1),
  status: z.enum(["success", "error", "cancelled"]),
  errorMessage: z.string().nullable().optional(),
  latencyMs: z.number().int().nonnegative(),
  firstTokenMs: z.number().int().nonnegative().nullable().optional(),
  inputTokens: z.number().int().positive().optional(),
  outputTokens: z.number().int().positive().optional(),
  totalTokens: z.number().int().positive().optional(),
  inputPreview: z.string().default(""),
  outputPreview: z.string().default(""),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime()
});

export function createIngestionRouter(express, store) {
  const router = express.Router();

  router.post("/logs", (req, res) => {
    const parsed = inferenceLogSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid inference log", details: parsed.error.flatten() });
    }

    const log = {
      ...parsed.data,
      inputPreview: preview(parsed.data.inputPreview),
      outputPreview: preview(parsed.data.outputPreview)
    };
    const queued = store.enqueueInferenceLog(log);
    setImmediate(() => store.processQueuedLogs());
    res.status(202).json({ ok: true, id: log.id, queueId: queued.id, status: "queued" });
  });

  return router;
}
