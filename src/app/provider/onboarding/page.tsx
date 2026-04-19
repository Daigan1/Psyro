import { requireAuth } from "@/lib/auth";
import { getProvider } from "@/lib/providers-store";
import { OnboardingForm } from "./onboarding-form";

export default async function ProviderOnboardingPage() {
  const user = await requireAuth("provider", "/provider/onboarding");
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
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Your profile</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Clients see these fields when the matcher recommends you. Keep them
          accurate — the AI rewrites nothing here.
        </p>
      </div>
      <OnboardingForm provider={provider} />
    </div>
  );
}
