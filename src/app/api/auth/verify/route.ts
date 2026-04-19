import { NextResponse } from "next/server";
import {
  AuthError,
  completeChallenge,
  issueSession,
  verifyCode,
} from "@/lib/auth";

type Body = {
  challengeId: string;
  code: string;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.challengeId || !body.code) {
    return NextResponse.json(
      { error: "Missing challengeId or code" },
      { status: 400 },
    );
  }

  try {
    const { challenge } = await verifyCode(body.challengeId, body.code);
    const payload = await completeChallenge(challenge);
    await issueSession(payload);
    return NextResponse.json({ nextStep: "done", role: payload.role });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
