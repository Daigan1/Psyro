// Server-only: never import from a "use client" module.
// Route-handler auth helper. `requireAuth` in auth.ts uses `redirect()` which
// only belongs in server components — route handlers need JSON-typed errors.

import { NextResponse } from "next/server";
import { getCurrentUser, type Role, type SessionPayload } from "./auth";

type Success = { user: SessionPayload };
type Failure = { error: NextResponse };

export async function requireAuthApi(role: Role): Promise<Success | Failure> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      error: NextResponse.json({ error: "Sign in required." }, { status: 401 }),
    };
  }
  if (user.role !== role) {
    return {
      error: NextResponse.json(
        { error: `This endpoint requires a ${role} session.` },
        { status: 403 },
      ),
    };
  }
  return { user };
}
