import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getAppointment } from "@/lib/appointments-store";
import { getArtifact } from "@/lib/session-artifacts-store";
import { listInteractions } from "@/lib/qa-store";
import {
  DailyError,
  getLatestRecording,
  getRecordingAccessUrl,
} from "@/lib/daily";
import { ClientTopBar } from "@/app/client-topbar";
import { QAPanel } from "./qa-panel";
import { SessionAudio } from "./session-audio";
import type { SessionArtifact, TranscriptSegment } from "@/lib/types";

export default async function ClientSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { id } = await params;
  const { t } = await searchParams;
  const appointment = await getAppointment(id);
  if (!appointment) notFound();

  const user = await requireAuth("client", `/sessions/${id}`);
  if (user.clientId !== appointment.clientId) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-xl font-semibold">Not your session</h1>
        <Link
          href="/dashboard"
          className="mt-4 inline-block text-sm underline"
        >
          My dashboard →
        </Link>
      </div>
    );
  }

  const artifact = await getArtifact(id);
  const approved =
    artifact?.reviewStatus === "approved" && artifact.summaryFinal
      ? artifact
      : null;
  const interactions = approved ? await listInteractions(id) : [];

  let audioUrl: string | null = null;
  let audioError: string | null = null;
  if (approved) {
    try {
      const recording = await getLatestRecording(id);
      if (recording) {
        audioUrl = await getRecordingAccessUrl(recording.id);
      } else {
        audioError =
          "The recording isn't available. Daily may have purged it, or this session predates recording.";
      }
    } catch (err) {
      if (err instanceof DailyError) {
        audioError = `Daily.co error: ${err.message}`;
      } else {
        audioError = "Couldn't fetch the recording.";
      }
    }
  }

  const startSeconds = parseStart(t);

  return (
    <>
      <ClientTopBar />
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">
            Session summary
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            With {appointment.providerName} ·{" "}
            {new Date(appointment.startTime).toLocaleString(undefined, {
              weekday: "long",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
        </div>

        {approved ? (
          <>
            <ApprovedSummary artifact={approved} />
            <div className="mt-6 rounded-2xl border border-zinc-200 bg-zinc-50 p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Audio recording
              </div>
              {audioUrl ? (
                <SessionAudio
                  audioUrl={audioUrl}
                  startSeconds={startSeconds}
                />
              ) : (
                <div className="text-sm text-amber-900 dark:text-amber-200">
                  {audioError}
                </div>
              )}
            </div>
            <TranscriptSection artifact={approved} />
            <QAPanel
              appointmentId={id}
              initialInteractions={interactions}
            />
          </>
        ) : (
          <AwaitingReview status={artifact?.reviewStatus ?? null} />
        )}
      </div>
    </>
  );
}

function parseStart(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function AwaitingReview({ status }: { status: string | null }) {
  let message: string;
  if (status === "rejected") {
    message =
      "Your therapist reviewed the draft summary and chose not to share it for this session.";
  } else if (status === "pending-summary-review") {
    message =
      "Your therapist is reviewing the AI-drafted summary. You’ll see it here once they’ve approved it.";
  } else if (status === "pending-transcript-review") {
    message =
      "Your therapist is reviewing the session transcript. The summary will follow.";
  } else {
    message = "No summary available for this session.";
  }
  return (
    <div className="mt-8 rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
      <div className="text-sm text-zinc-600 dark:text-zinc-400">{message}</div>
    </div>
  );
}

function ApprovedSummary({
  artifact,
}: {
  artifact: {
    summaryFinal: {
      summary: string;
      keyPoints: string[];
      actionItems: string[];
      followUps: string[];
    } | null;
    reviewedAt: string | null;
  };
}) {
  const s = artifact.summaryFinal!;
  return (
    <div className="mt-8 space-y-6">
      <section className="rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Summary
        </div>
        <p className="mt-2 text-sm leading-6 text-zinc-800 dark:text-zinc-200">
          {s.summary}
        </p>
      </section>

      <BulletList label="Key points" items={s.keyPoints} />
      <BulletList label="Your action items this week" items={s.actionItems} />
      <BulletList label="To revisit next time" items={s.followUps} />

      <p className="text-xs text-zinc-500">
        Reviewed and approved by your therapist
        {artifact.reviewedAt
          ? ` on ${new Date(artifact.reviewedAt).toLocaleDateString()}`
          : ""}
        .
      </p>
    </div>
  );
}

function BulletList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <ul className="mt-2 space-y-1.5 text-sm text-zinc-800 dark:text-zinc-200">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TranscriptSection({ artifact }: { artifact: SessionArtifact }) {
  const segments: TranscriptSegment[] = artifact.transcriptSegments ?? [];
  const flatText = artifact.transcriptEdited ?? artifact.transcriptRaw ?? "";
  if (segments.length === 0 && flatText.trim().length === 0) return null;

  return (
    <section className="mt-6 rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
      <details>
        <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-zinc-500">
          Transcript
        </summary>
        <div className="mt-4 max-h-96 overflow-y-auto pr-2 text-sm leading-6 text-zinc-800 dark:text-zinc-200">
          {segments.length > 0 ? (
            <ul className="space-y-2">
              {segments.map((seg, i) => {
                const t = Math.floor(seg.start);
                const mm = Math.floor(t / 60);
                const ss = (t % 60).toString().padStart(2, "0");
                return (
                  <li key={i} className="flex items-baseline gap-3">
                    <a
                      href={`?t=${t}`}
                      className="w-12 shrink-0 text-center font-mono text-xs tabular-nums text-accent underline underline-offset-2"
                    >
                      {mm}:{ss}
                    </a>
                    <span className="flex-1">{seg.text}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="whitespace-pre-wrap">{flatText}</p>
          )}
        </div>
      </details>
    </section>
  );
}
