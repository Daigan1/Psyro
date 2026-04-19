// Server-only: never import from a "use client" module.
// Local signed-session auth, designed as the swap point for AWS Cognito.
// The `tf_session` cookie holds a base64-encoded JSON payload + HMAC-SHA256.
// When Cognito is wired (USE_AWS=true), replace sign/verify with Cognito's
// ID-token JWT verification via aws-jwt-verify; the rest of the surface area
// (getCurrentUser, requireAuth) stays the same.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import {
  createSelfSignupProvider,
  getProviderByEmail,
} from "./providers-store";
import { recordAudit } from "./audit-log";
import { touchSignIn } from "./users-store";
import type { ProviderUserRecord, Therapist, UserRecord } from "./types";
import { getProvider } from "./providers-store";
import {
  respondEmailCode,
  startEmailCodeLogin,
  type CognitoChallenge,
} from "./aws/cognito";

export type Role = "client" | "provider";

export type SessionPayload = {
  sub: string;
  role: Role;
  email: string;
  // role-specific fields
  clientId?: string;
  providerId?: string;
  exp: number;
};

const SESSION_COOKIE = "tf_session";
const ONE_HOUR = 60 * 60;
const SESSION_TTL = ONE_HOUR * 24 * 7;

// Challenges: in-memory store for the email-code flow. When USE_AWS=true
// the `cognitoSession` is populated with the Cognito `Session` string and
// the `code` field is ignored locally (the real code is sent by Cognito
// via SES).
type Challenge = {
  id: string;
  email: string;
  role: Role;
  code: string;
  expiresAt: number;
  codeVerified: boolean;
  // Resolved identity fields (populated after email verification).
  sub?: string;
  providerId?: string;
  clientId?: string;
  // Live-mode handoff state.
  cognitoSession?: string;
  cognitoChallengeName?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
if (!g.__tinyfishChallenges) {
  g.__tinyfishChallenges = new Map<string, Challenge>();
}
const challenges: Map<string, Challenge> = g.__tinyfishChallenges;

function signPayload(payload: SessionPayload): string {
  const json = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", env.authSecret).update(json).digest("base64url");
  return `${json}.${mac}`;
}

function verifyToken(token: string): SessionPayload | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const json = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac("sha256", env.authSecret).update(json).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(json, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;
  return payload;
}

export async function issueSession(
  payload: Omit<SessionPayload, "exp">,
): Promise<void> {
  const full: SessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL,
  };
  const token = signPayload(full);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL,
    path: "/",
  });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function requireAuth(
  role: Role,
  nextPath?: string,
): Promise<SessionPayload> {
  const user = await getCurrentUser();
  if (!user) {
    const qs = new URLSearchParams({ role });
    if (nextPath) qs.set("next", nextPath);
    redirect(`/sign-in?${qs.toString()}`);
  }
  if (user.role !== role) {
    redirect(`/sign-in?role=${role}&error=wrong-role`);
  }
  return user;
}

// ---------- Challenge helpers ----------

// When Cognito is configured, `devCode` is null — the user receives the
// real OTP by email. In local dev it's returned to the caller so the
// sign-in page can display it.
export type CreateChallengeResult = {
  challenge: Challenge;
};

export async function createChallenge(
  email: string,
  role: Role,
): Promise<CreateChallengeResult> {
  const normalized = email.trim().toLowerCase();
  const identity = await resolveIdentity(normalized, role);
  if (!identity) {
    throw new AuthError("This provider account is suspended.");
  }
  const id = randomBytes(16).toString("base64url");

 
    let cognito: CognitoChallenge;
    try {
      cognito = await startEmailCodeLogin({ email: normalized, role });
    } catch (err) {
      throw translateCognitoStartError(err);
    }
    const challenge: Challenge = {
      id,
      email: normalized,
      role,
      code: "",
      expiresAt: Date.now() + 10 * 60 * 1000,
      codeVerified: false,
      cognitoSession: cognito.session,
      cognitoChallengeName: "EMAIL_OTP",
      ...identity,
    };
    challenges.set(id, challenge);
    return { challenge };
}

export async function verifyCode(
  challengeId: string,
  code: string,
): Promise<{ challenge: Challenge }> {
  const challenge = challenges.get(challengeId);
  if (!challenge) throw new AuthError("This sign-in link has expired. Start over.");
  if (challenge.expiresAt < Date.now()) {
    challenges.delete(challengeId);
    throw new AuthError("The code expired. Request a new one.");
  }

  if (challenge.cognitoSession) {
    try {
      await respondEmailCode({
        challenge: {
          session: challenge.cognitoSession,
          email: challenge.email,
          role: challenge.role,
        },
        code: code.trim(),
      });
    } catch (err) {
      throw translateCognitoVerifyError(err);
    }
  } else if (challenge.code !== code.trim()) {
    throw new AuthError("That code doesn't match.");
  }

  challenge.codeVerified = true;
  challenges.set(challengeId, challenge);
  return { challenge };
}

function logCognitoError(phase: "start" | "verify", err: unknown): void {
  const name = (err as { name?: string }).name ?? "UnknownError";
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[auth] cognito ${phase} failed: ${name}: ${message}`);
}

function translateCognitoStartError(err: unknown): AuthError {
  logCognitoError("start", err);
  const name = (err as { name?: string }).name;
  if (name === "LimitExceededException" || name === "TooManyRequestsException") {
    return new AuthError("Too many attempts. Wait a minute and try again.");
  }
  if (name === "UserNotConfirmedException" || name === "PasswordResetRequiredException") {
    return new AuthError("This account can't sign in right now. Contact support.");
  }
  // NotAuthorizedException at start = app client / flow misconfig or disabled user;
  // surface a generic message instead of the verify-phase "code doesn't match".
  return new AuthError("Couldn't start sign-in. Try again in a moment.");
}

function translateCognitoVerifyError(err: unknown): AuthError {
  logCognitoError("verify", err);
  const name = (err as { name?: string }).name;
  if (name === "CodeMismatchException" || name === "NotAuthorizedException") {
    return new AuthError("That code doesn't match.");
  }
  if (name === "ExpiredCodeException") {
    return new AuthError("The code expired. Request a new one.");
  }
  if (name === "LimitExceededException" || name === "TooManyRequestsException") {
    return new AuthError("Too many attempts. Wait a minute and try again.");
  }
  if (err instanceof Error && err.message) return new AuthError(err.message);
  return new AuthError("Couldn't reach sign-in service.");
}

export async function completeChallenge(
  challenge: Challenge,
): Promise<SessionPayload> {
  challenges.delete(challenge.id);
  const payload: SessionPayload = {
    sub: challenge.sub!,
    role: challenge.role,
    email: challenge.email,
    clientId: challenge.clientId,
    providerId: challenge.providerId,
    exp: 0,
  };
  await persistUserOnSignIn(payload);
  recordAudit({
    actorId: challenge.sub ?? null,
    actorRole: challenge.role,
    action: "auth.sign-in",
    resource: "session",
    resourceId: null,
    metadata: { email: challenge.email },
  });
  return payload;
}

// Upsert a tinyfish_users row on every successful sign-in. For providers
// we seed the row with the full Therapist profile the first time we see
// them, so onboarding edits later land on an existing record.
async function persistUserOnSignIn(payload: SessionPayload): Promise<void> {
  const now = new Date().toISOString();
  if (payload.role === "client") {
    const defaults: UserRecord = {
      id: payload.clientId!,
      email: payload.email,
      role: "client",
      createdAt: now,
      lastSignInAt: now,
    };
    await touchSignIn(defaults);
    return;
  }
  // Provider: pull current profile (providers-store already ensured a row
  // exists via createSelfSignupProvider during resolveIdentity) and pass
  // it as the seed. DDB touchSignIn uses if_not_exists, so existing
  // profile attributes are preserved.
  const therapist: Therapist | null = await getProvider(payload.providerId!);
  if (!therapist) return;
  const defaults: ProviderUserRecord = {
    ...therapist,
    role: "provider",
    createdAt: now,
    lastSignInAt: now,
  };
  await touchSignIn(defaults);
}

export class AuthError extends Error {}

// Resolve identities from email. Live Cognito delegates this to the user
// pool. Dev conventions:
//   client:   any email → stable clientId derived from email hash
//   provider: any email — profile is created on first sign-in, completed
//             via /provider/onboarding. Returns null only when the account
//             has been suspended.
async function resolveIdentity(
  email: string,
  role: Role,
): Promise<
  Pick<Challenge, "sub" | "clientId" | "providerId"> | null
> {
  if (role === "client") {
    const clientId = `c_${hash12(email)}`;
    return { sub: clientId, clientId };
  }
  const therapist =
    (await getProviderByEmail(email)) ??
    (await createSelfSignupProvider(email));
  if (therapist.status === "suspended") return null;
  return {
    sub: therapist.id,
    providerId: therapist.id,
  };
}

function hash12(email: string): string {
  return createHmac("sha256", "id-derivation").update(email).digest("hex").slice(0, 12);
}
