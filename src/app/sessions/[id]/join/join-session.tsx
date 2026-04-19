"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ParticipantRole, SessionState } from "@/lib/types";

// Recording is driven by Daily's built-in record button in the prebuilt
// iframe (and/or the workspace-level auto-start setting). After the call
// ends, /api/sessions/[id]/transcribe pulls the latest Daily recording
// and runs it through ElevenLabs Scribe. If no recording was made, the
// therapist can paste a transcript or upload audio from the review page.

type Props = {
  appointmentId: string;
  providerName: string;
  startTime: string;
  role: ParticipantRole;
  initialSession: SessionState;
  // Where to go after ending or refusing.
  returnHref: string;
  // Where to go after the *provider* ends a completed session — should be
  // the review page so the therapist can review the AI-drafted notes.
  reviewHref?: string;
  // Where to go when the *client* clicks "Leave" without ending the call.
  leaveHref?: string;
  // The name passed into Daily as `?userName=` so neither side has to
  // type it on entry.
  displayName: string;
  // Copy customization.
  counterpartyLabel: string;
  consentText: string;
};

export function JoinSession(props: Props) {
  const router = useRouter();
  const [session, setSession] = useState<SessionState>(props.initialSession);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inMeeting = Boolean(session.meetingId) && !session.endedAt;
  const waiting =
    !inMeeting &&
    Boolean(session.consent[props.role]) &&
    !session.refused &&
    !session.endedAt;

  // Poll while we're waiting for the other party to consent.
  useEffect(() => {
    if (!waiting) return;
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/sessions/${props.appointmentId}/state`);
        if (!res.ok) return;
        const json = await res.json();
        setSession(json.session as SessionState);
      } catch {
        // ignore
      }
    }, 3000);
    return () => clearInterval(iv);
  }, [waiting, props.appointmentId]);

  async function consent(action: "consent" | "refuse") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/sessions/${props.appointmentId}/consent`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: props.role, action }),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Couldn't record consent.");
        return;
      }
      setSession(json.session as SessionState);
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  if (session.refused) {
    return (
      <EndedView
        title="Session cancelled"
        message={`${label(session.refused.by)} didn't consent to recording, so this session can't continue.`}
        returnHref={props.returnHref}
      />
    );
  }

  if (session.endedAt) {
    return (
      <EndedView
        title="Session ended"
        message={
          session.endReason === "tech-failure"
            ? "The session ended because of a technical issue."
            : "This session is complete."
        }
        returnHref={props.returnHref}
      />
    );
  }

  if (inMeeting) {
    return (
      <MeetingView
        appointmentId={props.appointmentId}
        role={props.role}
        session={session}
        providerName={props.providerName}
        returnHref={props.returnHref}
        reviewHref={props.reviewHref}
        leaveHref={props.leaveHref ?? props.returnHref}
        displayName={props.displayName}
        onEnd={(updated) => setSession(updated)}
        counterpartyLabel={props.counterpartyLabel}
      />
    );
  }

  if (waiting) {
    return (
      <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-zinc-200 p-8 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <Spinner />
          <h2 className="text-lg font-semibold">
            Waiting for {props.counterpartyLabel} to connect…
          </h2>
        </div>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          As soon as they connect, the session will start automatically.
        </p>
        <button
          type="button"
          onClick={() => router.push(props.returnHref)}
          className="mt-6 text-sm font-medium text-zinc-700 hover:underline dark:text-zinc-300"
        >
          Go back
        </button>
        {error && (
          <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-zinc-200 p-8 dark:border-zinc-800">
      <h2 className="text-lg font-semibold">Recording consent</h2>
      <p className="mt-3 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
        {props.consentText}
      </p>
      <ul className="mt-4 space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
        <li>• The session audio will be recorded and transcribed.</li>
        <li>• Only the therapist sees the raw transcript.</li>
        <li>• No AI-generated summary is shared without therapist approval.</li>
        <li>• You can decline below, or leave the call anytime once it starts.</li>
      </ul>
      {error && (
        <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </p>
      )}
      <div className="mt-8 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => consent("refuse")}
          disabled={busy}
          className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
        >
          I don&apos;t consent
        </button>
        <button
          type="button"
          onClick={() => consent("consent")}
          disabled={busy}
          className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-accent dark:text-primary"
        >
          {busy ? "Recording consent…" : "I consent and join"}
        </button>
      </div>
    </div>
  );
}

function MeetingView({
  appointmentId,
  role,
  session,
  providerName,
  returnHref,
  reviewHref,
  leaveHref,
  displayName,
  onEnd,
  counterpartyLabel,
}: {
  appointmentId: string;
  role: ParticipantRole;
  session: SessionState;
  providerName: string;
  returnHref: string;
  reviewHref?: string;
  leaveHref: string;
  displayName: string;
  onEnd: (session: SessionState) => void;
  counterpartyLabel: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Poll session state every 5s so the "Waiting…" line flips to "In
  // session…" when the other side actually joins, and so a client gets
  // bounced out if the therapist ends the call from their side.
  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/sessions/${appointmentId}/state`);
        if (!res.ok) return;
        const json = (await res.json()) as { session: SessionState };
        onEnd(json.session);
        if (json.session.endedAt && role === "client") {
          // Therapist ended the call — kick the client back to dashboard.
          router.push(leaveHref);
        }
      } catch {
        // ignore
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [appointmentId, role, leaveHref, onEnd, router]);

  const otherRole: ParticipantRole =
    role === "client" ? "provider" : "client";
  const otherJoined = Boolean(session.joined[otherRole]);

  // Append `userName` to the Daily prebuilt iframe URL so neither side
  // has to type their name on entry.
  const iframeSrc = session.meetingUrl
    ? appendQuery(session.meetingUrl, { userName: displayName })
    : null;

  async function end(reason: "completed" | "tech-failure") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${appointmentId}/end`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role, reason }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Couldn't end session.");
        return;
      }
      onEnd(json.session as SessionState);
      // Provider goes straight to the review page so they can review the
      // AI-drafted transcript and notes from the call. Client just goes
      // back to dashboard.
      const next =
        role === "provider" && reason === "completed" && reviewHref
          ? reviewHref
          : returnHref;
      router.push(next);
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-10 max-w-3xl space-y-4">
      {/* Controls bar lives ABOVE the iframe so the End / Leave button is
          always visible without scrolling past 600px of video. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="text-xs text-zinc-600 dark:text-zinc-400">
          {otherJoined
            ? `In session with ${role === "client" ? providerName : counterpartyLabel}.`
            : `Waiting for ${counterpartyLabel} to join…`}
        </div>
        {role === "provider" ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => end("tech-failure")}
              disabled={busy}
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-40 dark:border-zinc-700"
            >
              Tech issue
            </button>
            <button
              type="button"
              onClick={() => end("completed")}
              disabled={busy}
              className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-accent dark:text-primary"
            >
              {busy ? "Ending…" : "End session"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => router.push(leaveHref)}
            className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium dark:border-zinc-700"
          >
            Leave call
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-900 dark:border-zinc-800">
        {iframeSrc ? (
          // Daily.co prebuilt iframe — handles device permissions, audio,
          // video, screenshare, and the record button. Use Daily's record
          // button (or the workspace auto-start setting) to capture audio;
          // we transcribe whatever recording lands after the call ends.
          <iframe
            title="Therapy session video"
            src={iframeSrc}
            allow="camera; microphone; fullscreen; speaker; display-capture; autoplay"
            className="h-[600px] w-full border-0"
          />
        ) : (
          <div className="flex h-[600px] flex-col items-center justify-center gap-3 p-6 text-center text-zinc-200">
            <Spinner />
            <div className="text-sm text-zinc-400">
              Connecting to the video room…
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-zinc-500">
        {role === "provider"
          ? "Use the record button in the call (bottom-right of the video) to capture audio. After ending, you'll review the transcript on the next page."
          : "You can leave at any time and rejoin from your dashboard. Only your therapist can end the session."}
      </p>

      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

function appendQuery(
  url: string,
  params: Record<string, string>,
): string {
  try {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) {
      if (v) u.searchParams.set(k, v);
    }
    return u.toString();
  } catch {
    return url;
  }
}

function EndedView({
  title,
  message,
  returnHref,
}: {
  title: string;
  message: string;
  returnHref: string;
}) {
  return (
    <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-zinc-200 p-8 dark:border-zinc-800">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {message}
      </p>
      <Link
        href={returnHref}
        className="mt-6 inline-block rounded-full bg-primary px-4 py-2 text-sm font-medium text-white dark:bg-accent dark:text-primary"
      >
        Back to dashboard
      </Link>
    </div>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" />
  );
}

function label(role: ParticipantRole): string {
  return role === "client" ? "The client" : "The therapist";
}

