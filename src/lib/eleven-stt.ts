// Server-only: never import from a "use client" module.
// ElevenLabs Speech-to-Text (Scribe) client. Replaces Whisper; the same
// `transcribeAudioUrl(url)` shape so lib/stt.ts is unchanged.
//
// Why ElevenLabs over Whisper:
//   - Much larger upload ceiling (~1 GB vs Whisper's 25 MB), so the full
//     Daily MP4 recording works without an audio-extraction step.
//   - Word-level timestamps native; we group into ~25s segments below for
//     citation-friendly granularity in the Q&A retriever.
//
// Auth: ELEVENLABS_API_KEY (already in env, also used by the conv-AI agent).

import type { TranscriptSegment } from "./types";
import { env } from "./env";

const ELEVEN_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";
const MODEL_ID = "scribe_v1";

export class ElevenSTTError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ElevenSTTError";
  }
}

export function elevenSTTConfigured(): boolean {
  return Boolean(env.elevenlabs.apiKey);
}

export type ElevenSTTResult = {
  text: string;
  segments: TranscriptSegment[];
};

type ElevenWord = {
  text: string;
  start?: number;
  end?: number;
  type?: string;
};

type ElevenScribeResponse = {
  text?: string;
  language_code?: string;
  words?: ElevenWord[];
};

export async function transcribeAudioUrl(
  audioUrl: string,
): Promise<ElevenSTTResult> {
  // Pull the audio bytes server-side. Daily's access link is short-lived
  // and ElevenLabs requires multipart upload of the file body — there's no
  // URL-fetch path on the API.
  const audioRes = await fetch(audioUrl, { cache: "no-store" });
  if (!audioRes.ok) {
    throw new ElevenSTTError(
      audioRes.status,
      `Could not download recording (${audioRes.status})`,
    );
  }
  const audioBlob = await audioRes.blob();
  return transcribeAudioBlob(audioBlob);
}

export async function transcribeAudioBlob(
  audioBlob: Blob,
  filename = "session.mp4",
): Promise<ElevenSTTResult> {
  if (!env.elevenlabs.apiKey) {
    throw new ElevenSTTError(
      503,
      "ElevenLabs not configured. Set ELEVENLABS_API_KEY.",
    );
  }

  const form = new FormData();
  form.append("file", audioBlob, filename);
  form.append("model_id", MODEL_ID);
  // tag_audio_events / diarize default off; we don't need speakers right now.
  form.append("timestamps_granularity", "word");

  const res = await fetch(ELEVEN_STT_URL, {
    method: "POST",
    headers: { "xi-api-key": env.elevenlabs.apiKey },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ElevenSTTError(
      res.status,
      `ElevenLabs STT ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  const json = (await res.json()) as ElevenScribeResponse;
  const segments = groupWordsIntoSegments(json.words ?? []);
  return {
    text: json.text ?? segments.map((s) => s.text).join(" "),
    segments,
  };
}

// Word-level → segment-level. Cuts on sentence-final punctuation once the
// segment has at least 5s of audio, otherwise after 25s of words. Keeps
// segments short enough that a citation timestamp lands within the
// listener's working memory of "what was just being talked about."
function groupWordsIntoSegments(words: ElevenWord[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let buf: ElevenWord[] = [];
  let bufStart: number | null = null;

  function flush(end: number) {
    if (buf.length === 0 || bufStart === null) return;
    const text = buf
      .map((w) => w.text ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (text) segments.push({ start: bufStart, end, text });
    buf = [];
    bufStart = null;
  }

  for (const w of words) {
    // Scribe emits both "word" and "spacing" entries; keep both joined so
    // the reconstructed text reads naturally, but only word entries reset
    // the segment timer.
    if (typeof w.start === "number" && bufStart === null) {
      bufStart = w.start;
    }
    buf.push(w);

    if (w.type !== "word" || typeof w.end !== "number") continue;
    const duration = w.end - (bufStart ?? w.end);
    const endsSentence = /[.!?]\s*$/.test(w.text ?? "");
    if (duration >= 25 || (endsSentence && duration >= 5)) {
      flush(w.end);
    }
  }
  if (buf.length > 0) {
    const last = buf[buf.length - 1];
    flush(typeof last.end === "number" ? last.end : (bufStart ?? 0));
  }
  return segments;
}
