import Fastify, { FastifyInstance } from "fastify";
import sensible from "@fastify/sensible";
import { TenantStore } from "./tenantStore";
import { settlementRoutes } from "./routes/settlements";

export function buildServer(): FastifyInstance {
  const app   = Fastify({ logger: false });
  const store = new TenantStore();

  app.register(sensible);

  app.register(async (instance) => {
    await settlementRoutes(instance, store);
  });

  return app;
}