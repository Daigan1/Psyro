// Server-only: never import from a "use client" module.
// Per-client intake progress. DDB-only — intake inputs include crisis flags
// and other PHI-adjacent data, so they shouldn't live in process memory.

import {
  ddbGetIntakeProgress,
  ddbPutIntakeProgress,
} from "./aws/dynamodb";
import type { IntakeInput, IntakeProgress, MatchResult } from "./types";

export type { IntakeProgress } from "./types";

export async function getIntakeProgress(
  clientId: string,
): Promise<IntakeProgress | null> {
  return ddbGetIntakeProgress(clientId);
}

export async function saveIntakeProgress(
  clientId: string,
  data: IntakeInput,
  step: number,
): Promise<IntakeProgress> {
  const existing = await ddbGetIntakeProgress(clientId);
  const next: IntakeProgress = {
    clientId,
    data,
    step,
    completed: existing?.completed ?? false,
    completedAt: existing?.completedAt ?? null,
    matchResult: existing?.matchResult ?? null,
  };
  await ddbPutIntakeProgress(next);
  return next;
}

export async function markIntakeCompleted(
  clientId: string,
  data: IntakeInput,
  result: MatchResult,
): Promise<IntakeProgress> {
  const next: IntakeProgress = {
    clientId,
    data,
    step: 3,
    completed: true,
    completedAt: new Date().toISOString(),
    matchResult: result,
  };
  await ddbPutIntakeProgress(next);
  return next;
}
