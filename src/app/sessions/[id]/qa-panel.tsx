"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { QAInteraction } from "@/lib/types";

type Props = {
  appointmentId: string;
  initialInteractions: QAInteraction[];
};

// Scaffold voice I/O: uses the browser's Web Speech API (input) and
// SpeechSynthesis (output). Production swaps in AWS Transcribe streaming
// for input and ElevenLabs TTS for output; the UI contract stays the same.

type Recognition = {
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  interimResults: boolean;
  lang: string;
  continuous: boolean;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  }
}

export function QAPanel({ appointmentId, initialInteractions }: Props) {
  const [interactions, setInteractions] =
    useState<QAInteraction[]>(initialInteractions);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [ttsOn, setTtsOn] = useState(true);

  const recognitionRef = useRef<Recognition | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      stopAudio();
    };
  }, [stopAudio]);

  const voiceSupported =
    typeof window !== "undefined" &&
    Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  // ElevenLabs TTS routed through the server; the panel always renders
  // the play/stop control because we don't depend on a browser API.
  const ttsSupported = true;

  function startListening() {
    const Ctor =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e: unknown) => {
      const evt = e as {
        results: { 0: { transcript: string }; isFinal: boolean }[];
      };
      const parts: string[] = [];
      for (let i = 0; i < evt.results.length; i++) {
        parts.push(evt.results[i][0].transcript);
      }
      setQuestion(parts.join(" "));
    };
    rec.onerror = () => {
      setError("Voice input isn't available right now.");
      setListening(false);
    };
    rec.onend = () => setListening(false);
    rec.start();
    recognitionRef.current = rec;
    setListening(true);
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  async function speak(text: string, id: string) {
    stopAudio();
    setSpeaking(id);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        setSpeaking(null);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setSpeaking(null);
        if (audioUrlRef.current) {
          URL.revokeObjectURL(audioUrlRef.current);
          audioUrlRef.current = null;
        }
      };
      audio.onerror = () => setSpeaking(null);
      await audio.play();
    } catch {
      setSpeaking(null);
    }
  }

  function stopSpeaking() {
    stopAudio();
    setSpeaking(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (listening) stopListening();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${appointmentId}/qa`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Couldn't answer right now.");
        return;
      }
      const interaction = json.interaction as QAInteraction;
      setInteractions([...interactions, interaction]);
      setQuestion("");
      if (ttsOn) speak(interaction.answer, interaction.id);
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5 rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Ask about your session
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Answers come only from the approved summary, the session transcript,
          and resources your therapist has shared.
        </p>
      </div>

      {interactions.length > 0 && (
        <ul className="space-y-4">
          {interactions.map((i) => (
            <li
              key={i.id}
              className="space-y-2 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900"
            >
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                You asked
              </div>
              <div className="text-sm text-zinc-900 dark:text-zinc-100">
                {i.question}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Answer
                </div>
                {ttsSupported && (
                  <button
                    type="button"
                    onClick={() =>
                      speaking === i.id ? stopSpeaking() : speak(i.answer, i.id)
                    }
                    className="text-xs font-medium text-zinc-600 hover:underline dark:text-zinc-400"
                  >
                    {speaking === i.id ? "Stop" : "Read aloud"}
                  </button>
                )}
              </div>
              <div className="whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200">
                {i.answer}
              </div>
              {i.citations.length > 0 && (
                <ul className="mt-2 space-y-1 border-l-2 border-accent bg-accent-soft px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300">
                  {i.citations.map((c, idx) => (
                    <li key={idx} className="truncate">
                      <span className="font-medium capitalize text-primary dark:text-zinc-50">
                        {c.source}
                      </span>
                      {c.replayUrl && c.humanTimestamp && (
                        <>
                          {" "}
                          <a
                            href={c.replayUrl}
                            className="font-medium text-accent underline underline-offset-2 hover:text-primary dark:hover:text-zinc-50"
                          >
                            ▸ listen at {c.humanTimestamp}
                          </a>
                        </>
                      )}
                      : &ldquo;{c.quote}&rdquo;
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="space-y-3">
        <div className="relative">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            placeholder="What did we decide I should try this week?"
            className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 pr-14 text-sm leading-6 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-accent dark:border-zinc-700 dark:bg-primary dark:focus:border-accent dark:focus:ring-accent"
          />
          {voiceSupported && (
            <button
              type="button"
              onClick={listening ? stopListening : startListening}
              aria-label={listening ? "Stop voice input" : "Start voice input"}
              title={listening ? "Stop voice input" : "Speak your question"}
              className={`absolute right-3 top-3 rounded-full px-3 py-1 text-xs font-medium ${
                listening
                  ? "bg-red-600 text-white"
                  : "border border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              {listening ? "● Listening" : "🎤"}
            </button>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={ttsOn}
              onChange={(e) => setTtsOn(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary dark:accent-accent"
            />
            Read answers aloud
          </label>
          <button
            type="submit"
            disabled={busy || question.trim().length < 3}
            className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-accent dark:text-primary"
          >
            {busy ? "Thinking…" : "Ask"}
          </button>
        </div>
      </form>

      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
