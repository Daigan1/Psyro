// Server-only: never import from a "use client" module.
// In-memory tenant store. Swap for DynamoDB when USE_AWS=true.

import type { Tenant } from "./types";

export const DEMO_TENANT_ID = "tenant_demo";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
if (!g.__tinyfishTenants) {
  const seed: Tenant = {
    id: DEMO_TENANT_ID,
    name: "Demo Clinic",
    createdAt: new Date().toISOString(),
  };
  g.__tinyfishTenants = new Map<string, Tenant>([[seed.id, seed]]);
}
const store: Map<string, Tenant> = g.__tinyfishTenants;

export function getTenant(id: string): Tenant | null {
  return store.get(id) ?? null;
}
