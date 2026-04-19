import type { IntakeInput, Match } from "./types";
import { listProviders } from "./providers-store";
import {
  categorizeWithFeatherless,
  featherlessConfigured,
  rankWithFeatherless,
} from "./featherless";

// Featherless does both stages — categorize free-text intake into
// structured tags, then rank candidates against the enriched intake.
// No heuristic fallback: if Featherless is unavailable we throw and the
// API route surfaces a 503 to the client.
//
// Filtering policy: we deliberately do NOT hard-filter on gender or
// session-format preference. Those go to the LLM as soft signals so a
// preference mismatch lowers the score instead of removing the therapist
// from the list. The product wants the user to see every active provider
// ranked best-to-worst, even when no candidate is a perfect fit.
export async function rankTherapists(input: IntakeInput): Promise<Match[]> {
  if (!featherlessConfigured()) {
    throw new Error(
      "Matching service not configured. Set FEATHERLESS_API_KEY and FEATHERLESS_MODEL_MATCHER.",
    );
  }

  const all = await listProviders();
  const eligible = all.filter((t) => t.status === "active");
  if (eligible.length === 0) return [];

  const categorized = await categorizeWithFeatherless(input);
  const enrichedInput: IntakeInput = {
    ...input,
    problems: {
      ...input.problems,
      tags: dedupe([...input.problems.tags, ...categorized.concerns]),
    },
    preferences: {
      ...input.preferences,
      modalities: dedupe([
        ...input.preferences.modalities,
        ...categorized.modalitiesHinted,
      ]),
    },
  };

  const ranked = await rankWithFeatherless(enrichedInput, eligible);

  // Defensive: if the model omitted any candidates, append them with a
  // small floor score so the UI still shows them at the bottom of the list.
  const rankedIds = new Set(ranked.map((m) => m.therapist.id));
  const tail: Match[] = eligible
    .filter((t) => !rankedIds.has(t.id))
    .map((t) => ({
      therapist: t,
      score: 0.1,
      reasoning:
        "Less directly aligned with what you described, but available to take new clients",
      isTopChoice: false,
    }));

  const merged = [...ranked, ...tail].sort((a, b) => b.score - a.score);
  // Re-anchor the top-choice flag in case sorting changed the head.
  merged.forEach((m, i) => {
    m.isTopChoice = i === 0;
  });
  return merged;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}
