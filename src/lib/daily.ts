// Server-only: never import from a "use client" module.
// Daily.co room + recording client. Used as a no-BAA video provider —
// fine for prototyping with synthetic / non-PHI sessions only. For real
// HIPAA traffic, swap to a Chime/Zoom/Daily-Enterprise tier with a BAA.
//
// We hit Daily's REST API directly. No SDK install — keeps deps minimal
// and means the client only loads the prebuilt iframe (also no install).

import { env } from "./env";

const BASE = "https://api.daily.co/v1";

export type DailyRoom = {
  name: string;
  url: string;
};

export type DailyRecording = {
  id: string;
  roomName: string;
  startTs: number;
  duration: number;
  status: string;
};

export class DailyError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "DailyError";
  }
}

export function dailyConfigured(): boolean {
  return Boolean(env.daily.apiKey);
}

function ensureKey(): string {
  if (!env.daily.apiKey) {
    throw new DailyError(503, "Daily.co not configured. Set DAILY_API_KEY.");
  }
  return env.daily.apiKey;
}

async function dailyFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const apiKey = ensureKey();
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    cache: "no-store",
  });
}

// Create a single-purpose room for an appointment. Idempotent on the Daily
// side because we use the appointment id as the room name — calling create
// twice for the same appointment returns the existing room.
export async function createRoom(appointmentId: string): Promise<DailyRoom> {
  const name = roomNameFor(appointmentId);
  // Room expires 4 hours after creation — long enough for a 50-min session
  // plus slack, short enough that a leaked URL doesn't live forever.
  const exp = Math.floor(Date.now() / 1000) + 4 * 60 * 60;
  const body = {
    name,
    privacy: "public",
    properties: {
      max_participants: 2,
      enable_recording: "cloud",
      enable_chat: false,
      enable_screenshare: true,
      // Skip Daily's "set up your devices" pre-join screen. With this off,
      // the `?userName=` URL param actually pre-fills the display name
      // instead of being ignored in favour of the prompt.
      enable_prejoin_ui: false,
      exp,
    },
  };
  // Two recording behaviors are configured at the WORKSPACE level in the
  // Daily dashboard, not as per-room properties. Set both in
  // dashboard.daily.co → Developers (or Settings) → Recordings:
  //   1. "Recording layout" → "Audio only" — keeps the MP3 under Whisper's
  //      25 MB cap (lib/whisper.ts enforces this).
  //   2. "Auto-start recording" → ON — recording begins when the second
  //      participant joins, so neither side has to click the record button.
  const res = await dailyFetch("/rooms", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (res.status === 409) {
    // Already exists — fetch and return.
    const existing = await getRoom(name);
    if (existing) return existing;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new DailyError(
      res.status,
      `Daily createRoom ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  const json = (await res.json()) as { name: string; url: string };
  return { name: json.name, url: json.url };
}

export async function getRoom(name: string): Promise<DailyRoom | null> {
  const res = await dailyFetch(`/rooms/${encodeURIComponent(name)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new DailyError(
      res.status,
      `Daily getRoom ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  const json = (await res.json()) as { name: string; url: string };
  return { name: json.name, url: json.url };
}

// Returns the most recent finished recording for the appointment's room.
// Recordings appear asynchronously after a session ends — Daily encodes
// the MP4 and exposes it via this endpoint once ready. Status `finished`
// means the recording can be downloaded; anything else is still processing.
export async function getLatestRecording(
  appointmentId: string,
): Promise<DailyRecording | null> {
  const name = roomNameFor(appointmentId);
  const res = await dailyFetch(
    `/recordings?room_name=${encodeURIComponent(name)}&limit=5`,
  );
  if (!res.ok) {
    const text = await res.text();
    throw new DailyError(
      res.status,
      `Daily getRecording ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  const json = (await res.json()) as {
    data: {
      id: string;
      room_name: string;
      start_ts: number;
      duration: number;
      status: string;
    }[];
  };
  const finished = json.data
    .filter((r) => r.status === "finished")
    .sort((a, b) => b.start_ts - a.start_ts)[0];
  if (!finished) return null;
  return {
    id: finished.id,
    roomName: finished.room_name,
    startTs: finished.start_ts,
    duration: finished.duration,
    status: finished.status,
  };
}

// Mints a short-lived signed download URL for a recording. Used both by the
// transcription pipeline (server-side download → Whisper) and by the
// client-facing replay page (fed into a <video> tag). Daily's access links
// expire ~hours after issue, so we mint per-request rather than caching.
export async function getRecordingAccessUrl(
  recordingId: string,
): Promise<string> {
  const res = await dailyFetch(
    `/recordings/${encodeURIComponent(recordingId)}/access-link`,
  );
  if (!res.ok) {
    const text = await res.text();
    throw new DailyError(
      res.status,
      `Daily access-link ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  const json = (await res.json()) as { download_link: string };
  return json.download_link;
}

function roomNameFor(appointmentId: string): string {
  // Daily room names: lowercase, alphanumeric, hyphens. Strip the `a_`
  // prefix and keep it simple.
  return `tinyfish-${appointmentId.replace(/[^a-zA-Z0-9-]/g, "").toLowerCase()}`;
}
