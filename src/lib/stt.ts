// Server-only: never import from a "use client" module.
// Speech-to-text + summarization pipeline. Real wires:
//   - Audio source: Daily.co cloud recording (lib/daily.ts).
//   - Transcription: ElevenLabs Scribe, word-level timestamps grouped into
//     ~25s segments (lib/eleven-stt.ts).
//   - Summarization: Featherless tool-call (lib/featherless.ts).
//
// Errors bubble up as TranscriptionUnavailable so the calling route can
// 503 cleanly. The provider review page polls automatically once Daily
// finishes encoding the MP4 (~30s-2min after the call ends).

import type { Appointment, DraftSummary, TranscriptSegment } from "./types";
import {
  DailyError,
  dailyConfigured,
  getLatestRecording,
  getRecordingAccessUrl,
} from "./daily";
import {
  ElevenSTTError,
  elevenSTTConfigured,
  transcribeAudioUrl,
} from "./eleven-stt";
import {
  featherlessConfigured,
  summarizeTranscriptWithFeatherless,
} from "./featherless";

export class TranscriptionUnavailable extends Error {
  constructor(message = "Transcription service is not configured.") {
    super(message);
    this.name = "TranscriptionUnavailable";
  }
}

export type TranscriptionResult = {
  text: string;
  segments: TranscriptSegment[];
  recordingId: string;
  recordingDurationSeconds: number;
};

// Fetch the most recent Daily recording for this appointment, get a signed
// download URL, and run it through Whisper. Throws TranscriptionUnavailable
// when either provider is unconfigured OR when the recording isn't ready
// yet (Daily encodes asynchronously — typical lag is 30s-2min for a 50-min
// session).
export async function transcribeSession(
  appointment: Appointment,
): Promise<TranscriptionResult> {
  if (!dailyConfigured()) {
    throw new TranscriptionUnavailable(
      "Daily.co not configured. Set DAILY_API_KEY.",
    );
  }
  if (!elevenSTTConfigured()) {
    throw new TranscriptionUnavailable(
      "ElevenLabs STT not configured. Set ELEVENLABS_API_KEY.",
    );
  }

  let recording;
  try {
    recording = await getLatestRecording(appointment.id);
  } catch (err) {
    if (err instanceof DailyError) {
      throw new TranscriptionUnavailable(
        `Daily error fetching recording: ${err.message}`,
      );
    }
    throw err;
  }
  if (!recording) {
    throw new TranscriptionUnavailable(
      "Recording is not ready yet. Daily encodes after the call ends — try again in a minute.",
    );
  }

  let audioUrl: string;
  try {
    audioUrl = await getRecordingAccessUrl(recording.id);
  } catch (err) {
    if (err instanceof DailyError) {
      throw new TranscriptionUnavailable(
        `Daily error minting access link: ${err.message}`,
      );
    }
    throw err;
  }

  let result;
  try {
    result = await transcribeAudioUrl(audioUrl);
  } catch (err) {
    if (err instanceof ElevenSTTError) {
      throw new TranscriptionUnavailable(
        `ElevenLabs STT failed: ${err.message}`,
      );
    }
    throw err;
  }

  return {
    text: result.text,
    segments: result.segments,
    recordingId: recording.id,
    recordingDurationSeconds: recording.duration,
  };
}

// Featherless summarizer. Throws TranscriptionUnavailable so the same
// review flow can swallow this case the same way it handles missing STT.
export async function summarizeTranscript(
  transcript: string,
): Promise<DraftSummary> {
  if (!featherlessConfigured()) {
    throw new TranscriptionUnavailable(
      "Summarizer not configured. Set FEATHERLESS_API_KEY and FEATHERLESS_MODEL_MATCHER.",
    );
  }
  if (!transcript.trim()) {
    throw new TranscriptionUnavailable("Transcript is empty.");
  }
  return summarizeTranscriptWithFeatherless(transcript);
}
