// Server-only: never import from a "use client" module.
// Provider profile store. Thin async wrapper around DynamoDB records in
// tinyfish_users (role='provider'). No in-memory cache — provider profiles
// are durable business data and live exclusively in DDB.

import { createHmac } from "node:crypto";
import {
  ddbGetUser,
  ddbGetUserByEmail,
  ddbListAllProviders,
  ddbListProvidersForTenant,
  ddbPutUser,
  ddbUpdateProviderProfile,
} from "./aws/dynamodb";
import { DEMO_TENANT_ID } from "./tenant-store";
import type {
  ProviderUserRecord,
  Therapist,
  WeeklyAvailability,
} from "./types";

function toUserRecord(t: Therapist): ProviderUserRecord {
  const now = new Date().toISOString();
  return {
    ...t,
    role: "provider",
    createdAt: now,
    lastSignInAt: now,
  };
}

function toTherapist(rec: ProviderUserRecord): Therapist {
  // Strip persistence-only fields so callers see a pure Therapist.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { role, createdAt, lastSignInAt, ...rest } = rec;
  return rest;
}

export async function listProviders(): Promise<Therapist[]> {
  const recs = await ddbListAllProviders();
  return recs.map(toTherapist);
}

export async function listProvidersForTenant(
  tenantId: string,
): Promise<Therapist[]> {
  const recs = await ddbListProvidersForTenant(tenantId);
  return recs.map(toTherapist);
}

export async function getProvider(id: string): Promise<Therapist | null> {
  const rec = await ddbGetUser(id);
  if (!rec || rec.role !== "provider") return null;
  return toTherapist(rec);
}

export async function getProviderByEmail(
  email: string,
): Promise<Therapist | null> {
  const rec = await ddbGetUserByEmail(email);
  if (!rec || rec.role !== "provider") return null;
  return toTherapist(rec);
}

export type ProviderProfilePatch = Partial<
  Pick<
    Therapist,
    | "name"
    | "pronouns"
    | "gender"
    | "specialties"
    | "modalities"
    | "bio"
    | "sessionFormats"
    | "ratePerSessionCents"
  >
>;

export async function updateProviderProfile(
  id: string,
  patch: ProviderProfilePatch,
): Promise<Therapist> {
  const rec = await ddbUpdateProviderProfile(id, patch);
  return toTherapist(rec);
}

export async function updateProviderAvailability(
  id: string,
  weeklyAvailability: WeeklyAvailability,
): Promise<Therapist> {
  const rec = await ddbUpdateProviderProfile(id, { weeklyAvailability });
  return toTherapist(rec);
}

// Called on first sign-in for an email that isn't yet a provider. Creates
// a stub profile the provider completes via /provider/onboarding.
export async function createSelfSignupProvider(
  email: string,
): Promise<Therapist> {
  const normalized = email.trim().toLowerCase();
  const existing = await getProviderByEmail(normalized);
  if (existing) return existing;
  const short = createHmac("sha256", "provider-id")
    .update(normalized)
    .digest("hex")
    .slice(0, 8);
  const id = `t_${short}`;
  const provider: Therapist = {
    id,
    tenantId: DEMO_TENANT_ID,
    email: normalized,
    status: "active",
    name: normalized.split("@")[0],
    pronouns: "",
    gender: "female",
    specialties: [],
    modalities: [],
    bio: "",
    nextAvailable: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    sessionFormats: ["video"],
    ratePerSessionCents: 15000,
  };
  await ddbPutUser(toUserRecord(provider));
  return provider;
}
