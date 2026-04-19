import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth-api";
import { getResource, removeResource } from "@/lib/resources-store";
import { recordAudit } from "@/lib/audit-log";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireAuthApi("provider");
  if ("error" in auth) return auth.error;

  const resource = await getResource(id);
  if (!resource) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (resource.providerId !== auth.user.providerId) {
    return NextResponse.json({ error: "Not your resource" }, { status: 403 });
  }
  await removeResource(id);
  recordAudit({
    actorId: auth.user.providerId ?? null,
    actorRole: "provider",
    action: "resource.deleted",
    resource: "resource",
    resourceId: id,
    metadata: { title: resource.title },
  });
  return NextResponse.json({ ok: true });
}
