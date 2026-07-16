import { Router } from "express";
import { Ollama } from "ollama";

import { getOllamaHealthTimeout } from "../config.js";

const router = Router();

router.get("/health", async (req, res) => {
  try {
    const timeoutMs = getOllamaHealthTimeout() * 1000;
    const client = new Ollama({
      // ollama's Client has no built-in timeout option (unlike the Python
      // client) — wrap fetch with AbortSignal.timeout instead.
      fetch: (url, options) =>
        fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) }),
    });
    const { models } = await client.list();
    res.json({ connected: true, models: models.map((model) => model.model) });
  } catch {
    res.json({ connected: false, models: [] });
  }
});

export default router;
