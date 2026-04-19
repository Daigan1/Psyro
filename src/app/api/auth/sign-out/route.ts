import { NextResponse } from "next/server";
import { clearSession, getCurrentUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit-log";

export async function POST() {
  const user = await getCurrentUser();
  if (user) {
    recordAudit({
      actorId: user.sub,
      actorRole: user.role,
      action: "auth.sign-out",
      resource: "session",
      resourceId: null,
      metadata: {},
    });
  }
  await clearSession();
  return NextResponse.json({ ok: true });
}
