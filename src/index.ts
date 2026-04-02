import { buildServer } from "./server/server";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

async function start(): Promise<void> {
  const app = buildServer();

  // ── Health check — unauthenticated, for uptime monitors ──────────────────
  app.get("/health", async () => ({
    status:    "ok",
    service:   "SettlrOS",
    version:   "0.1.0",
    timestamp: new Date().toISOString(),
  }));

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[SHUTDOWN] ${signal} received — closing server...`);
    await app.close();
    console.log("[SHUTDOWN] Server closed cleanly.");
    process.exit(0);
  };

  process.on("SIGINT",  () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // ── Start ─────────────────────────────────────────────────────────────────
  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`
╔══════════════════════════════════════════╗
║           SettlrOS is running            ║
╠══════════════════════════════════════════╣
║  http://localhost:${PORT}                    ║
║                                          ║
║  POST   /settlements                     ║
║  GET    /settlements                     ║
║  GET    /settlements?state=PENDING       ║
║  GET    /settlements/:ref                ║
║  POST   /settlements/:ref/transition     ║
║  GET    /settlements/:ref/replay         ║
║  GET    /health                          ║
╚══════════════════════════════════════════╝
    `);
  } catch (err) {
    console.error("[FATAL] Server failed to start:", err);
    process.exit(1);
  }
}

start();