// Server-only: never import from a "use client" module.
// User record store (tinyfish_users). DDB-only — no in-memory cache.
// Holds both client and provider records, discriminated by `role`.
// Provider profile CRUD lives in providers-store.ts (writes to this same
// table); this module owns the sign-in upsert path and generic reads.

import {
  ddbGetUser,
  ddbGetUserByEmail,
  ddbSetClientCurrentProvider,
  ddbTouchSignIn,
} from "./aws/dynamodb";
import type { UserRecord } from "./types";

// Called on every successful sign-in. Creates the row if missing using
// `defaults`; otherwise only refreshes lastSignInAt — never overwrites an
// existing provider profile.
export async function touchSignIn(defaults: UserRecord): Promise<void> {
  await ddbTouchSignIn(defaults.id, defaults);
}

export async function getUser(id: string): Promise<UserRecord | null> {
  return ddbGetUser(id);
}

export async function getUserByEmail(
  email: string,
): Promise<UserRecord | null> {
  return ddbGetUserByEmail(email);
}

export async function setClientCurrentProvider(
  clientId: string,
  providerId: string | null,
): Promise<void> {
  await ddbSetClientCurrentProvider(clientId, providerId);
}
