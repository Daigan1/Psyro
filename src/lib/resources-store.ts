// Server-only: never import from a "use client" module.
// Therapist resource store. DDB-only — no cache.

import {
  ddbDeleteResource,
  ddbGetResource,
  ddbListResourcesForProvider,
  ddbListResourcesForTenant,
  ddbPutResource,
} from "./aws/dynamodb";
import type { TherapistResource } from "./types";

export async function getResource(
  id: string,
): Promise<TherapistResource | null> {
  return ddbGetResource(id);
}

export async function putResource(
  resource: TherapistResource,
): Promise<void> {
  await ddbPutResource(resource);
}

export async function removeResource(id: string): Promise<boolean> {
  const existing = await ddbGetResource(id);
  if (!existing) return false;
  await ddbDeleteResource(id);
  return true;
}

export async function listResourcesForProvider(
  providerId: string,
): Promise<TherapistResource[]> {
  return ddbListResourcesForProvider(providerId);
}

export async function listResourcesForTenant(
  tenantId: string,
): Promise<TherapistResource[]> {
  return ddbListResourcesForTenant(tenantId);
}
