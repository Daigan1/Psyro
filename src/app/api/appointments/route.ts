import { NextResponse } from "next/server";
import { listAppointmentsForClient } from "@/lib/appointments-store";
import { getClientId } from "@/lib/session";

export async function GET() {
  const clientId = await getClientId();
  if (!clientId) {
    return NextResponse.json({ appointments: [] });
  }
  const appointments = await listAppointmentsForClient(clientId);
  return NextResponse.json({ appointments });
}
