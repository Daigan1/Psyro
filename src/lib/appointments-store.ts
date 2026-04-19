// Server-only: never import from a "use client" module.
// Appointment store. Thin async wrapper around DynamoDB — no in-memory
// cache. Appointments are durable business data and always live in the
// `tinyfish_appointments` table.

import {
  ddbGetAppointment,
  ddbIsSlotBooked,
  ddbListAppointmentsForClient,
  ddbListAppointmentsForProvider,
  ddbPutAppointment,
} from "./aws/dynamodb";
import type { Appointment } from "./types";

export async function putAppointment(a: Appointment): Promise<void> {
  await ddbPutAppointment(a);
}

export async function getAppointment(id: string): Promise<Appointment | null> {
  return ddbGetAppointment(id);
}

export async function listAppointmentsForClient(
  clientId: string,
): Promise<Appointment[]> {
  return ddbListAppointmentsForClient(clientId);
}

export async function listAppointmentsForProvider(
  providerId: string,
): Promise<Appointment[]> {
  return ddbListAppointmentsForProvider(providerId);
}

export async function isSlotBooked(
  providerId: string,
  startTime: string,
): Promise<boolean> {
  return ddbIsSlotBooked(providerId, startTime);
}

// One provider-list query → set of booked startTimes. Used by availability
// filters instead of N isSlotBooked calls.
export async function bookedSlotsForProvider(
  providerId: string,
): Promise<Set<string>> {
  const list = await listAppointmentsForProvider(providerId);
  const booked = new Set<string>();
  for (const a of list) {
    if (a.status === "cancelled" || a.status === "late-cancel") continue;
    booked.add(a.startTime);
  }
  return booked;
}
