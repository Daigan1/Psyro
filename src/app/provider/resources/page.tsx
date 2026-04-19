import { requireAuth } from "@/lib/auth";
import { listAppointmentsForProvider } from "@/lib/appointments-store";
import { listResourcesForProvider } from "@/lib/resources-store";
import { getIntakeProgress } from "@/lib/intake-store";
import { getUser } from "@/lib/users-store";
import { ResourcesClient } from "./resources-client";

export default async function ProviderResourcesPage() {
  const user = await requireAuth("provider", "/provider/resources");
  const providerId = user.providerId!;

  const [list, appts] = await Promise.all([
    listResourcesForProvider(providerId),
    listAppointmentsForProvider(providerId),
  ]);

  // Distinct clients this therapist has ever booked with — used both for
  // the targeting picker on new resources and the filter dropdown above
  // the existing-resources list.
  const clientIds = Array.from(new Set(appts.map((a) => a.clientId)));
  const [intakes, users] = await Promise.all([
    Promise.all(clientIds.map((id) => getIntakeProgress(id))),
    Promise.all(clientIds.map((id) => getUser(id))),
  ]);
  const clients = clientIds.map((id, i) => {
    const intakeName = intakes[i]?.data.personalInfo?.name?.trim();
    const u = users[i];
    const fallback = u?.email
      ? friendlyNameFromEmail(u.email)
      : `Client ${id.slice(0, 10)}…`;
    return { id, name: intakeName || fallback };
  });

  const resources = list.map((r) => ({
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
  }));

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-12">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Resources</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Link articles or paste content you want to show up as grounded
          context when clients ask follow-up questions. Scope each resource
          to specific clients, or leave the picker empty to share with all
          of them.
        </p>
      </div>
      <ResourcesClient initial={resources} clients={clients} />
    </div>
  );
}

function friendlyNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "Client";
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ") || "Client"
  );
}
