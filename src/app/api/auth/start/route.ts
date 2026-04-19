import { NextResponse } from "next/server";
import { AuthError, createChallenge, type Role } from "@/lib/auth";

type Body = { email: string; role: Role };

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.email || !body.email.includes("@")) {
    return NextResponse.json(
      { error: "Enter a valid email address." },
      { status: 400 },
    );
  }
  if (!["client", "provider"].includes(body.role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  try {
    const { challenge } = await createChallenge(body.email, body.role);
    return NextResponse.json({
      challengeId: challenge.id
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
