import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { listAppointmentsForClient } from "@/lib/appointments-store";
import { getUser } from "@/lib/users-store";
import { getProvider } from "@/lib/providers-store";
import type { Appointment, Therapist } from "@/lib/types";
import { ClientTopBar } from "@/app/client-topbar";
import { AppointmentActions } from "./appointment-actions";

export default async function ClientDashboardPage() {
  const user = await requireAuth("client", "/dashboard");
  const [appointments, record] = await Promise.all([
    listAppointmentsForClient(user.clientId!),
    getUser(user.clientId!),
  ]);
  const currentProviderId =
    record && record.role === "client"
      ? record.currentProviderId ?? null
      : null;
  const currentProvider = currentProviderId
    ? await getProvider(currentProviderId)
    : null;

  // Server component: re-evaluated on every request, so Date.now() is the
  // intended source of "now". The react-hooks/purity rule is for client
  // components and doesn't apply here.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  // Three buckets, status-driven so early-ended sessions surface
  // immediately in Completed instead of waiting out the scheduled slot:
  //   Upcoming  — still on the calendar and not yet run.
  //   Completed — happened (real or tech-failure); has or may have notes.
  //   Cancelled — never happened (cancelled, late-cancel, no-show, or a
  //               "scheduled" row whose end-time has passed).
  const upcoming = appointments.filter(
    (a) =>
      (a.status === "scheduled" || a.status === "in-progress") &&
      new Date(a.endTime).getTime() > now,
  );
  const completed = appointments.filter(
    (a) => a.status === "completed" || a.status === "tech-failure",
  );
  const cancelled = appointments.filter(
    (a) =>
      a.status === "cancelled" ||
      a.status === "late-cancel" ||
      a.status === "no-show" ||
      (a.status === "scheduled" && new Date(a.endTime).getTime() <= now),
  );

  return (
    <>
      <ClientTopBar />
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Your dashboard</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Signed in as {user.email}.
        </p>
      </div>

      <CurrentProviderCard provider={currentProvider} />

      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Upcoming
        </h2>
        {upcoming.length === 0 ? (
          <EmptyState currentProviderId={currentProviderId} />
        ) : (
          <ul className="mt-3 space-y-3">
            {upcoming.map((a) => (
              <AppointmentCard key={a.id} appointment={a} variant="upcoming" />
            ))}
          </ul>
        )}
      </section>

      {completed.length > 0 && (
        <section className="mt-12">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Completed
          </h2>
          <ul className="mt-3 space-y-3">
            {completed.map((a) => (
              <AppointmentCard key={a.id} appointment={a} variant="past" />
            ))}
          </ul>
        </section>
      )}

      {cancelled.length > 0 && (
        <section className="mt-12">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Cancelled
          </h2>
          <ul className="mt-3 space-y-3">
            {cancelled.map((a) => (
              <AppointmentCard key={a.id} appointment={a} variant="cancelled" />
            ))}
          </ul>
        </section>
      )}
      </div>
    </>
  );
}

function CurrentProviderCard({ provider }: { provider: Therapist | null }) {
  if (!provider) {
    return (
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-zinc-300 p-5 dark:border-zinc-700">
        <div className="text-sm text-zinc-700 dark:text-zinc-300">
          You don&apos;t have a current therapist yet.
        </div>
        <Link
          href="/matches"
          className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-white dark:bg-accent dark:text-primary"
        >
          Find one
        </Link>
      </div>
    );
  }
  return (
    <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-accent-soft/40 p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Your therapist
        </div>
        <div className="mt-0.5 text-base font-semibold">
          {provider.name}{" "}
          <span className="text-sm font-normal text-zinc-500">
            {provider.pronouns}
          </span>
        </div>
        {provider.specialties.length > 0 && (
          <div className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
            {provider.specialties.slice(0, 4).join(" · ")}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Link
          href={`/booking/${provider.id}`}
          className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-white dark:bg-accent dark:text-primary"
        >
          Book a session
        </Link>
        <Link
          href="/matches"
          className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-medium dark:border-zinc-700"
        >
          Switch
        </Link>
      </div>
    </div>
  );
}

function EmptyState({
  currentProviderId,
}: {
  currentProviderId: string | null;
}) {
  // If they've already selected a therapist, send them straight to the
  // booking page for that person. Otherwise route to /matches so they can
  // pick someone first.
  const href = currentProviderId
    ? `/booking/${currentProviderId}`
    : "/matches";
  const label = currentProviderId ? "Book a session" : "Find a therapist";
  return (
    <div className="mt-3 rounded-2xl border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        No appointments yet.
      </p>
      <Link
        href={href}
        className="mt-4 inline-block rounded-full bg-primary px-5 py-2 text-sm font-medium text-white dark:bg-accent dark:text-primary"
      >
        {label}
      </Link>
    </div>
  );
}

function AppointmentCard({
  appointment,
  variant,
}: {
  appointment: Appointment;
  variant: "upcoming" | "past" | "cancelled";
}) {
  const start = new Date(appointment.startTime);
  const day = start.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const time = start.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <li className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{appointment.providerName}</div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            {day} · {time} · {appointment.format}
          </div>
        </div>
        <div className="flex gap-2">
          {variant === "upcoming" && (
            <Link
              href={`/sessions/${appointment.id}/join`}
              className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-white dark:bg-accent dark:text-primary"
            >
              Join
            </Link>
          )}
          {variant === "past" && (
            <Link
              href={`/sessions/${appointment.id}`}
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
            >
              Summary
            </Link>
          )}
          {variant === "cancelled" && (
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
              {appointment.status === "no-show"
                ? "No show"
                : appointment.status === "late-cancel"
                  ? "Late cancel"
                  : "Cancelled"}
            </span>
          )}
        </div>
      </div>
      {variant === "upcoming" && (
        <AppointmentActions
          appointmentId={appointment.id}
          providerId={appointment.providerId}
        />
      )}
    </li>
  );
}
