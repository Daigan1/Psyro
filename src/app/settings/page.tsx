import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getUser } from "@/lib/users-store";
import { getIntakeProgress } from "@/lib/intake-store";
import { getProvider } from "@/lib/providers-store";
import { ClientTopBar } from "@/app/client-topbar";
import { SettingsForm } from "./settings-form";
import type { IntakeInput } from "@/lib/types";

const EMPTY_INTAKE: IntakeInput = {
  personalInfo: { name: "" },
  crisis: { imminentHarm: false },
  problems: { description: "", tags: [] },
  preferences: {
    therapistGender: "no-preference",
    modalities: [],
    format: "either",
  },
};

// Backfill missing fields on intakes saved before the schema was
// extended. Without this, opening Settings with a pre-`personalInfo`
// row crashes when the form reads `data.personalInfo.name`.
function normalizeIntake(data: IntakeInput | undefined): IntakeInput {
  if (!data) return EMPTY_INTAKE;
  return {
    personalInfo: { name: data.personalInfo?.name ?? "" },
    crisis: {
      imminentHarm: data.crisis?.imminentHarm ?? false,
      notes: data.crisis?.notes,
    },
    problems: {
      description: data.problems?.description ?? "",
      tags: data.problems?.tags ?? [],
    },
    preferences: {
      therapistGender: data.preferences?.therapistGender ?? "no-preference",
      modalities: data.preferences?.modalities ?? [],
      format: data.preferences?.format ?? "either",
    },
  };
}

export default async function SettingsPage() {
  const user = await requireAuth("client", "/settings");
  const [record, progress] = await Promise.all([
    getUser(user.clientId!),
    getIntakeProgress(user.clientId!),
  ]);

  // Brand-new clients land here without an intake row. Send them through
  // the proper guided flow instead of editing nothing.
  if (!progress) {
    redirect("/intake");
  }

  const currentProviderId =
    record && record.role === "client"
      ? record.currentProviderId ?? null
      : null;
  const currentProvider = currentProviderId
    ? await getProvider(currentProviderId)
    : null;

  return (
    <>
      <ClientTopBar />
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Edit anything here without redoing intake. Changes apply the next
          time we rank therapists for you.
        </p>

        <SettingsForm
          initialData={normalizeIntake(progress.data)}
          currentProviderName={currentProvider?.name ?? null}
        />
      </div>
    </>
  );
}
