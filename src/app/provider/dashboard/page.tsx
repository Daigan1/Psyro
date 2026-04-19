import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { listAppointmentsForProvider } from "@/lib/appointments-store";
import { getProvider } from "@/lib/providers-store";
import { getIntakeProgress } from "@/lib/intake-store";
import { getUser } from "@/lib/users-store";
import type { Appointment } from "@/lib/types";

export default async function ProviderDashboardPage() {
  const user = await requireAuth("provider", "/provider/dashboard");
  const providerId = user.providerId!;
  const [provider, appointments] = await Promise.all([
    getProvider(providerId),
    listAppointmentsForProvider(providerId),
  ]);

  // Look up the display name for every distinct client in this list:
  // intake.personalInfo.name → user.email local part → ID slice. One
  // pass over distinct clients so the dashboard never shows a raw ID
  // when we have something better.
  const distinctClientIds = Array.from(
    new Set(appointments.map((a) => a.clientId)),
  );
  const [intakes, users] = await Promise.all([
    Promise.all(distinctClientIds.map((id) => getIntakeProgress(id))),
    Promise.all(distinctClientIds.map((id) => getUser(id))),
  ]);
  const clientNames = new Map<string, string>();
  distinctClientIds.forEach((id, i) => {
    const intakeName = intakes[i]?.data.personalInfo?.name?.trim();
    if (intakeName) {
      clientNames.set(id, intakeName);
      return;
    }
    const email = users[i]?.email;
    if (email) {
      clientNames.set(id, friendlyNameFromEmail(email));
    }
  });

  // Server component: re-evaluated on every request. The react-hooks/purity
  // rule targets client components and doesn't apply here.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  // Same three-bucket split as the client dashboard.
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
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Signed in as{" "}
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {provider?.name ?? providerId}
            </span>
          </p>
        </div>
      </div>

      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Upcoming
        </h2>
        {upcoming.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
            No upcoming sessions.
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {upcoming.map((a) => (
              <AppointmentRow
                key={a.id}
                appointment={a}
                clientName={clientNames.get(a.clientId) ?? null}
                action={
                  <Link
                    href={`/provider/sessions/${a.id}/join`}
                    className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-white dark:bg-accent dark:text-primary"
                  >
                    Join
                  </Link>
                }
              />
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
              <AppointmentRow
                key={a.id}
                appointment={a}
                clientName={clientNames.get(a.clientId) ?? null}
                action={
                  <Link
                    href={`/provider/sessions/${a.id}/review`}
                    className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
                  >
                    Review
                  </Link>
                }
              />
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
              <AppointmentRow
                key={a.id}
                appointment={a}
                clientName={clientNames.get(a.clientId) ?? null}
                action={
                  <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                    {a.status === "no-show"
                      ? "No show"
                      : a.status === "late-cancel"
                        ? "Late cancel"
                        : "Cancelled"}
                  </span>
                }
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function AppointmentRow({
  appointment,
  clientName,
  action,
}: {
  appointment: Appointment;
  clientName: string | null;
  action: React.ReactNode;
}) {
  const start = new Date(appointment.startTime);
  return (
    <li className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            {clientName ?? `Client ${appointment.clientId.slice(0, 10)}…`}
          </div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            {start.toLocaleString(undefined, {
              weekday: "long",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}{" "}
            · {appointment.format}
          </div>
          <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Payout{" "}
            <span className="font-medium text-zinc-900 dark:text-zinc-100 tabular-nums">
              {formatUsd(appointment.pricePaidCents)}
            </span>
          </div>
        </div>
        {action}
      </div>
    </li>
  );
}

function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
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
