import Fastify, { FastifyInstance } from "fastify";
import sensible from "@fastify/sensible";
import { TenantStore } from "./tenantStore";
import { settlementRoutes } from "./routes/settlements";

interface ServerOptions {
  logger?: boolean;
}

export function buildServer(opts: ServerOptions = {}): FastifyInstance {
  const isProd = process.env.NODE_ENV === "production";
  const logger = opts.logger ?? isProd;

  const app   = Fastify({ logger });
  const store = new TenantStore();

  app.register(sensible);

  app.register(async (instance) => {
    await settlementRoutes(instance, store);
  });

  return app;
}