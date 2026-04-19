// Server-only: never import from a "use client" module.
// Short-lived per-conversation token used to authenticate ElevenLabs tool
// webhooks back to a specific clientId. Same HMAC-SHA256 primitive as the
// session cookie (see auth.ts), but namespaced via the "eleven." prefix in
// the MAC input so a session cookie can never be replayed as a tool token
// (and vice-versa).
//
// IMPORTANT: this token rides in the widget DOM as a `dynamic-variables`
// attribute, then ElevenLabs replays it back to our tool webhooks. Keep
// the TTL short and the surface (only clientId) minimal.

import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

const TOKEN_TTL_SECONDS = 30 * 60;

export type ConversationTokenPayload = {
  sub: string;
  conv: string;
  exp: number;
};

export function mintConversationToken(args: {
  clientId: string;
  conversationId: string;
}): string {
  const payload: ConversationTokenPayload = {
    sub: args.clientId,
    conv: args.conversationId,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  const json = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", env.authSecret)
    .update(`eleven.${json}`)
    .digest("base64url");
  return `${json}.${mac}`;
}

export function verifyConversationToken(
  token: string,
): ConversationTokenPayload | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const json = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac("sha256", env.authSecret)
    .update(`eleven.${json}`)
    .digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: ConversationTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(json, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (payload.exp * 1000 < Date.now()) return null;
  return payload;
}

export function bearerFromHeader(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1] : null;
}

// Pulls the conversation token from either the Authorization header
// (preferred) OR a `user_token` field in the JSON body. ElevenLabs
// ConvAI's header-template substitution (`Bearer {{user_token}}`) has
// been unreliable across dashboard versions — body-level dynamic
// variables (`value_type: "dynamic_variable"`) work consistently.
export async function tokenFromRequest(
  request: Request,
): Promise<{ token: string | null; body: Record<string, unknown> }> {
  const headerToken = bearerFromHeader(request.headers.get("authorization"));
  if (headerToken) return { token: headerToken, body: {} };

  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return { token: null, body: {} };
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return { token: null, body: {} };
  }
  const raw = body.user_token;
  return {
    token: typeof raw === "string" && raw ? raw : null,
    body,
  };
}
