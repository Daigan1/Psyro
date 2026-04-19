import { SignInClient } from "./sign-in-client";

type SearchParams = {
  role?: string;
  next?: string;
  error?: string;
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const role = (["client", "provider"] as const).includes(
    sp.role as "client" | "provider",
  )
    ? (sp.role as "client" | "provider")
    : "client";
  return (
    <div className="mx-auto w-full max-w-md px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        We&apos;ll email you a 6-digit code.
      </p>
      <SignInClient
        initialRole={role}
        next={sp.next ?? null}
        initialError={errorMessage(sp.error)}
      />
    </div>
  );
}

function errorMessage(code: string | undefined): string | null {
  if (code === "wrong-role") {
    return "You're signed in with a different role than this page needs.";
  }
  return null;
}
