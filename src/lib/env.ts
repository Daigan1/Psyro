// Server-only env access — throws loudly if a required var is missing when a feature needs it.
// Do not import from client components.

export const env = {
  awsRegion: process.env.AWS_REGION ?? "us-east-1",

  authSecret:
    process.env.AUTH_SECRET ?? "",

  cognito: {
    userPoolId: process.env.COGNITO_USER_POOL_ID ?? "",
    clientAppId: process.env.COGNITO_CLIENT_APP_ID ?? "",
    clientAppSecret: process.env.COGNITO_CLIENT_APP_SECRET ?? "",
    providerAppId: process.env.COGNITO_PROVIDER_APP_ID ?? "",
    providerAppSecret: process.env.COGNITO_PROVIDER_APP_SECRET ?? "",
  },

  ddb: {
    users: process.env.DDB_TABLE_USERS ?? "",
    appointments:
      process.env.DDB_TABLE_APPOINTMENTS ?? "",
    sessionArtifacts:
      process.env.DDB_TABLE_SESSION_ARTIFACTS ?? "",
    sessions: process.env.DDB_TABLE_SESSIONS ?? "",
    qa: process.env.DDB_TABLE_QA ?? "",
    pendingBookings:
      process.env.DDB_TABLE_PENDING_BOOKINGS ?? "",
    intake: process.env.DDB_TABLE_INTAKE ?? "",
    resources: process.env.DDB_TABLE_RESOURCES ?? "",
  },

  s3: {
    phiBucket: process.env.S3_BUCKET_PHI ?? "",
  },

  featherless: {
    apiKey: process.env.FEATHERLESS_API_KEY ?? "",
    baseUrl: process.env.FEATHERLESS_BASE_URL ?? "",
    matcherModel: process.env.FEATHERLESS_MODEL_MATCHER ?? "",
  },

  tinyfish: {
    apiKey: process.env.TINYFISH_API_KEY ?? "",
    fetchUrl: process.env.TINYFISH_FETCH_URL ?? "https://api.fetch.tinyfish.ai",
  },

  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY ?? "",
    voiceId: process.env.ELEVENLABS_VOICE_ID ?? "",
    qaAgentId: process.env.ELEVENAGENTS_QA_AGENT_ID ?? "",
  },

  daily: {
    apiKey: process.env.DAILY_API_KEY ?? "",
    // Optional: forces room creation under a specific subdomain/team.
    // Most projects can leave this empty — Daily picks the workspace from
    // the API key.
  },

  ses: {
    from: process.env.SES_FROM_ADDRESS ?? "",
  },

  stripe: {
    // Use test-mode (sandbox) keys: sk_test_... / whsec_...
    secretKey: process.env.STRIPE_SECRET_KEY ?? "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    // Used to build success/cancel URLs on Checkout Sessions.
    appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
  },
};

export function requireEnv(value: string, name: string): string {
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. Set it in .env.local or the deployment secret store.`,
    );
  }
  return value;
}
