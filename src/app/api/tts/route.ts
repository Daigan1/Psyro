// ElevenLabs Text-to-Speech proxy. The in-session QnA panel uses this
// instead of the browser's robotic SpeechSynthesis API. Returns raw MP3
// bytes so the client can drop them into a `new Audio(URL.createObjectURL(blob))`.
//
// Auth: requires a signed-in client (the QnA panel only renders for
// authenticated session viewers, so this matches the trust boundary).
// Note: TTS streams the user's question back in spoken form — that audio
// transits ElevenLabs. No BAA, so synthetic / non-PHI content only.

import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth-api";
import { env } from "@/lib/env";

const MAX_CHARS = 4000;

type Body = { text?: string };

export async function POST(request: Request) {
  const auth = await requireAuthApi("client");
  if ("error" in auth) return auth.error;

  if (!env.elevenlabs.apiKey || !env.elevenlabs.voiceId) {
    return NextResponse.json(
      {
        error:
          "TTS not configured. Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID.",
      },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const text = body.text?.trim() ?? "";
  if (!text) {
    return NextResponse.json({ error: "Empty text." }, { status: 400 });
  }
  if (text.length > MAX_CHARS) {
    return NextResponse.json(
      { error: `Text too long (max ${MAX_CHARS} chars).` },
      { status: 400 },
    );
  }

  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(env.elevenlabs.voiceId)}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": env.elevenlabs.apiKey,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
    },
  );

  if (!upstream.ok) {
    const errText = await upstream.text();
    console.error(
      `[tts] ElevenLabs ${upstream.status}: ${errText.slice(0, 200)}`,
    );
    return NextResponse.json(
      { error: "TTS upstream failed." },
      { status: 502 },
    );
  }

  const audio = await upstream.arrayBuffer();
  return new Response(audio, {
    status: 200,
    headers: {
      "content-type": "audio/mpeg",
      "cache-control": "no-store",
    },
  });
}
