// Lets a signed-in client set or clear their `currentProviderId`. Validates
// that the target provider exists and is active so we don't surface a chip
// pointing at a suspended account. Pass `{ providerId: null }` to clear.

import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth-api";
import { getProvider } from "@/lib/providers-store";
import { setClientCurrentProvider } from "@/lib/users-store";
import { recordAudit } from "@/lib/audit-log";

type Body = { providerId: string | null };

export async function POST(request: Request) {
  const auth = await requireAuthApi("client");
  if ("error" in auth) return auth.error;
  if (!auth.user.clientId) {
    return NextResponse.json(
      { error: "Missing client identity." },
      { status: 400 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const providerId = body.providerId === null ? null : String(body.providerId);
  if (providerId !== null) {
    const therapist = await getProvider(providerId);
    if (!therapist || therapist.status !== "active") {
      return NextResponse.json(
        { error: "That therapist isn't available." },
        { status: 404 },
      );
    }
  }

  await setClientCurrentProvider(auth.user.clientId, providerId);
  recordAudit({
    tenantId: auth.user.tenantId ?? null,
    actorId: auth.user.clientId,
    actorRole: "client",
    action: "client.current-provider-changed",
    resource: "client",
    resourceId: auth.user.clientId,
    metadata: { providerId },
  });
  return NextResponse.json({ ok: true, currentProviderId: providerId });
}
