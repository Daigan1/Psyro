// Server-only: never import from a "use client" module.
// Featherless AI matcher client. Uses OpenAI-compatible tool calling so the
// model is forced to emit structured JSON. Two pipeline stages:
//   1. categorizeWithFeatherless — extract concern + modality tags from the
//      client's free-text intake description (`extract_intake_signals`).
//   2. rankWithFeatherless         — rank candidate therapists against the
//      enriched intake (`submit_ranked_matches`).
//
// Scope: therapist matching only. Transcripts and session summaries do NOT
// route through Featherless — those stay on ElevenLabs/ElevenAgents per plan.

import type {
  DraftSummary,
  IntakeInput,
  Match,
  SessionArtifact,
  Therapist,
  TherapistResource,
} from "./types";
import { env } from "./env";

const DEFAULT_BASE_URL = "https://api.featherless.ai/v1";

// Structured schema the tool must emit. Kept narrow so the model can't drift.
type ToolMatch = {
  therapistId: string;
  score: number;
  reasoning: string;
};

type ToolResponse = {
  matches: ToolMatch[];
  topChoiceId: string;
};

const TOOL_DEF = {
  type: "function" as const,
  function: {
    name: "submit_ranked_matches",
    description:
      "Submit the final ranked list of therapists for this client. You MUST call this tool exactly once with the ranking.",
    parameters: {
      type: "object",
      required: ["matches", "topChoiceId"],
      additionalProperties: false,
      properties: {
        matches: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["therapistId", "score", "reasoning"],
            additionalProperties: false,
            properties: {
              therapistId: {
                type: "string",
                description:
                  "The id of the therapist from the provided candidate list. Must match exactly.",
              },
              score: {
                type: "number",
                minimum: 0,
                maximum: 1,
                description:
                  "Fit score 0-1. Base this only on how well the therapist's specialties, modalities, and availability match the client's stated concerns and preferences.",
              },
              reasoning: {
                type: "string",
                description:
                  "One sentence explaining why this therapist fits. Ground only in the client's stated concerns and the therapist profile. Do not invent facts or make clinical claims.",
              },
            },
          },
        },
        topChoiceId: {
          type: "string",
          description:
            "The therapistId of the single best match. Must be one of the ids in `matches`.",
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You are a clinical operations assistant that ranks licensed therapists for a client based on structured intake data and structured therapist profiles.

Rules (non-negotiable):
- Never diagnose, prescribe, or give clinical advice.
- Base ranking ONLY on the fields you were given. Do not invent credentials, specialties, or availability.
- Score EVERY candidate you are given. Do not omit any. The client wants to see the full list ranked best-to-worst.
- Use the full 0-1 score range. Strong fits score 0.7+. Weak fits score in the 0.1-0.4 range — still include them, just rank them lower.
- Treat the client's gender and session-format preferences as soft signals: a mismatch should lower the score, not exclude the therapist.
- The client has already been screened for imminent crisis before you see this request.
- You MUST respond by calling the submit_ranked_matches tool exactly once. Do not reply in text.`;

export function featherlessConfigured(): boolean {
  return Boolean(env.featherless.apiKey && env.featherless.matcherModel);
}

const SUMMARIZE_TOOL = {
  type: "function" as const,
  function: {
    name: "submit_session_summary",
    description:
      "Submit the structured post-session summary the therapist will review. You MUST call this tool exactly once.",
    parameters: {
      type: "object",
      required: ["summary", "keyPoints", "actionItems", "followUps"],
      additionalProperties: false,
      properties: {
        summary: {
          type: "string",
          description:
            "2-4 sentence narrative of what was discussed, addressed to the client in second person ('You and your therapist talked about…'). No diagnoses, no medication advice, no quotes invented from outside the transcript.",
        },
        keyPoints: {
          type: "array",
          items: { type: "string" },
          description:
            "3-6 short bullets capturing the main themes you raised. Address the reader as 'you'. Grounded only in the transcript.",
        },
        actionItems: {
          type: "array",
          items: { type: "string" },
          description:
            "Things you agreed to try or work on before the next session, addressed in second person ('you'll…'). Empty array if none were named.",
        },
        followUps: {
          type: "array",
          items: { type: "string" },
          description:
            "Topics you and your therapist said you'd revisit next session, addressed in second person. Empty array if none.",
        },
      },
    },
  },
};

const SUMMARIZE_SYSTEM_PROMPT = `You are a clinical scribe drafting a post-session summary. The therapist reviews and approves it, and then the CLIENT reads it — so write directly TO the client.

Rules (non-negotiable):
- Address the reader in second person ("you", "your therapist"). Never write "the client" or "the patient" — those words belong in clinical notes, not in something the client opens on their dashboard.
- Refer to the therapist by their role ("your therapist") rather than their name unless the transcript clearly refers to them by name.
- Never diagnose, prescribe, or give clinical advice.
- Ground every word in the transcript. Do not invent action items you didn't agree to or follow-ups no one mentioned.
- Use warm, plain, non-judgmental language.
- If a category genuinely has nothing to record, return an empty array — do not pad.
- You MUST respond by calling the submit_session_summary tool exactly once. Do not reply in text.`;

// In-session Q&A answerer. The route hands us the question + the WHOLE
// approved artifact + the provider's resources (no retrieval pre-filter
// — Featherless does the relevance work itself). For one 50-min session
// the prompt fits comfortably in context. The model composes a 2-3
// sentence answer addressed to "you" and returns the citations it
// actually used. Forced JSON keeps the shape predictable so the QnA
// panel can render it without parsing prose.
const ANSWER_TOOL = {
  type: "function" as const,
  function: {
    name: "submit_session_answer",
    description:
      "Submit the user-facing answer plus the citations you used. You MUST call this tool exactly once.",
    parameters: {
      type: "object",
      required: ["answer", "citations"],
      additionalProperties: false,
      properties: {
        answer: {
          type: "string",
          description:
            "2-3 sentence reply addressed to the user as 'you'. Quote short snippets from the citations verbatim. Don't invent anything not in the candidates.",
        },
        citations: {
          type: "array",
          items: {
            type: "object",
            required: ["source", "sourceId", "quote"],
            additionalProperties: false,
            properties: {
              source: {
                type: "string",
                enum: ["transcript", "summary", "resource"],
                description: "Echoes the candidate's source field.",
              },
              sourceId: {
                type: "string",
                description: "Echoes the candidate's sourceId field.",
              },
              quote: {
                type: "string",
                description:
                  "A short verbatim snippet (≤200 chars) from the candidate text you actually used.",
              },
            },
          },
        },
      },
    },
  },
};

const ANSWER_SYSTEM_PROMPT = `You answer one user's questions about ONE specific therapy session of theirs. You only have access to the candidates the route hands you — every word of your answer must come from them.

Rules (non-negotiable):
- Address the user in second person ("you", "your therapist"). Never write "the client" or "the patient".
- Quote SHORT verbatim snippets from candidates. Do not paraphrase the candidate's content into something new.
- ALWAYS include at least one citation. Prefer transcript segments (sourceId starts with "seg-") over summary lines, because transcript citations get rendered as a clickable "listen back" link to the exact moment.
- For EVERY citation, copy the segment's sourceId verbatim (e.g. "seg-12") — do not invent ids, do not collapse multiple segments into one citation.
- Cite the source briefly inline ("from your transcript:", "your summary notes:", "from the resource your therapist shared:").
- If candidates don't contain the answer, say plainly: "I don't see that in this session — bring it up next time?". Don't invent.
- Never diagnose, never recommend medications, never predict outcomes.
- 2-3 sentences total. No markdown, no lists.
- You MUST respond by calling submit_session_answer exactly once.`;

export type SessionAnswerCitation = {
  source: string;
  sourceId: string;
  quote: string;
};

export type SessionAnswer = {
  answer: string;
  citations: SessionAnswerCitation[];
};

export async function answerSessionQuestion(args: {
  question: string;
  artifact: SessionArtifact;
  resources: TherapistResource[];
}): Promise<SessionAnswer> {
  if (!featherlessConfigured()) {
    throw new Error(
      "Featherless not configured. Set FEATHERLESS_API_KEY and FEATHERLESS_MODEL_MATCHER.",
    );
  }
  const userContent = buildSessionContext(args.artifact, args.resources, args.question);
  const call = await callFeatherlessTool({
    systemPrompt: ANSWER_SYSTEM_PROMPT,
    userContent,
    tool: ANSWER_TOOL,
    expectedToolName: "submit_session_answer",
  });
  const parsed = call as Partial<SessionAnswer>;
  const answer =
    typeof parsed.answer === "string" && parsed.answer.trim()
      ? parsed.answer.trim()
      : "I don't see that in this session — bring it up next time?";
  const citations = Array.isArray(parsed.citations)
    ? parsed.citations
        .filter(
          (c): c is SessionAnswerCitation =>
            typeof c?.source === "string" &&
            typeof c?.sourceId === "string" &&
            typeof c?.quote === "string",
        )
        .slice(0, 4)
    : [];
  return { answer, citations };
}

// Render the session as plain text the model can read top-to-bottom.
// Caps are tuned for an 8B-class model on Featherless: too much context
// makes the gateway time out the worker and return 500. Bigger models
// (70B / GPT-4 class) can take much more — bump the constants if you
// upgrade FEATHERLESS_MODEL_MATCHER.
const TRANSCRIPT_CHAR_CAP = 30_000; // ~7-8k tokens
const RESOURCE_CHAR_CAP = 3_000; // per resource

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function buildSessionContext(
  artifact: SessionArtifact,
  resources: TherapistResource[],
  question: string,
): string {
  const parts: string[] = [];
  parts.push(`QUESTION: ${question}`);

  const summary = artifact.summaryFinal;
  if (summary) {
    parts.push(
      `\n--- APPROVED SUMMARY (sourceId="${artifact.appointmentId}") ---`,
    );
    if (summary.summary) parts.push(`Summary: ${summary.summary}`);
    if (summary.keyPoints.length > 0)
      parts.push(`Key points:\n- ${summary.keyPoints.join("\n- ")}`);
    if (summary.actionItems.length > 0)
      parts.push(`Action items:\n- ${summary.actionItems.join("\n- ")}`);
    if (summary.followUps.length > 0)
      parts.push(`Follow-ups:\n- ${summary.followUps.join("\n- ")}`);
  }

  // Prefer Whisper segments — they give the model per-segment sourceIds
  // ("seg-0", "seg-1", …) it can cite, which the route then resolves
  // into clickable replay deep links. Fall back to flat text only when
  // segments aren't available (legacy pasted transcripts).
  const segments = artifact.transcriptSegments ?? [];
  if (segments.length > 0) {
    parts.push(
      `\n--- TRANSCRIPT SEGMENTS (cite by source="transcript", sourceId="seg-N") ---`,
    );
    let used = 0;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const line = `[seg-${i} @ ${formatSeconds(s.start)}] ${s.text}`;
      if (used + line.length > TRANSCRIPT_CHAR_CAP) {
        parts.push("…[transcript truncated]");
        break;
      }
      parts.push(line);
      used += line.length + 1;
    }
  } else {
    const transcript = artifact.transcriptEdited ?? artifact.transcriptRaw;
    if (transcript) {
      parts.push(
        `\n--- TRANSCRIPT (source="transcript", sourceId="${artifact.appointmentId}") ---`,
      );
      parts.push(
        transcript.length > TRANSCRIPT_CHAR_CAP
          ? transcript.slice(0, TRANSCRIPT_CHAR_CAP) +
              "\n…[transcript truncated]"
          : transcript,
      );
    }
  }

  const ingestedResources = resources.filter((r) => r.status === "ingested");
  if (ingestedResources.length > 0) {
    parts.push(`\n--- THERAPIST RESOURCES ---`);
    for (const r of ingestedResources) {
      parts.push(
        `\n[Resource: "${r.title}" (source="resource", sourceId="${r.id}")]\n${r.extractedText.slice(0, RESOURCE_CHAR_CAP)}`,
      );
    }
  }

  return parts.join("\n");
}

export async function summarizeTranscriptWithFeatherless(
  transcript: string,
): Promise<DraftSummary> {
  if (!featherlessConfigured()) {
    throw new Error(
      "Featherless not configured. Set FEATHERLESS_API_KEY and FEATHERLESS_MODEL_MATCHER.",
    );
  }
  const call = await callFeatherlessTool({
    systemPrompt: SUMMARIZE_SYSTEM_PROMPT,
    userContent: `Summarize this therapy session transcript:\n\n${transcript.slice(0, 60_000)}`,
    tool: SUMMARIZE_TOOL,
    expectedToolName: "submit_session_summary",
  });
  const parsed = call as Partial<DraftSummary>;
  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    keyPoints: Array.isArray(parsed.keyPoints)
      ? parsed.keyPoints.filter((s): s is string => typeof s === "string")
      : [],
    actionItems: Array.isArray(parsed.actionItems)
      ? parsed.actionItems.filter((s): s is string => typeof s === "string")
      : [],
    followUps: Array.isArray(parsed.followUps)
      ? parsed.followUps.filter((s): s is string => typeof s === "string")
      : [],
  };
}

export type CategorizedConcerns = {
  concerns: string[];
  modalitiesHinted: string[];
};

const CATEGORIZE_TOOL = {
  type: "function" as const,
  function: {
    name: "extract_intake_signals",
    description:
      "Extract structured concern and modality tags from the client's free-text intake description. You MUST call this tool exactly once.",
    parameters: {
      type: "object",
      required: ["concerns", "modalitiesHinted"],
      additionalProperties: false,
      properties: {
        concerns: {
          type: "array",
          items: { type: "string" },
          description:
            "Lowercase, hyphen-separated concern tags grounded only in what the client wrote (e.g. 'anxiety', 'work-stress', 'grief', 'sleep', 'relationship-conflict'). 0–8 items. Do not invent concerns the client did not describe.",
        },
        modalitiesHinted: {
          type: "array",
          items: { type: "string" },
          description:
            "Therapy approaches the client explicitly mentioned wanting (e.g. 'cbt', 'emdr', 'psychodynamic'). Empty array if none mentioned.",
        },
      },
    },
  },
};

const CATEGORIZE_SYSTEM_PROMPT = `You are an intake parser. You read a client's short description of what they're going through and produce a small set of normalized tags used to rank therapists.

Rules (non-negotiable):
- Never diagnose, prescribe, or assign clinical severity.
- Tags must be grounded in what the client wrote. Do not infer concerns they did not describe.
- Use lowercase, hyphen-separated tokens (e.g. "work-stress", not "Work Stress").
- You MUST respond by calling the extract_intake_signals tool exactly once. Do not reply in text.`;

export async function categorizeWithFeatherless(
  input: IntakeInput,
): Promise<CategorizedConcerns> {
  if (!featherlessConfigured()) {
    throw new Error(
      "Featherless not configured. Set FEATHERLESS_API_KEY and FEATHERLESS_MODEL_MATCHER.",
    );
  }

  const userPayload = {
    description: input.problems.description,
    clientPickedTags: input.problems.tags,
    statedModalityPreferences: input.preferences.modalities,
  };

  const call = await callFeatherlessTool({
    systemPrompt: CATEGORIZE_SYSTEM_PROMPT,
    userContent: `Extract the structured signals from this intake:\n\n${JSON.stringify(userPayload)}`,
    tool: CATEGORIZE_TOOL,
    expectedToolName: "extract_intake_signals",
  });

  const parsed = call as { concerns?: unknown; modalitiesHinted?: unknown };
  return {
    concerns: normalizeTagArray(parsed.concerns).slice(0, 8),
    modalitiesHinted: normalizeTagArray(parsed.modalitiesHinted).slice(0, 8),
  };
}

export async function rankWithFeatherless(
  input: IntakeInput,
  candidates: Therapist[],
): Promise<Match[]> {
  if (!featherlessConfigured()) {
    throw new Error(
      "Featherless not configured. Set FEATHERLESS_API_KEY and FEATHERLESS_MODEL_MATCHER.",
    );
  }
  if (candidates.length === 0) return [];

  const userPayload = {
    intake: {
      description: input.problems.description,
      tags: input.problems.tags,
      preferences: input.preferences,
    },
    candidates: candidates.map((t) => ({
      id: t.id,
      specialties: t.specialties,
      modalities: t.modalities,
      sessionFormats: t.sessionFormats,
      nextAvailable: t.nextAvailable,
      // Bio last so the model has structured signals before prose.
      bio: t.bio,
    })),
  };

  const call = await callFeatherlessTool({
    systemPrompt: SYSTEM_PROMPT,
    userContent: `Rank ALL ${candidates.length} candidates for this client, best-to-worst. Every candidate id must appear in your response. Pick exactly one topChoiceId — the highest-scoring therapist, even if no candidate is a strong fit.\n\n${JSON.stringify(userPayload)}`,
    tool: TOOL_DEF,
    expectedToolName: "submit_ranked_matches",
  });
  const parsed = call as ToolResponse;

  const byId = new Map(candidates.map((t) => [t.id, t]));
  const matches: Match[] = [];
  for (const m of parsed.matches ?? []) {
    const therapist = byId.get(m.therapistId);
    if (!therapist) continue; // drop hallucinated ids
    matches.push({
      therapist,
      score: clamp01(m.score),
      reasoning: m.reasoning,
      isTopChoice: m.therapistId === parsed.topChoiceId,
    });
  }

  if (!matches.some((m) => m.isTopChoice) && matches.length > 0) {
    matches[0].isTopChoice = true;
  }

  return matches;
}

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
};

async function callFeatherlessTool(args: {
  systemPrompt: string;
  userContent: string;
  tool: ToolDef;
  expectedToolName: string;
}): Promise<unknown> {
  const body = {
    model: env.featherless.matcherModel,
    messages: [
      { role: "system", content: args.systemPrompt },
      { role: "user", content: args.userContent },
    ],
    tools: [args.tool],
    tool_choice: {
      type: "function",
      function: { name: args.expectedToolName },
    },
    temperature: 0.2,
  };

  const base = env.featherless.baseUrl || DEFAULT_BASE_URL;

  // Featherless's gateway returns 5xx ("No successful response received from
  // completion service") when the underlying model worker times out or is
  // briefly unavailable. Retry once on 5xx with a short backoff before
  // giving up; 4xx errors (auth, malformed body) are not retryable.
  // Two retries with growing backoff. Featherless workers can cold-start
  // in a few seconds, and the gateway returns 500 if the first request
  // arrives before the worker is ready.
  const RETRYABLE_DELAYS_MS = [800, 2500];
  let res: Response | null = null;
  let lastErrText = "";
  for (let attempt = 0; attempt <= RETRYABLE_DELAYS_MS.length; attempt++) {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.featherless.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (res.ok) break;
    lastErrText = (await res.text()).slice(0, 500);
    if (res.status < 500 || attempt === RETRYABLE_DELAYS_MS.length) break;
    console.warn(
      `[featherless] ${args.expectedToolName} got ${res.status} from model "${env.featherless.matcherModel}", retrying`,
    );
    await new Promise((r) => setTimeout(r, RETRYABLE_DELAYS_MS[attempt]));
  }

  if (!res || !res.ok) {
    throw new Error(
      `Featherless ${res?.status ?? "no-response"} (model "${env.featherless.matcherModel}", tool ${args.expectedToolName}): ${lastErrText}`,
    );
  }

  const json = (await res.json()) as {
    choices: {
      message: {
        tool_calls?: {
          function: { name: string; arguments: string };
        }[];
      };
    }[];
  };

  const call = json.choices?.[0]?.message?.tool_calls?.[0];
  if (!call || call.function.name !== args.expectedToolName) {
    throw new Error(
      `Featherless did not emit ${args.expectedToolName} tool call`,
    );
  }
  try {
    return JSON.parse(call.function.arguments);
  } catch {
    throw new Error(
      `Featherless ${args.expectedToolName} arguments were not valid JSON`,
    );
  }
}

function normalizeTagArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const cleaned = item.trim().toLowerCase().replace(/\s+/g, "-");
    if (cleaned) out.push(cleaned);
  }
  return Array.from(new Set(out));
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
