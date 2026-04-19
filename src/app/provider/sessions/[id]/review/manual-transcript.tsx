"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Manual fallback for when Daily auto-record didn't capture the call —
// the therapist can either paste a transcript verbatim or upload an audio
// file (we run it through ElevenLabs Scribe). Either path produces a
// SessionArtifact identical in shape to the auto-pipeline output, so the
// rest of the review flow (summary generation, approve, client view)
// works the same.

type Mode = "audio" | "text";

export function ManualTranscriptForm({
  appointmentId,
}: {
  appointmentId: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("audio");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let res: Response;
      if (mode === "audio") {
        if (!file) {
          setError("Choose an audio file first.");
          return;
        }
        const form = new FormData();
        form.append("audio", file);
        res = await fetch(`/api/sessions/${appointmentId}/transcribe`, {
          method: "POST",
          body: form,
        });
      } else {
        if (text.trim().length < 20) {
          setError("Paste a longer transcript (at least a couple of sentences).");
          return;
        }
        res = await fetch(`/api/sessions/${appointmentId}/transcribe`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ transcriptText: text }),
        });
      }
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Couldn't save the transcript.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="mt-6 rounded-2xl border border-zinc-200 dark:border-zinc-800">
      <summary className="cursor-pointer select-none px-5 py-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Or provide the transcript yourself →
      </summary>
      <form onSubmit={submit} className="space-y-4 px-5 pb-5">
        <div className="flex gap-2">
          {(["audio", "text"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={`rounded-full border px-4 py-1.5 text-xs font-medium transition-colors ${
                mode === m
                  ? "border-primary bg-primary text-white dark:border-accent dark:bg-accent dark:text-primary"
                  : "border-zinc-300 dark:border-zinc-700"
              }`}
            >
              {m === "audio" ? "Upload audio" : "Paste transcript"}
            </button>
          ))}
        </div>

        {mode === "audio" ? (
          <label className="block space-y-2">
            <span className="text-sm font-medium">Audio file</span>
            <input
              type="file"
              accept="audio/*,video/mp4,video/webm,.m4a,.mp3,.wav"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-zinc-700 file:mr-4 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-white dark:text-zinc-300 dark:file:bg-accent dark:file:text-primary"
            />
            <span className="block text-xs text-zinc-500">
              We&apos;ll run it through ElevenLabs Scribe with word-level
              timestamps. Audio formats: MP3, M4A, WAV, MP4 (audio track).
            </span>
          </label>
        ) : (
          <label className="block space-y-2">
            <span className="text-sm font-medium">Transcript</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              placeholder="Paste the session transcript here…"
              className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm leading-6 shadow-sm focus:border-primary focus:outline-none dark:border-zinc-700 dark:bg-primary"
            />
            <span className="block text-xs text-zinc-500">
              Pasted transcripts have no timestamps — replay deep-links from
              the client&apos;s Q&amp;A agent won&apos;t work for this
              session, but every other feature (review, approve, citations)
              does.
            </span>
          </label>
        )}

        {error && (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={busy}
            className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-accent dark:text-primary"
          >
            {busy
              ? mode === "audio"
                ? "Transcribing…"
                : "Saving…"
              : mode === "audio"
                ? "Transcribe upload"
                : "Save transcript"}
          </button>
        </div>
      </form>
    </details>
  );
}
