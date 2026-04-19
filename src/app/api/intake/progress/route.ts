import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth-api";
import { saveIntakeProgress } from "@/lib/intake-store";
import type { IntakeInput } from "@/lib/types";

type Body = { data: IntakeInput; step: number };

export async function PUT(request: Request) {
  const authResult = await requireAuthApi("client");
  if ("error" in authResult) return authResult.error;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.data || typeof body.step !== "number") {
    return NextResponse.json({ error: "Missing data or step" }, { status: 400 });
  }
  const step = Math.max(0, Math.min(3, Math.floor(body.step)));
  const progress = await saveIntakeProgress(
    authResult.user.clientId!,
    body.data,
    step,
  );
  return NextResponse.json({ ok: true, step: progress.step });
}
