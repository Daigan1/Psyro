import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth-api";
import {
  getProvider,
  updateProviderAvailability,
} from "@/lib/providers-store";
import { recordAudit } from "@/lib/audit-log";
import type { WeeklyAvailability } from "@/lib/types";

export async function GET() {
  const auth = await requireAuthApi("provider");
  if ("error" in auth) return auth.error;
  const provider = await getProvider(auth.user.providerId!);
  if (!provider) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    weeklyAvailability: provider.weeklyAvailability ?? {},
  });
}

export async function PATCH(request: Request) {
  const auth = await requireAuthApi("provider");
  if ("error" in auth) return auth.error;

  let body: { weeklyAvailability?: unknown };
  try {
    body = (await request.json()) as { weeklyAvailability?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseSchedule(body.weeklyAvailability);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const provider = await updateProviderAvailability(
      auth.user.providerId!,
      parsed.value,
    );
    recordAudit({
      tenantId: auth.user.tenantId ?? null,
      actorId: auth.user.providerId ?? null,
      actorRole: "provider",
      action: "provider.availability-updated",
      resource: "provider",
      resourceId: auth.user.providerId!,
      metadata: { days: Object.keys(parsed.value).length },
    });
    return NextResponse.json({
      weeklyAvailability: provider.weeklyAvailability ?? {},
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 409 },
    );
  }
}

type ParseResult =
  | { ok: true; value: WeeklyAvailability }
  | { ok: false; error: string };

function parseSchedule(input: unknown): ParseResult {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "weeklyAvailability must be an object." };
  }
  const out: WeeklyAvailability = {};
  for (const [rawDay, rawHours] of Object.entries(input)) {
    const day = Number(rawDay);
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      return { ok: false, error: `Invalid day-of-week: ${rawDay}` };
    }
    if (!Array.isArray(rawHours)) {
      return { ok: false, error: `Day ${day} must map to an array of hours.` };
    }
    const hours = new Set<number>();
    for (const h of rawHours) {
      if (!Number.isInteger(h) || (h as number) < 0 || (h as number) > 23) {
        return { ok: false, error: `Invalid hour on day ${day}: ${h}` };
      }
      hours.add(h as number);
    }
    if (hours.size > 0) {
      out[day] = Array.from(hours).sort((a, b) => a - b);
    }
  }
  return { ok: true, value: out };
}
