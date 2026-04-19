// Server-only: never import from a "use client" module.
// Q&A interaction log, keyed by appointmentId + askedAt. DDB-only.

import { ddbListInteractions, ddbPutInteraction } from "./aws/dynamodb";
import type { QAInteraction } from "./types";

export async function listInteractions(
  appointmentId: string,
): Promise<QAInteraction[]> {
  return ddbListInteractions(appointmentId);
}

export async function recordInteraction(
  interaction: QAInteraction,
): Promise<void> {
  await ddbPutInteraction(interaction);
}
