// Mints a short-lived ElevenLabs ConvAI conversation: requires an authed
// client session, asks ElevenLabs for a signed URL bound to our agent, and
// returns it alongside a `user_token` dynamic variable that the agent
// replays in `Authorization` headers when calling our tool webhooks.

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { mintConversationToken } from "@/lib/eleven-token";

export async function POST() {
  // Inline the auth check so we can log *why* it failed (signed-out vs.
  // wrong role) rather than the generic "auth check failed."
  const session = await getCurrentUser();
  if (!session) {
    console.warn("[signed-url] no session cookie — visitor is signed out");
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (session.role !== "client") {
    console.warn(
      `[signed-url] session.role=${session.role}, expected "client" — provider/admin sessions can't open the client agent`,
    );
    return NextResponse.json(
      { error: "Client session required." },
      { status: 403 },
    );
  }
  // Stand-in for the destructured `auth.user` shape the rest of the route
  // expects, without keeping the unused requireAuthApi import.
  const auth = { user: session } as const;
  if (!auth.user.clientId) {
    console.warn("[signed-url] no clientId on session");
    return NextResponse.json(
      { error: "Missing client identity." },
      { status: 400 },
    );
  }
  if (!env.elevenlabs.apiKey || !env.elevenlabs.qaAgentId) {
    console.warn(
      `[signed-url] not configured — apiKey=${Boolean(env.elevenlabs.apiKey)}, qaAgentId=${Boolean(env.elevenlabs.qaAgentId)}`,
    );
    return NextResponse.json(
      {
        error:
          "ElevenLabs agent is not configured. Set ELEVENLABS_API_KEY and ELEVENAGENTS_QA_AGENT_ID.",
      },
      { status: 503 },
    );
  }

  // ElevenLabs REST API uses snake_case path segments. Earlier we had the
  // hyphenated form here (`get-signed-url`), which 404'd silently.
  const url = new URL(
    "https://api.elevenlabs.io/v1/convai/conversation/get_signed_url",
  );
  url.searchParams.set("agent_id", env.elevenlabs.qaAgentId);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { "xi-api-key": env.elevenlabs.apiKey },
      cache: "no-store",
    });
  } catch (err) {
    console.error(
      `[signed-url] network error reaching ElevenLabs: ${(err as Error).message}`,
    );
    return NextResponse.json(
      { error: "Couldn't reach ElevenLabs." },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const errBody = await upstream.text().catch(() => "");
    console.error(
      `[signed-url] ElevenLabs ${upstream.status}: ${errBody.slice(0, 400)}`,
    );
    return NextResponse.json(
      {
        error: `Could not start an agent session (ElevenLabs ${upstream.status}).`,
        upstream: errBody.slice(0, 400),
      },
      { status: 502 },
    );
  }

  const data = (await upstream.json()) as { signed_url?: string };
  if (!data.signed_url) {
    console.error(
      `[signed-url] ElevenLabs returned 200 but no signed_url field. body=${JSON.stringify(data).slice(0, 200)}`,
    );
    return NextResponse.json(
      { error: "Agent did not return a signed URL." },
      { status: 502 },
    );
  }

  const conversationId = randomUUID();
  const userToken = mintConversationToken({
    clientId: auth.user.clientId,
    conversationId,
  });

  console.log(
    `[signed-url] minted token for ${auth.user.clientId} (conv ${conversationId})`,
  );

  return NextResponse.json({
    signedUrl: data.signed_url,
    dynamicVariables: { user_token: userToken },
  });
}
