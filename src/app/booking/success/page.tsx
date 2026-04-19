import { Suspense } from "react";
import { BookingSuccessClient } from "./success-client";

export default function BookingSuccessPage() {
  return (
    <div className="mx-auto w-full max-w-xl px-6 py-16">
      <Suspense
        fallback={
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Loading…
          </p>
        }
      >
        <BookingSuccessClient />
      </Suspense>
    </div>
  );
}
