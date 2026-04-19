// ElevenLabs ConvAI tool webhook: searches the resources the client's
// CURRENT therapist has uploaded (articles, worksheets, psychoeducation
// pasted text — anything in /provider/resources). Unlike
// search_my_transcript, this works without a session — the client can ask
// "what does my therapist say about sleep hygiene?" anytime.
//
// Auth: Bearer conversation token (same as the other eleven tools). The
// userId comes from the verified token; we look up their currentProviderId
// from the user record, then list that provider's resources.

import { NextResponse } from "next/server";
import { getUser } from "@/lib/users-store";
import { getProvider } from "@/lib/providers-store";
import { listResourcesForProvider } from "@/lib/resources-store";
import { recordAudit } from "@/lib/audit-log";
import { tokenFromRequest, verifyConversationToken } from "@/lib/eleven-token";
import type { TherapistResource } from "@/lib/types";

type Body = { question?: string };

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "for", "of",
  "to", "in", "on", "at", "by", "with", "that", "this", "these", "those",
  "it", "its", "as", "if", "then", "than", "so", "i", "me", "my", "you",
  "your", "we", "us", "our", "they", "them", "their", "can", "will",
  "would", "should", "could", "about", "from", "into", "not", "no", "yes",
]);

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

function score(question: Set<string>, text: string): number {
  const tokens = tokenize(text);
  if (tokens.size === 0) return 0;
  let overlap = 0;
  for (const t of question) if (tokens.has(t)) overlap += 1;
  if (overlap === 0) return 0;
  return overlap / Math.log(tokens.size + 2);
}

export async function POST(request: Request) {
  const { token, body: parsedBody } = await tokenFromRequest(request);
  const payload = token ? verifyConversationToken(token) : null;
  if (!payload) {
    console.warn(
      "[eleven-tool] search_my_resources called without a valid token (header or body).",
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  if (Object.keys(parsedBody).length > 0) {
    body = parsedBody as Body;
  } else {
    try {
      body = (await request.json()) as Body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
  }
  const question = body.question?.trim();
  console.log(
    `[eleven-tool] search_my_resources: ${payload.sub} → "${(question ?? "").slice(0, 80)}"`,
  );
  if (!question || question.length < 3) {
    return NextResponse.json(
      { error: "Ask a longer question." },
      { status: 400 },
    );
  }

  const record = await getUser(payload.sub);
  if (!record || record.role !== "client") {
    console.warn(
      `[eleven-tool] search_my_resources: user ${payload.sub} not a client record`,
    );
    return NextResponse.json(
      { error: "Client account required." },
      { status: 403 },
    );
  }
  const providerId = record.currentProviderId;
  if (!providerId) {
    console.warn(
      `[eleven-tool] search_my_resources: client ${payload.sub} has no currentProviderId`,
    );
    return NextResponse.json({
      citations: [],
      message:
        "You haven't selected a therapist yet. Pick one from /matches or /settings so I can look up their shared resources.",
    });
  }

  const provider = await getProvider(providerId);
  if (!provider) {
    console.warn(
      `[eleven-tool] search_my_resources: provider ${providerId} not found`,
    );
    return NextResponse.json({
      citations: [],
      message:
        "Couldn't find your therapist on file. Try re-selecting them in Settings.",
    });
  }

  const all = await listResourcesForProvider(providerId);
  const myResources = all.filter((r): r is TherapistResource => {
    if (r.status !== "ingested") return false;
    // Per-client visibility: empty clientIds = visible to everyone the
    // therapist sees; populated array = scoped to listed clientIds.
    const scoped = r.clientIds && r.clientIds.length > 0;
    if (scoped && !r.clientIds!.includes(payload.sub)) return false;
    return true;
  });
  console.log(
    `[eleven-tool] search_my_resources: provider=${providerId} total=${all.length} visible=${myResources.length}`,
  );
  if (myResources.length === 0) {
    const rejectionReasons = all.map((r) => {
      if (r.status !== "ingested") return `status=${r.status}`;
      const scoped = r.clientIds && r.clientIds.length > 0;
      if (scoped && !r.clientIds!.includes(payload.sub))
        return `scoped-to-others(${r.clientIds!.join(",")})`;
      return "ok?";
    });
    console.warn(
      `[eleven-tool] search_my_resources: 0 visible. Reasons: ${JSON.stringify(rejectionReasons).slice(0, 500)}`,
    );
    return NextResponse.json({
      citations: [],
      message: "Your therapist hasn't shared any resources that are visible to you yet.",
    });
  }

  const q = tokenize(question);
  type Cand = {
    resourceId: string;
    title: string;
    quote: string;
    score: number;
  };
  const candidates: Cand[] = [];
  for (const r of myResources) {
    for (const c of r.chunks) {
      const s = score(q, c.text);
      candidates.push({
        resourceId: r.id,
        title: r.title,
        quote: c.text.slice(0, 320),
        score: s,
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  // Relaxed selection: if anything scored above 0, use only those.
  // Otherwise return the first chunk of each visible resource as
  // "nothing matched but here's what's available" — the agent can at
  // least name the titles and let the user ask more specifically.
  const matched = candidates.filter((c) => c.score > 0);
  const fallback: Cand[] =
    matched.length === 0
      ? myResources.slice(0, 5).map((r) => ({
          resourceId: r.id,
          title: r.title,
          quote: (r.chunks[0]?.text ?? "").slice(0, 320),
          score: 0,
        }))
      : [];
  const citations = (matched.length > 0 ? matched : fallback).slice(0, 5);
  console.log(
    `[eleven-tool] search_my_resources: qTokens=${q.size} candidates=${candidates.length} matched=${matched.length} returning=${citations.length}`,
  );

  recordAudit({
    actorId: payload.sub,
    actorRole: "client",
    action: "qa.asked",
    resource: "resource",
    resourceId: null,
    metadata: {
      source: "elevenlabs.tool",
      tool: "search_my_resources",
      conv: payload.conv,
      citationCount: citations.length,
    },
  });

  const exactMatch = matched.length > 0;
  return NextResponse.json({
    instructions: exactMatch
      ? "Quote the most relevant snippet verbatim and name the resource it came from."
      : "No keyword match — these are the resources your therapist has shared with you. Name the titles to the user and ask which one they meant.",
    matchType: exactMatch ? "keyword" : "fallback-listing",
    citations: citations.map((c) => ({
      resourceId: c.resourceId,
      title: c.title,
      quote: c.quote,
    })),
  });
}
