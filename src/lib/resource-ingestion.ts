// Server-only: never import from a "use client" module.
// Ingestion adapter for therapist-uploaded resources. URLs (HTML pages and
// PDFs) are fetched via TinyFish's Fetch API, which renders in a real browser
// and returns clean extracted text. The returned text is then chunked for the
// AI Q&A retrieval path.

import { randomUUID } from "node:crypto";
import type { ResourceChunk } from "./types";
import { env } from "./env";

const FETCH_TIMEOUT_MS = 30_000; // real-browser render can be slow
const MAX_EXTRACT_CHARS = 2_000_000;

export class IngestionError extends Error {}

type TinyFishResult = {
  url: string;
  final_url?: string;
  title?: string;
  description?: string;
  language?: string;
  text: string;
};

type TinyFishError = {
  url: string;
  error: string;
};

type TinyFishResponse = {
  results?: TinyFishResult[];
  errors?: TinyFishError[];
};

export async function fetchUrlText(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new IngestionError("That URL isn't valid.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new IngestionError("Only http(s) URLs are supported.");
  }
  // Fallback path: if TinyFish isn't configured, fetch the page directly
  // and strip HTML with a tag/entity scrubber. Works for most public
  // articles (no JS rendering, no auth). Pages that rely on client-side
  // rendering will return empty/sparse text — set TINYFISH_API_KEY for
  // proper browser-rendered extraction.
  if (!env.tinyfish.apiKey) {
    return fetchUrlTextDirect(parsed.toString());
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(env.tinyfish.fetchUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": env.tinyfish.apiKey,
      },
      body: JSON.stringify({ urls: [url] }),
    });
  } catch (err) {
    throw new IngestionError(
      (err as Error).name === "AbortError"
        ? "The site took too long to respond."
        : "Couldn't reach the TinyFish Fetch API.",
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new IngestionError(
      `TinyFish returned ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}.`,
    );
  }

  let json: TinyFishResponse;
  try {
    json = (await response.json()) as TinyFishResponse;
  } catch {
    throw new IngestionError("TinyFish returned a non-JSON response.");
  }

  const failure = json.errors?.find((e) => e.url === url) ?? json.errors?.[0];
  const result = json.results?.find((r) => r.url === url) ?? json.results?.[0];

  if (!result?.text) {
    throw new IngestionError(
      failure?.error
        ? `TinyFish couldn't extract that URL: ${failure.error}`
        : "TinyFish returned no extracted text for that URL.",
    );
  }

  const text = result.text.length > MAX_EXTRACT_CHARS
    ? result.text.slice(0, MAX_EXTRACT_CHARS)
    : result.text;
  return text.trim();
}

// Direct fetch + naive HTML scrubber. No browser, no JS execution. Good
// enough for static articles and PDF-as-HTML; insufficient for SPAs.
async function fetchUrlTextDirect(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // Identify as a normal browser; some sites 403 unfamiliar UAs.
        "user-agent":
          "Mozilla/5.0 (compatible; TinyFishBot/1.0; +https://tinyfish.local)",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  } catch (err) {
    throw new IngestionError(
      (err as Error).name === "AbortError"
        ? "The site took too long to respond."
        : `Couldn't reach that URL: ${(err as Error).message}`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new IngestionError(`Got ${res.status} fetching that URL.`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("text/html") && !ct.includes("text/plain") && !ct.includes("xml")) {
    throw new IngestionError(
      `Unsupported content-type: ${ct}. Set TINYFISH_API_KEY for richer extraction (PDFs, JS-rendered pages).`,
    );
  }
  const html = await res.text();
  const text = stripHtml(html).slice(0, MAX_EXTRACT_CHARS).trim();
  if (text.length < 50) {
    throw new IngestionError(
      "Couldn't extract meaningful text from that page (likely JS-rendered). Set TINYFISH_API_KEY for browser-based extraction.",
    );
  }
  return text;
}

function stripHtml(html: string): string {
  return html
    // Drop entire <script> and <style> blocks (and their contents).
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    // Drop all remaining tags.
    .replace(/<[^>]+>/g, " ")
    // Decode the handful of entities that show up in body text.
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    // Collapse whitespace runs.
    .replace(/\s+/g, " ");
}

// Simple sentence-based chunker. Real impl uses a tokenizer to target
// ~400 tokens with overlap and stores embeddings alongside each chunk.
const TARGET_CHUNK_CHARS = 1200;
const MIN_CHUNK_CHARS = 200;

export function chunkText(resourceId: string, text: string): ResourceChunk[] {
  const clean = text.trim();
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?])\s+/);
  const chunks: ResourceChunk[] = [];
  let buf = "";
  let index = 0;
  for (const s of sentences) {
    if (buf.length + s.length + 1 > TARGET_CHUNK_CHARS && buf.length >= MIN_CHUNK_CHARS) {
      chunks.push({ id: `chunk_${randomUUID()}`, resourceId, index, text: buf.trim() });
      index += 1;
      buf = "";
    }
    buf += (buf ? " " : "") + s;
  }
  if (buf.trim()) {
    chunks.push({ id: `chunk_${randomUUID()}`, resourceId, index, text: buf.trim() });
  }
  return chunks;
}
