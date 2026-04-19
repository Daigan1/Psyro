import { requireAuth } from "@/lib/auth";
import { getProvider } from "@/lib/providers-store";
import { AvailabilityCalendar } from "./availability-calendar";

export default async function ProviderAvailabilityPage() {
  const user = await requireAuth("provider", "/provider/availability");
  const provider = await getProvider(user.providerId!);
  if (!provider) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-xl font-semibold">Profile missing</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          We couldn&apos;t load your profile. Sign out and try again.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Availability</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Tap any hour to toggle it on or off. Clients can book only the
          hours you mark available. All times are UTC.
        </p>
      </div>
      <AvailabilityCalendar initial={provider.weeklyAvailability ?? {}} />
    </div>
  );
}
