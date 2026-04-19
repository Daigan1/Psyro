import { NextResponse } from "next/server";
import type { IntakeInput, MatchResult } from "@/lib/types";
import { requireAuthApi } from "@/lib/auth-api";
import { CRISIS_RESOURCES, screenForCrisis } from "@/lib/crisis";
import { markIntakeCompleted } from "@/lib/intake-store";
import { rankTherapists } from "@/lib/matching";

export async function POST(request: Request) {
  const authResult = await requireAuthApi("client");
  if ("error" in authResult) return authResult.error;
  const user = authResult.user;

  let payload: IntakeInput;
  try {
    payload = (await request.json()) as IntakeInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validationError = validate(payload);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  if (
    screenForCrisis({
      imminentHarm: payload.crisis.imminentHarm,
      description: payload.problems.description,
      notes: payload.crisis.notes,
    })
  ) {
    const result: MatchResult = {
      kind: "crisis",
      hotline: CRISIS_RESOURCES,
      message:
        "Your safety comes first. Please reach out to one of these resources now — a trained counselor is available 24/7. You can return here to find a therapist any time.",
    };
    await markIntakeCompleted(user.clientId!, payload, result);
    return NextResponse.json(result);
  }

  let matches;
  try {
    matches = await rankTherapists(payload);
  } catch (err) {
    console.error("[match] Featherless pipeline failed:", err);
    return NextResponse.json(
      {
        error:
          "Our matching service is unavailable right now. Please try again in a moment.",
      },
      { status: 503 },
    );
  }
  // matches.length === 0 only when the workspace has zero active providers —
  // matching no longer hard-filters on preferences, so any active therapist
  // is included (downranked, not excluded, on a preference mismatch).
  if (matches.length === 0) {
    const result: MatchResult = {
      kind: "no-matches",
      reason:
        "No therapists are accepting new clients on TinyFish right now. Please check back soon.",
    };
    await markIntakeCompleted(user.clientId!, payload, result);
    return NextResponse.json(result);
  }

  const result: MatchResult = {
    kind: "matches",
    matches,
    topChoiceId: matches.find((m) => m.isTopChoice)?.therapist.id ?? null,
  };
  await markIntakeCompleted(user.clientId!, payload, result);
  return NextResponse.json(result);
}

function validate(p: IntakeInput | undefined): string | null {
  if (!p) return "Missing body";
  if (!p.personalInfo?.name || p.personalInfo.name.trim().length < 2) {
    return "Please tell us your name so your therapist knows who they're meeting.";
  }
  if (!p.problems?.description || p.problems.description.trim().length < 10) {
    return "Please describe what you're going through in a bit more detail.";
  }
  if (!p.preferences) return "Missing preferences";
  if (typeof p.crisis?.imminentHarm !== "boolean") {
    return "Please answer the safety question.";
  }
  return null;
}
