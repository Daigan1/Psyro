import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAuthApi } from "@/lib/auth-api";
import {
  chunkText,
  fetchUrlText,
  IngestionError,
} from "@/lib/resource-ingestion";
import {
  listResourcesForProvider,
  putResource,
} from "@/lib/resources-store";
import type { ResourceKind, TherapistResource } from "@/lib/types";
import { recordAudit } from "@/lib/audit-log";

export async function GET() {
  const auth = await requireAuthApi("provider");
  if ("error" in auth) return auth.error;

  const list = await listResourcesForProvider(auth.user.providerId!);
  const resources = list.map(publicShape);
  return NextResponse.json({ resources });
}

type CreateBody =
  | { kind: "url"; title: string; url: string; clientIds?: string[] }
  | { kind: "text"; title: string; text: string; clientIds?: string[] };

export async function POST(request: Request) {
  const auth = await requireAuthApi("provider");
  if ("error" in auth) return auth.error;
  const user = auth.user;

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.title || body.title.trim().length === 0) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }
  if (body.kind !== "url" && body.kind !== "text") {
    return NextResponse.json({ error: "Unknown kind." }, { status: 400 });
  }

  const clientIds = Array.isArray(body.clientIds)
    ? body.clientIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];

  const id = `res_${randomUUID()}`;
  const base: Omit<TherapistResource, "extractedText" | "chunks" | "status" | "failureReason"> = {
    id,
    tenantId: user.tenantId!,
    providerId: user.providerId!,
    kind: body.kind as ResourceKind,
    title: body.title.trim(),
    source: body.kind === "url" ? body.url : null,
    createdAt: new Date().toISOString(),
    clientIds,
  };

  let extractedText: string;
  try {
    if (body.kind === "url") {
      extractedText = await fetchUrlText(body.url);
      if (extractedText.length < 50) {
        throw new IngestionError("Couldn't extract enough text from that page.");
      }
    } else {
      extractedText = body.text.trim();
      if (extractedText.length < 20) {
        return NextResponse.json(
          { error: "Paste a bit more text — at least a couple of sentences." },
          { status: 400 },
        );
      }
    }
  } catch (err) {
    if (err instanceof IngestionError) {
      const failed: TherapistResource = {
        ...base,
        status: "failed",
        failureReason: err.message,
        extractedText: "",
        chunks: [],
      };
      await putResource(failed);
      return NextResponse.json({ resource: publicShape(failed) }, { status: 202 });
    }
    throw err;
  }

  const chunks = chunkText(id, extractedText);
  const resource: TherapistResource = {
    ...base,
    status: "ingested",
    failureReason: null,
    extractedText,
    chunks,
  };
  await putResource(resource);
  recordAudit({
    tenantId: user.tenantId ?? null,
    actorId: user.providerId ?? null,
    actorRole: "provider",
    action: "resource.created",
    resource: "resource",
    resourceId: id,
    metadata: { kind: resource.kind, title: resource.title, chunks: chunks.length },
  });
  return NextResponse.json({ resource: publicShape(resource) });
}

function publicShape(r: TherapistResource) {
  // Trim extractedText in list views to avoid shipping the whole corpus.
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    source: r.source,
    status: r.status,
    failureReason: r.failureReason,
    chunkCount: r.chunks.length,
    createdAt: r.createdAt,
    excerpt: r.extractedText.slice(0, 240),
    clientIds: r.clientIds ?? [],
  };
}
