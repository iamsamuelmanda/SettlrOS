// ── Tenant registry ───────────────────────────────────────────────────────────
// In production this would be a database lookup.
// For now: a static map of API keys → tenant IDs.

const API_KEYS: Record<string, string> = {
    api_key_tenant1: "tenant1",
    api_key_tenant2: "tenant2",
  };
  
  export function resolveTenant(apiKey: string): string | null {
    return API_KEYS[apiKey] ?? null;
  }
  
  export function extractApiKey(authHeader: string | undefined): string | null {
    if (!authHeader?.startsWith("Bearer ")) return null;
    return authHeader.slice(7).trim();
  }