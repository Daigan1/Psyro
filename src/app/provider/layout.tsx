import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { SignOutButton } from "@/app/sign-out-button";

const nav = [
  { href: "/provider/dashboard", label: "Dashboard" },
  { href: "/provider/onboarding", label: "Profile" },
  { href: "/provider/availability", label: "Availability" },
  { href: "/provider/resources", label: "Resources" },
];

export default async function ProviderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  const signedIn = user?.role === "provider";

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-primary">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <Link
            href="/provider"
            className="inline-flex items-center gap-2 text-sm font-semibold"
          >
           <img src="/logo.png" width={45} height={45}/>
            Psyro
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            {signedIn &&
              nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-zinc-600 hover:text-primary dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  {item.label}
                </Link>
              ))}
            {signedIn ? (
              <SignOutButton />
            ) : (
              <Link
                href="/sign-in?role=provider"
                className="text-zinc-600 hover:text-primary dark:text-zinc-400 dark:hover:text-zinc-50"
              >
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
