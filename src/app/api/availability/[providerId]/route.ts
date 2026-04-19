import { NextResponse } from "next/server";
import { getAvailability, getTherapist } from "@/lib/mock-availability";
import { bookedSlotsForProvider } from "@/lib/appointments-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ providerId: string }> },
) {
  const { providerId } = await params;
  const [therapist, booked, allSlots] = await Promise.all([
    getTherapist(providerId),
    bookedSlotsForProvider(providerId),
    getAvailability(providerId),
  ]);
  if (!therapist) {
    return NextResponse.json({ error: "Therapist not found" }, { status: 404 });
  }
  const slots = allSlots.filter((s) => !booked.has(s.startTime));
  return NextResponse.json({ therapist, slots });
}
