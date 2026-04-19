import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getAvailability, getTherapist } from "@/lib/mock-availability";
import { bookedSlotsForProvider } from "@/lib/appointments-store";
import { BookingForm } from "./booking-form";

export default async function BookingPage({
  params,
}: {
  params: Promise<{ therapistId: string }>;
}) {
  const { therapistId } = await params;
  await requireAuth("client", `/booking/${therapistId}`);
  const [therapist, booked, allSlots] = await Promise.all([
    getTherapist(therapistId),
    bookedSlotsForProvider(therapistId),
    getAvailability(therapistId),
  ]);
  if (!therapist) notFound();

  const slots = allSlots.filter((s) => !booked.has(s.startTime));

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-12">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">
          Book with {therapist.name}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {therapist.pronouns} · {therapist.specialties.slice(0, 3).join(" · ")}
        </p>
      </div>

      <p className="mt-4 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
        {therapist.bio}
      </p>

      <BookingForm
        providerId={therapist.id}
        availableFormats={therapist.sessionFormats}
        slots={slots}
        ratePerSessionCents={therapist.ratePerSessionCents}
      />
    </div>
  );
}
