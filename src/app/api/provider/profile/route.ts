import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth-api";
import {
  getProvider,
  updateProviderProfile,
  type ProviderProfilePatch,
} from "@/lib/providers-store";
import { recordAudit } from "@/lib/audit-log";

export async function GET() {
  const auth = await requireAuthApi("provider");
  if ("error" in auth) return auth.error;
  const provider = await getProvider(auth.user.providerId!);
  if (!provider) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ provider });
}

export async function PATCH(request: Request) {
  const auth = await requireAuthApi("provider");
  if ("error" in auth) return auth.error;

  let body: ProviderProfilePatch;
  try {
    body = (await request.json()) as ProviderProfilePatch;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const err = validate(body);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  try {
    const provider = await updateProviderProfile(auth.user.providerId!, body);
    recordAudit({
      actorId: auth.user.providerId ?? null,
      actorRole: "provider",
      action: "provider.profile-updated",
      resource: "provider",
      resourceId: auth.user.providerId!,
      metadata: { fields: Object.keys(body) },
    });
    return NextResponse.json({ provider });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 409 },
    );
  }
}

function validate(p: ProviderProfilePatch): string | null {
  if (p.name !== undefined && p.name.trim().length < 2) {
    return "Name is too short.";
  }
  if (p.bio !== undefined && p.bio.length > 2000) {
    return "Bio is too long (max 2000 chars).";
  }
  for (const field of ["specialties", "modalities"] as const) {
    const v = p[field];
    if (v !== undefined) {
      if (!Array.isArray(v)) return `${field} must be an array`;
      if (v.some((x) => typeof x !== "string")) {
        return `${field} items must be strings`;
      }
    }
  }
  if (p.sessionFormats !== undefined) {
    if (!Array.isArray(p.sessionFormats) || p.sessionFormats.length === 0) {
      return "Pick at least one session format.";
    }
  }
  if (p.ratePerSessionCents !== undefined) {
    if (
      !Number.isInteger(p.ratePerSessionCents) ||
      p.ratePerSessionCents < 100 ||
      p.ratePerSessionCents > 100_000
    ) {
      return "Session rate must be between $1 and $1,000.";
    }
  }
  return null;
}
