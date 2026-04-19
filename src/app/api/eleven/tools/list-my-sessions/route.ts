// ElevenLabs ConvAI tool webhook: lists the authenticated client's recent
// sessions (id, date, provider, whether a summary is available). Same
// auth model as get-my-summary — Bearer token from dynamic-variable.

import { NextResponse } from "next/server";
import { listAppointmentsForClient } from "@/lib/appointments-store";
import { getArtifact } from "@/lib/session-artifacts-store";
import { recordAudit } from "@/lib/audit-log";
import { bearerFromHeader, verifyConversationToken } from "@/lib/eleven-token";

export async function POST(request: Request) {
  const token = bearerFromHeader(request.headers.get("authorization"));
  const payload = token ? verifyConversationToken(token) : null;
  if (!payload) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const appts = await listAppointmentsForClient(payload.sub);
  const sorted = [...appts].sort((a, b) =>
    b.startTime.localeCompare(a.startTime),
  );

  const sessions = await Promise.all(
    sorted.slice(0, 20).map(async (a) => {
      const artifact = await getArtifact(a.id);
      return {
        appointmentId: a.id,
        sessionDate: a.startTime,
        providerName: a.providerName,
        status: a.status,
        summaryAvailable:
          artifact?.reviewStatus === "approved" && Boolean(artifact.summaryFinal),
      };
    }),
  );

  if (sessions.length > 0) {
    recordAudit({
      tenantId: sorted[0].tenantId,
      actorId: payload.sub,
      actorRole: "client",
      action: "qa.asked",
      resource: "appointment",
      resourceId: null,
      metadata: {
        source: "elevenlabs.tool",
        tool: "list_my_sessions",
        conv: payload.conv,
        count: sessions.length,
      },
    });
  }

  return NextResponse.json({ sessions });
}
