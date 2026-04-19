import type { AvailabilitySlot, Therapist, WeeklyAvailability } from "./types";
import { getProvider } from "./providers-store";

// How far ahead to surface bookable slots when a provider has published a
// weekly schedule. Keeps parity with the fallback window below.
const SCHEDULE_HORIZON_DAYS = 14;

// Fallback slot generator used for providers that have not yet configured a
// weekly schedule: 5 business days from their nextAvailable with 3 fixed slots
// per day at 10/14/18 UTC.
function generateFallbackSlots(therapist: Therapist): AvailabilitySlot[] {
  const base = new Date(therapist.nextAvailable);
  const slots: AvailabilitySlot[] = [];
  const hours = [10, 14, 18];
  for (let day = 0; day < 5; day++) {
    const date = new Date(base);
    date.setUTCDate(base.getUTCDate() + day);
    for (const h of hours) {
      const start = new Date(date);
      start.setUTCHours(h, 0, 0, 0);
      const end = new Date(start);
      end.setUTCMinutes(50);
      slots.push({
        providerId: therapist.id,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
      });
    }
  }
  return slots;
}

// Expand a weekly recurring schedule into concrete slots over the next
// SCHEDULE_HORIZON_DAYS, dropping anything already in the past.
function generateFromSchedule(
  therapist: Therapist,
  schedule: WeeklyAvailability,
): AvailabilitySlot[] {
  const slots: AvailabilitySlot[] = [];
  const now = Date.now();
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  for (let day = 0; day < SCHEDULE_HORIZON_DAYS; day++) {
    const date = new Date(base);
    date.setUTCDate(base.getUTCDate() + day);
    const dow = date.getUTCDay();
    const hours = schedule[dow];
    if (!hours || hours.length === 0) continue;
    for (const h of hours) {
      const start = new Date(date);
      start.setUTCHours(h, 0, 0, 0);
      if (start.getTime() <= now) continue;
      const end = new Date(start);
      end.setUTCMinutes(50);
      slots.push({
        providerId: therapist.id,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
      });
    }
  }
  return slots.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export async function getAvailability(
  providerId: string,
): Promise<AvailabilitySlot[]> {
  const therapist = await getProvider(providerId);
  if (!therapist || therapist.status !== "active") return [];
  if (therapist.weeklyAvailability) {
    return generateFromSchedule(therapist, therapist.weeklyAvailability);
  }
  return generateFallbackSlots(therapist);
}

export async function getTherapist(
  providerId: string,
): Promise<Therapist | null> {
  return getProvider(providerId);
}
