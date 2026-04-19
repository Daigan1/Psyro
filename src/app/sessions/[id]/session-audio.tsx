"use client";

import { useEffect, useRef } from "react";

type Props = {
  // Daily recording URL. With recording_layout="audio-only" this is an MP3.
  audioUrl: string;
  startSeconds: number;
};

export function SessionAudio({ audioUrl, startSeconds }: Props) {
  const ref = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (startSeconds <= 0) return;
    function onMeta() {
      if (!el) return;
      el.currentTime = startSeconds;
      el.play().catch(() => {});
    }
    el.addEventListener("loadedmetadata", onMeta);
    if (el.readyState >= 1) onMeta();
    return () => el.removeEventListener("loadedmetadata", onMeta);
  }, [startSeconds]);

  return (
    <audio
      ref={ref}
      src={audioUrl}
      controls
      preload="metadata"
      className="w-full"
    />
  );
}
