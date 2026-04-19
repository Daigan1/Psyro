"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type PublicResource = {
  id: string;
  kind: "url" | "text";
  title: string;
  source: string | null;
  status: "ingested" | "pending" | "failed";
  failureReason: string | null;
  chunkCount: number;
  createdAt: string;
  excerpt: string;
  clientIds: string[];
};

type ClientOption = { id: string; name: string };

export function ResourcesClient({
  initial,
  clients,
}: {
  initial: PublicResource[];
  clients: ClientOption[];
}) {
  const router = useRouter();
  const [resources, setResources] = useState<PublicResource[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [filterClientId, setFilterClientId] = useState<string>("");

  const nameFor = useMemo(() => {
    const m = new Map(clients.map((c) => [c.id, c.name]));
    return (id: string) => m.get(id) ?? `Client ${id.slice(0, 10)}…`;
  }, [clients]);

  const visible = useMemo(() => {
    if (!filterClientId) return resources;
    if (filterClientId === "__shared__") {
      // "Shared with everyone" = empty clientIds.
      return resources.filter((r) => r.clientIds.length === 0);
    }
    return resources.filter(
      (r) => r.clientIds.length === 0 || r.clientIds.includes(filterClientId),
    );
  }, [resources, filterClientId]);

  async function create(body: {
    kind: "url" | "text";
    title: string;
    url?: string;
    text?: string;
    clientIds: string[];
  }) {
    setError(null);
    const res = await fetch("/api/resources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Couldn't add resource.");
      return { ok: false };
    }
    setResources([json.resource, ...resources]);
    router.refresh();
    return { ok: true };
  }

  async function remove(id: string) {
    setError(null);
    const res = await fetch(`/api/resources/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json();
      setError(json.error ?? "Couldn't remove.");
      return;
    }
    setResources(resources.filter((r) => r.id !== id));
    router.refresh();
  }

  return (
    <div className="mt-10 space-y-10">
      <AddResourceForm clients={clients} onSubmit={create} />
      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </p>
      )}
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Indexed ({visible.length}
            {filterClientId ? ` of ${resources.length}` : ""})
          </h2>
          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <span>View as</span>
            <select
              value={filterClientId}
              onChange={(e) => setFilterClientId(e.target.value)}
              className="rounded-xl border border-zinc-300 bg-white px-3 py-1.5 text-xs dark:border-zinc-700 dark:bg-primary"
            >
              <option value="">All resources</option>
              <option value="__shared__">Shared with everyone</option>
              {clients.length > 0 && (
                <optgroup label="Visible to this client">
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
        </div>
        {visible.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            {resources.length === 0
              ? "Nothing indexed yet."
              : "No resources match this filter."}
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {visible.map((r) => (
              <ResourceCard
                key={r.id}
                resource={r}
                nameFor={nameFor}
                onRemove={remove}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AddResourceForm({
  clients,
  onSubmit,
}: {
  clients: ClientOption[];
  onSubmit: (body: {
    kind: "url" | "text";
    title: string;
    url?: string;
    text?: string;
    clientIds: string[];
  }) => Promise<{ ok: boolean }>;
}) {
  const [kind, setKind] = useState<"url" | "text">("url");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [clientIds, setClientIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body =
      kind === "url"
        ? { kind: "url" as const, title, url, clientIds }
        : { kind: "text" as const, title, text, clientIds };
    const res = await onSubmit(body);
    setBusy(false);
    if (res.ok) {
      setTitle("");
      setUrl("");
      setText("");
      setClientIds([]);
    }
  }

  function toggleClient(id: string) {
    setClientIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const disabled =
    busy ||
    title.trim().length === 0 ||
    (kind === "url" ? url.trim().length === 0 : text.trim().length < 20);

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800"
    >
      <div className="flex gap-2">
        {(["url", "text"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded-full border px-4 py-1.5 text-xs font-medium transition-colors ${
              kind === k
                ? "border-primary bg-primary text-white dark:border-accent dark:bg-accent dark:text-primary"
                : "border-zinc-300 dark:border-zinc-700"
            }`}
          >
            {k === "url" ? "Link a URL" : "Paste text"}
          </button>
        ))}
      </div>

      <label className="block space-y-2">
        <span className="text-sm font-medium">Title</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={kind === "url" ? "e.g., APA grounding techniques" : "e.g., Homework for this week"}
          className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-accent dark:border-zinc-700 dark:bg-primary dark:focus:border-accent dark:focus:ring-accent"
        />
      </label>

      {kind === "url" ? (
        <label className="block space-y-2">
          <span className="text-sm font-medium">URL</span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-accent dark:border-zinc-700 dark:bg-primary dark:focus:border-accent dark:focus:ring-accent"
          />
          <span className="block text-xs text-zinc-500">
            The page will be fetched, HTML stripped, and chunked for retrieval.
          </span>
        </label>
      ) : (
        <label className="block space-y-2">
          <span className="text-sm font-medium">Text</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder="Paste the content you want indexed. A couple of paragraphs is ideal."
            className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm leading-6 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-accent dark:border-zinc-700 dark:bg-primary dark:focus:border-accent dark:focus:ring-accent"
          />
        </label>
      )}

      <div className="space-y-2">
        <span className="text-sm font-medium">Visible to</span>
        {clients.length === 0 ? (
          <p className="text-xs text-zinc-500">
            You don&apos;t have any clients yet. New resources will be visible
            to whoever you book in the future.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {clients.map((c) => {
                const on = clientIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleClient(c.id)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      on
                        ? "bg-primary text-white dark:bg-accent dark:text-primary"
                        : "border border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                    }`}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-zinc-500">
              {clientIds.length === 0
                ? "Visible to all of your clients."
                : `Scoped to ${clientIds.length} client${clientIds.length === 1 ? "" : "s"}.`}
            </p>
          </>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={disabled}
          className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-accent dark:text-primary"
        >
          {busy ? "Ingesting…" : "Add resource"}
        </button>
      </div>
    </form>
  );
}

function ResourceCard({
  resource,
  nameFor,
  onRemove,
}: {
  resource: PublicResource;
  nameFor: (id: string) => string;
  onRemove: (id: string) => void;
}) {
  const tone =
    resource.status === "ingested"
      ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
      : resource.status === "failed"
        ? "bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300"
        : "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300";
  return (
    <li className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{resource.title}</h3>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
              {resource.status === "ingested"
                ? `${resource.chunkCount} chunks`
                : resource.status}
            </span>
            <span className="text-xs text-zinc-500">{resource.kind}</span>
          </div>
          {resource.source && (
            <a
              href={resource.source}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block truncate text-xs text-zinc-500 underline"
            >
              {resource.source}
            </a>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            {resource.clientIds.length === 0 ? (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                All clients
              </span>
            ) : (
              resource.clientIds.map((id) => (
                <span
                  key={id}
                  className="rounded-full bg-accent-soft px-2 py-0.5 text-primary dark:bg-zinc-800 dark:text-zinc-200"
                >
                  {nameFor(id)}
                </span>
              ))
            )}
          </div>
          {resource.status === "failed" ? (
            <p className="mt-2 text-sm text-red-700 dark:text-red-400">
              {resource.failureReason}
            </p>
          ) : (
            <p className="mt-2 line-clamp-3 text-sm text-zinc-700 dark:text-zinc-300">
              {resource.excerpt}…
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirm(`Remove "${resource.title}"?`)) onRemove(resource.id);
          }}
          className="text-sm text-zinc-500 hover:text-red-600"
        >
          Remove
        </button>
      </div>
    </li>
  );
}
