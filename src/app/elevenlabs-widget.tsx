"use client";

import Script from "next/script";
import { useEffect, useState } from "react";

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "elevenlabs-convai": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          "agent-id"?: string;
          "signed-url"?: string;
          "dynamic-variables"?: string;
        },
        HTMLElement
      >;
    }
  }
}

type Ready = {
  kind: "ready";
  signedUrl: string;
  dynamicVariables: string;
};
type State = { kind: "loading" } | { kind: "off" } | Ready;

export function ElevenLabsWidget() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/eleven/signed-url", {
          method: "POST",
          signal: ctrl.signal,
        });
        if (!res.ok) {
          // 401 = signed-out visitor (expected, render nothing).
          // Anything else is a real misconfig the dev should see.
          if (res.status !== 401) {
            const body = await res.text().catch(() => "");
            console.warn(
              `[ElevenLabsWidget] signed-url ${res.status}: ${body.slice(0, 300)}`,
            );
          }
          setState({ kind: "off" });
          return;
        }
        const data = (await res.json()) as {
          signedUrl?: string;
          dynamicVariables?: Record<string, string>;
        };
        if (!data.signedUrl || !data.dynamicVariables) {
          console.warn(
            "[ElevenLabsWidget] signed-url 200 but missing fields:",
            data,
          );
          setState({ kind: "off" });
          return;
        }
        setState({
          kind: "ready",
          signedUrl: data.signedUrl,
          dynamicVariables: JSON.stringify(data.dynamicVariables),
        });
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.warn(
            "[ElevenLabsWidget] failed to fetch signed-url:",
            (err as Error).message,
          );
        }
        setState({ kind: "off" });
      }
    })();
    return () => ctrl.abort();
  }, []);

  if (state.kind !== "ready") return null;

  return (
    <>
      <elevenlabs-convai
        signed-url={state.signedUrl}
        dynamic-variables={state.dynamicVariables}
      />
      <Script
        src="https://unpkg.com/@elevenlabs/convai-widget-embed"
        strategy="lazyOnload"
        async
      />
    </>
  );
}
