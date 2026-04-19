import { redirect } from "next/navigation";

// The separate replay screen was folded into the session page so audio,
// summary, transcript, and Q&A all live together. Kept as a redirect so
// any historical `/sessions/<id>/replay?t=N` citation links still work.
export default async function LegacyReplayRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { id } = await params;
  const { t } = await searchParams;
  const qs = t ? `?t=${encodeURIComponent(t)}` : "";
  redirect(`/sessions/${id}${qs}`);
}
