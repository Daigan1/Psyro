// Server-only: never import from a "use client" module.
// Cognito identity provider. Used when USE_AWS=true. The local HMAC-session
// flow in src/lib/auth.ts stays as dev/scaffold; the functions here let the
// auth flow dispatch to Cognito (USER_AUTH + EMAIL_OTP) when credentials
// + user pool IDs are configured. Cognito itself emails the code via its
// built-in sender — no Lambda triggers, no SES setup. No MFA: both client
// and provider accounts sign in with the email code alone.

import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { createHmac, randomInt } from "node:crypto";
import { env } from "../env";

export type Role = "client" | "provider";

export type CognitoUser = {
  sub: string;
  email: string;
  role: Role;
};

let client: CognitoIdentityProviderClient | null = null;
function getClient(): CognitoIdentityProviderClient {
  if (!client)
    client = new CognitoIdentityProviderClient({ region: env.awsRegion });
  return client;
}

function requireConfigured(role: Role): {
  userPoolId: string;
  clientId: string;
  clientSecret: string;
} {
  const userPoolId = env.cognito.userPoolId;
  if (!userPoolId) throw new Error("COGNITO_USER_POOL_ID is required");
  const clientId =
    role === "provider" ? env.cognito.providerAppId : env.cognito.clientAppId;
  if (!clientId) {
    throw new Error(`COGNITO_${role.toUpperCase()}_APP_ID is required`);
  }
  const clientSecret =
    role === "provider"
      ? env.cognito.providerAppSecret
      : env.cognito.clientAppSecret;
  return { userPoolId, clientId, clientSecret };
}

// Required when the Cognito app client is configured with a client secret.
function secretHash(
  username: string,
  clientId: string,
  clientSecret: string,
): string {
  return createHmac("sha256", clientSecret)
    .update(username + clientId)
    .digest("base64");
}

export type CognitoChallenge = {
  session: string;
  email: string;
  role: Role;
};

// Step 1: kick off USER_AUTH with EMAIL_OTP. Cognito sends the 6-digit code
// to the user's verified email via its built-in sender. If the account
// doesn't exist yet, we silently create it (with email_verified=true and a
// random permanent password the user never uses) and retry.
//
// We probe with AdminGetUser first because Cognito app clients have
// "Prevent user existence errors" enabled by default — InitiateAuth returns
// a fake Session for unknown users and sends no email, so we can't rely on
// UserNotFoundException to trigger user creation.
export async function startEmailCodeLogin(input: {
  email: string;
  role: Role;
}): Promise<CognitoChallenge> {
  if (!(await userExists(input.email, input.role))) {
    await ensureUser(input.email, input.role);
  }
  return await initiateEmailOtp(input);
}

async function userExists(email: string, role: Role): Promise<boolean> {
  const { userPoolId } = requireConfigured(role);
  try {
    await getClient().send(
      new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email }),
    );
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === "UserNotFoundException") return false;
    throw err;
  }
}

async function initiateEmailOtp(input: {
  email: string;
  role: Role;
}): Promise<CognitoChallenge> {
  const { clientId, clientSecret } = requireConfigured(input.role);
  const authParams: Record<string, string> = {
    USERNAME: input.email,
    PREFERRED_CHALLENGE: "EMAIL_OTP",
  };
  if (clientSecret) {
    authParams.SECRET_HASH = secretHash(input.email, clientId, clientSecret);
  }
  const res = await getClient().send(
    new InitiateAuthCommand({
      AuthFlow: "USER_AUTH",
      ClientId: clientId,
      AuthParameters: authParams,
    }),
  );
  if (!res.Session) {
    throw new Error("Cognito did not return a challenge.");
  }
  return {
    session: res.Session,
    email: input.email,
    role: input.role,
  };
}

async function ensureUser(email: string, role: Role): Promise<void> {
  const { userPoolId } = requireConfigured(role);
  try {
    await getClient().send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: email,
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
        ],
        MessageAction: "SUPPRESS",
      }),
    );
  } catch (err) {
    if ((err as { name?: string }).name !== "UsernameExistsException") throw err;
  }
  await getClient().send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username: email,
      Password: randomPassword(),
      Permanent: true,
    }),
  );
  try {
    await getClient().send(
      new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: email,
        GroupName: role,
      }),
    );
  } catch (err) {
    // Missing group is fatal — misconfigured pool. Already-in-group is fine.
    const name = (err as { name?: string }).name;
    if (name !== "ResourceNotFoundException") throw err;
    throw new Error(
      `Cognito group "${role}" not found in user pool. Create it or fix role mapping.`,
    );
  }
}

const PW_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const PW_LOWER = "abcdefghijklmnopqrstuvwxyz";
const PW_DIGIT = "0123456789";
const PW_SYMBOL = "!@#$%^&*";
function randomPassword(): string {
  const pick = (s: string) => s[randomInt(0, s.length)];
  const all = PW_UPPER + PW_LOWER + PW_DIGIT + PW_SYMBOL;
  let out = pick(PW_UPPER) + pick(PW_LOWER) + pick(PW_DIGIT) + pick(PW_SYMBOL);
  for (let i = 0; i < 24; i++) out += pick(all);
  return out;
}

// Step 2: respond with the emailed code. Cognito returns tokens directly —
// no MFA challenge for either role.
export async function respondEmailCode(input: {
  challenge: CognitoChallenge;
  code: string;
}): Promise<{
  idToken: string;
  accessToken: string;
  refreshToken: string;
}> {
  const { clientId, clientSecret } = requireConfigured(input.challenge.role);
  const responses: Record<string, string> = {
    USERNAME: input.challenge.email,
    EMAIL_OTP_CODE: input.code,
  };
  if (clientSecret) {
    responses.SECRET_HASH = secretHash(
      input.challenge.email,
      clientId,
      clientSecret,
    );
  }
  const res = await getClient().send(
    new RespondToAuthChallengeCommand({
      ClientId: clientId,
      ChallengeName: "EMAIL_OTP",
      Session: input.challenge.session,
      ChallengeResponses: responses,
    }),
  );
  if (!res.AuthenticationResult?.IdToken) {
    throw new Error("Cognito did not return tokens.");
  }
  return {
    idToken: res.AuthenticationResult.IdToken,
    accessToken: res.AuthenticationResult.AccessToken ?? "",
    refreshToken: res.AuthenticationResult.RefreshToken ?? "",
  };
}

// ID token verification, cached per role. Used by getCurrentUser when we
// swap the session cookie for a Cognito idToken.
const verifiers = new Map<
  Role,
  ReturnType<typeof CognitoJwtVerifier.create>
>();

function getVerifier(role: Role) {
  const cached = verifiers.get(role);
  if (cached) return cached;
  const { userPoolId, clientId } = requireConfigured(role);
  const v = CognitoJwtVerifier.create({
    userPoolId,
    clientId,
    tokenUse: "id",
  });
  verifiers.set(role, v);
  return v;
}

export async function verifyIdToken(
  idToken: string,
  role: Role,
): Promise<CognitoUser | null> {
  try {
    const payload = await getVerifier(role).verify(idToken);
    const groups = (payload["cognito:groups"] as string[] | undefined) ?? [];
    const derivedRole: Role = groups.includes("provider") ? "provider" : "client";
    if (derivedRole !== role) return null;
    return {
      sub: payload.sub,
      email: (payload.email as string) ?? "",
      role: derivedRole,
    };
  } catch {
    return null;
  }
}

