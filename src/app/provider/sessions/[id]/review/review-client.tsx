"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DraftSummary, SessionArtifact } from "@/lib/types";

type Props = {
  appointmentId: string;
  initial: SessionArtifact;
};

export function ReviewClient({ appointmentId, initial }: Props) {
  const router = useRouter();
  const [artifact, setArtifact] = useState<SessionArtifact>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const transcriptValue =
    artifact.transcriptEdited ?? artifact.transcriptRaw;

  async function saveTranscript(value: string) {
    setBusy("transcript");
    setError(null);
    try {
      const res = await fetch(
        `/api/sessions/${appointmentId}/transcript`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ transcript: value }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't save transcript");
      setArtifact(json.artifact);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function generateSummary() {
    setBusy("summary");
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${appointmentId}/summary`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't generate summary");
      setArtifact(json.artifact);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function saveSummary(draft: DraftSummary) {
    setBusy("save-summary");
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${appointmentId}/summary`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ summary: draft }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't save summary");
      setArtifact(json.artifact);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function decide(decision: "approve" | "reject", note?: string) {
    setBusy(decision);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${appointmentId}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, note }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't finalize review");
      setArtifact(json.artifact);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-8 space-y-8">
      <StatusBanner artifact={artifact} />

      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </p>
      )}

      <TranscriptCard
        value={transcriptValue}
        busy={busy === "transcript"}
        onSave={saveTranscript}
      />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={generateSummary}
          disabled={busy === "summary"}
          className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-accent dark:text-primary"
        >
          {busy === "summary"
            ? "Drafting summary…"
            : artifact.summaryDraft
              ? "Regenerate AI summary from transcript"
              : "Send transcript to AI for a draft summary"}
        </button>
      </div>

      {artifact.summaryDraft && (
        <SummaryCard
          draft={artifact.summaryDraft}
          status={artifact.reviewStatus}
          savingSummary={busy === "save-summary"}
          approving={busy === "approve"}
          rejecting={busy === "reject"}
          onSave={saveSummary}
          onApprove={() => decide("approve")}
          onReject={(note) => decide("reject", note)}
        />
      )}
    </div>
  );
}

function StatusBanner({ artifact }: { artifact: SessionArtifact }) {
  const map: Record<SessionArtifact["reviewStatus"], { label: string; body: string; tone: string }> = {
    "pending-transcript-review": {
      label: "Awaiting your review",
      body: "Review and edit the transcript, then send it to the AI for a draft summary.",
      tone: "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200",
    },
    "pending-summary-review": {
      label: "Draft summary ready",
      body: "Edit the summary if needed, then approve to share with the client or reject to discard.",
      tone: "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200",
    },
    approved: {
      label: "Approved",
      body: "The client can now see the summary and ask follow-up questions grounded in it.",
      tone: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200",
    },
    rejected: {
      label: "Rejected",
      body: "Nothing was shared with the client.",
      tone: "bg-zinc-100 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-300",
    },
  };
  const s = map[artifact.reviewStatus];
  return (
    <div className={`rounded-2xl px-5 py-4 text-sm ${s.tone}`}>
      <div className="font-semibold">{s.label}</div>
      <div className="mt-0.5">{s.body}</div>
      {artifact.reviewStatus === "rejected" && artifact.rejectionNote && (
        <div className="mt-2 text-xs opacity-80">
          Reason: {artifact.rejectionNote}
        </div>
      )}
    </div>
  );
}

function TranscriptCard({
  value,
  busy,
  onSave,
}: {
  value: string;
  busy: boolean;
  onSave: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const dirty = draft !== value;
  return (
    <section className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Transcript
        </h2>
        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={!dirty || busy}
          className="text-sm font-medium text-zinc-700 hover:underline disabled:opacity-40 dark:text-zinc-300"
        >
          {busy ? "Saving…" : dirty ? "Save edits" : "No changes"}
        </button>
      </div>
      <textarea
        rows={18}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="mt-3 w-full rounded-xl border border-zinc-300 bg-white p-4 font-mono text-xs leading-6 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-accent dark:border-zinc-700 dark:bg-primary dark:focus:border-accent dark:focus:ring-accent"
      />
    </section>
  );
}

function SummaryCard({
  draft,
  status,
  savingSummary,
  approving,
  rejecting,
  onSave,
  onApprove,
  onReject,
}: {
  draft: DraftSummary;
  status: SessionArtifact["reviewStatus"];
  savingSummary: boolean;
  approving: boolean;
  rejecting: boolean;
  onSave: (d: DraftSummary) => void;
  onApprove: () => void;
  onReject: (note?: string) => void;
}) {
  const [working, setWorking] = useState<DraftSummary>(draft);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const dirty =
    working.summary !== draft.summary ||
    !arraysEqual(working.keyPoints, draft.keyPoints) ||
    !arraysEqual(working.actionItems, draft.actionItems) ||
    !arraysEqual(working.followUps, draft.followUps);

  const isApproved = status === "approved";
  const approveLabel = isApproved
    ? approving
      ? "Re-approving…"
      : "Re-approve with edits"
    : approving
      ? "Approving…"
      : "Approve and share with client";

  return (
    <section className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          {isApproved ? "Approved summary (editable)" : "AI draft summary"}
        </h2>
        <button
          type="button"
          onClick={() => onSave(working)}
          disabled={!dirty || savingSummary}
          className="text-sm font-medium text-zinc-700 hover:underline disabled:opacity-40 dark:text-zinc-300"
        >
          {savingSummary ? "Saving…" : dirty ? "Save edits" : "No changes"}
        </button>
      </div>

      <div className="mt-4 space-y-5">
        <Field
          label="Summary"
          value={working.summary}
          onChange={(v) => setWorking({ ...working, summary: v })}
          rows={4}
        />
        <ListField
          label="Key points"
          items={working.keyPoints}
          onChange={(items) => setWorking({ ...working, keyPoints: items })}
        />
        <ListField
          label="Action items"
          items={working.actionItems}
          onChange={(items) => setWorking({ ...working, actionItems: items })}
        />
        <ListField
          label="Follow-ups"
          items={working.followUps}
          onChange={(items) => setWorking({ ...working, followUps: items })}
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-5 dark:border-zinc-800">
        {rejectOpen ? (
          <div className="flex w-full flex-col gap-3">
            <label className="block space-y-2">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Why are you rejecting this summary? (optional; not shared with
                client)
              </span>
              <input
                type="text"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-accent dark:border-zinc-700 dark:bg-primary dark:focus:border-accent dark:focus:ring-accent"
              />
            </label>
            <div className="flex gap-2 self-end">
              <button
                type="button"
                onClick={() => setRejectOpen(false)}
                className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => onReject(rejectNote || undefined)}
                disabled={rejecting}
                className="rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {rejecting ? "Rejecting…" : "Confirm rejection"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setRejectOpen(true)}
              className="text-sm font-medium text-red-700 hover:underline dark:text-red-400"
            >
              {status === "rejected" ? "Re-reject" : "Reject"}
            </button>
            <button
              type="button"
              onClick={onApprove}
              disabled={approving || dirty}
              title={dirty ? "Save your edits first, then approve." : undefined}
              className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-accent dark:text-primary"
            >
              {approveLabel}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  rows,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm leading-6 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-accent dark:border-zinc-700 dark:bg-primary dark:focus:border-accent dark:focus:ring-accent"
      />
    </label>
  );
}

function ListField({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <input
              type="text"
              value={item}
              onChange={(e) => {
                const next = items.slice();
                next[i] = e.target.value;
                onChange(next);
              }}
              className="flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-accent dark:border-zinc-700 dark:bg-primary dark:focus:border-accent dark:focus:ring-accent"
            />
            <button
              type="button"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="text-sm text-zinc-500 hover:text-red-600"
              aria-label="Remove"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => onChange([...items, ""])}
        className="text-xs font-medium text-zinc-700 hover:underline dark:text-zinc-300"
      >
        + Add
      </button>
    </div>
  );
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}
