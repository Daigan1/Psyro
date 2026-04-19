// Server-only: never import from a "use client" module.
// Role identity helpers — all read from the signed tf_session cookie via
// getCurrentUser() so every role check goes through one verification path.
// When Cognito is wired, getCurrentUser() switches to JWT verification and
// these helpers need no changes.

import { getCurrentUser } from "./auth";

export async function getClientId(): Promise<string | null> {
  const user = await getCurrentUser();
  if (user?.role !== "client") return null;
  return user.clientId ?? null;
}

export async function getProviderId(): Promise<string | null> {
  const user = await getCurrentUser();
  if (user?.role !== "provider") return null;
  return user.providerId ?? null;
}
