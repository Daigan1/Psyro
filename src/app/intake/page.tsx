import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getIntakeProgress } from "@/lib/intake-store";
import type { IntakeInput } from "@/lib/types";
import { IntakeForm } from "./intake-form";

const initial: IntakeInput = {
  personalInfo: { name: "" },
  crisis: { imminentHarm: false, notes: "" },
  problems: { description: "", tags: [] },
  preferences: {
    therapistGender: "no-preference",
    modalities: [],
    format: "video",
  },
};

export default async function IntakePage() {
  const user = await requireAuth("client", "/intake");
  const progress = await getIntakeProgress(user.clientId!);

  // Intake is strictly the first-time onboarding flow. Returning users
  // edit their preferences and concerns from /settings instead of being
  // re-walked through every step.
  if (progress?.completed) {
    redirect("/dashboard");
  }

  const step = Math.max(0, Math.min(3, progress?.step ?? 0)) as 0 | 1 | 2 | 3;

  return (
    <IntakeForm
      initialData={progress?.data ?? initial}
      initialStep={step}
    />
  );
}
