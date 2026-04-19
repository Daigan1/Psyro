// Server-only: never import from a "use client" module.
// DynamoDB DocumentClient helpers. The in-memory stores dispatch here when
// USE_AWS=true. All tables are single-partition per record for the scaffold;
// production should add a GSI on providerId/clientId/status for queries.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { env } from "../env";
import type {
  Appointment,
  IntakeProgress,
  PendingBooking,
  ProviderUserRecord,
  QAInteraction,
  SessionArtifact,
  SessionState,
  Tenant,
  Therapist,
  TherapistResource,
  UserRecord,
} from "../types";

let doc: DynamoDBDocumentClient | null = null;
function getClient(): DynamoDBDocumentClient {
  if (!doc) {
    const base = new DynamoDBClient({ region: env.awsRegion });
    doc = DynamoDBDocumentClient.from(base, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return doc;
}

// Surface missing DDB_TABLE_* env vars with a clear message instead of
// letting the AWS SDK reject the request with the cryptic "TableName
// failed to satisfy constraint" validation error.
function requireTable(name: string, envVarName: string): string {
  if (!name) {
    throw new Error(
      `${envVarName} is not set. Add it to .env (and create the matching DynamoDB table).`,
    );
  }
  return name;
}

// ---------- Appointments ----------

export async function ddbPutAppointment(a: Appointment): Promise<void> {
  await getClient().send(
    new PutCommand({ TableName: env.ddb.appointments, Item: a }),
  );
}

export async function ddbGetAppointment(id: string): Promise<Appointment | null> {
  const res = await getClient().send(
    new GetCommand({ TableName: env.ddb.appointments, Key: { id } }),
  );
  return (res.Item as Appointment) ?? null;
}

export async function ddbListAppointmentsForClient(
  clientId: string,
): Promise<Appointment[]> {
  // Requires a GSI on clientId. Fallback to Scan if the index isn't
  // provisioned (slow but correct).
  // No status filter — the dashboard buckets by status (Upcoming /
  // Completed / Cancelled), so we need every row including cancelled
  // and tech-failure ones.
  try {
    const res = await getClient().send(
      new QueryCommand({
        TableName: env.ddb.appointments,
        IndexName: "clientId-startTime-index",
        KeyConditionExpression: "clientId = :c",
        ExpressionAttributeValues: { ":c": clientId },
      }),
    );
    return (res.Items as Appointment[]) ?? [];
  } catch {
    const res = await getClient().send(
      new ScanCommand({
        TableName: env.ddb.appointments,
        FilterExpression: "clientId = :c",
        ExpressionAttributeValues: { ":c": clientId },
      }),
    );
    return ((res.Items as Appointment[]) ?? []).sort((a, b) =>
      a.startTime.localeCompare(b.startTime),
    );
  }
}

export async function ddbListAppointmentsForProvider(
  providerId: string,
): Promise<Appointment[]> {
  try {
    const res = await getClient().send(
      new QueryCommand({
        TableName: env.ddb.appointments,
        IndexName: "providerId-startTime-index",
        KeyConditionExpression: "providerId = :p",
        ExpressionAttributeValues: { ":p": providerId },
      }),
    );
    return (res.Items as Appointment[]) ?? [];
  } catch {
    const res = await getClient().send(
      new ScanCommand({
        TableName: env.ddb.appointments,
        FilterExpression: "providerId = :p",
        ExpressionAttributeValues: { ":p": providerId },
      }),
    );
    return ((res.Items as Appointment[]) ?? []).sort((a, b) =>
      a.startTime.localeCompare(b.startTime),
    );
  }
}

export async function ddbIsSlotBooked(
  providerId: string,
  startTime: string,
): Promise<boolean> {
  const list = await ddbListAppointmentsForProvider(providerId);
  return list.some(
    (a) =>
      a.startTime === startTime &&
      a.status !== "cancelled" &&
      a.status !== "late-cancel",
  );
}

// ---------- Session artifacts ----------

export async function ddbPutArtifact(a: SessionArtifact): Promise<void> {
  await getClient().send(
    new PutCommand({
      TableName: requireTable(env.ddb.sessionArtifacts, "DDB_TABLE_SESSION_ARTIFACTS"),
      Item: { ...a, appointmentId: a.appointmentId },
    }),
  );
}

export async function ddbGetArtifact(
  appointmentId: string,
): Promise<SessionArtifact | null> {
  const res = await getClient().send(
    new GetCommand({
      TableName: requireTable(env.ddb.sessionArtifacts, "DDB_TABLE_SESSION_ARTIFACTS"),
      Key: { appointmentId },
    }),
  );
  return (res.Item as SessionArtifact) ?? null;
}

export async function ddbListArtifactsForProvider(
  providerId: string,
): Promise<SessionArtifact[]> {
  try {
    const res = await getClient().send(
      new QueryCommand({
        TableName: requireTable(env.ddb.sessionArtifacts, "DDB_TABLE_SESSION_ARTIFACTS"),
        IndexName: "providerId-transcribedAt-index",
        KeyConditionExpression: "providerId = :p",
        ExpressionAttributeValues: { ":p": providerId },
        ScanIndexForward: false,
      }),
    );
    return (res.Items as SessionArtifact[]) ?? [];
  } catch {
    const res = await getClient().send(
      new ScanCommand({
        TableName: requireTable(env.ddb.sessionArtifacts, "DDB_TABLE_SESSION_ARTIFACTS"),
        FilterExpression: "providerId = :p",
        ExpressionAttributeValues: { ":p": providerId },
      }),
    );
    return ((res.Items as SessionArtifact[]) ?? []).sort((a, b) =>
      b.transcribedAt.localeCompare(a.transcribedAt),
    );
  }
}

// ---------- Sessions (lifecycle state) ----------

export async function ddbGetSession(
  appointmentId: string,
): Promise<SessionState | null> {
  const res = await getClient().send(
    new GetCommand({
      TableName: env.ddb.sessions,
      Key: { appointmentId },
    }),
  );
  return (res.Item as SessionState) ?? null;
}

export async function ddbPutSession(session: SessionState): Promise<void> {
  await getClient().send(
    new PutCommand({ TableName: env.ddb.sessions, Item: session }),
  );
}

// ---------- Q&A interactions ----------
// Table key schema: HASH(appointmentId), RANGE(askedAt).

export async function ddbListInteractions(
  appointmentId: string,
): Promise<QAInteraction[]> {
  const res = await getClient().send(
    new QueryCommand({
      TableName: env.ddb.qa,
      KeyConditionExpression: "appointmentId = :a",
      ExpressionAttributeValues: { ":a": appointmentId },
    }),
  );
  return (res.Items as QAInteraction[]) ?? [];
}

export async function ddbPutInteraction(
  interaction: QAInteraction,
): Promise<void> {
  await getClient().send(
    new PutCommand({ TableName: env.ddb.qa, Item: interaction }),
  );
}

// ---------- Pending bookings ----------
// Keyed by `id`. Optional `ttl` attribute (Unix seconds) lets DynamoDB
// auto-expire unfinalized rows after the Checkout Session lapses.

export async function ddbGetPendingBooking(
  id: string,
): Promise<PendingBooking | null> {
  const res = await getClient().send(
    new GetCommand({ TableName: env.ddb.pendingBookings, Key: { id } }),
  );
  return (res.Item as PendingBooking) ?? null;
}

export async function ddbPutPendingBooking(
  booking: PendingBooking,
): Promise<void> {
  // Stripe Checkout Sessions expire 24h after creation; align the TTL so
  // unfinalized rows don't linger in the table.
  const ttl = Math.floor(Date.now() / 1000) + 48 * 3600;
  await getClient().send(
    new PutCommand({
      TableName: env.ddb.pendingBookings,
      Item: { ...booking, ttl },
    }),
  );
}

// ---------- Intake progress ----------

export async function ddbGetIntakeProgress(
  clientId: string,
): Promise<IntakeProgress | null> {
  const res = await getClient().send(
    new GetCommand({ TableName: env.ddb.intake, Key: { clientId } }),
  );
  return (res.Item as IntakeProgress) ?? null;
}

export async function ddbPutIntakeProgress(
  progress: IntakeProgress,
): Promise<void> {
  await getClient().send(
    new PutCommand({ TableName: env.ddb.intake, Item: progress }),
  );
}

// ---------- Tenants ----------

export async function ddbGetTenant(id: string): Promise<Tenant | null> {
  const res = await getClient().send(
    new GetCommand({ TableName: "tinyfish_tenants", Key: { id } }),
  );
  return (res.Item as Tenant) ?? null;
}

export async function ddbPutTenant(t: Tenant): Promise<void> {
  await getClient().send(
    new PutCommand({ TableName: "tinyfish_tenants", Item: t }),
  );
}

// ---------- Users (clients + providers) ----------
//
// Single table: env.ddb.users. Partition key `id`. Role-discriminated via
// the `role` attribute. Expected GSIs for production:
//   - email-index: HASH(email)                 — lookup on sign-in
//   - tenantId-role-index: HASH(tenantId), RANGE(role)   — list providers per tenant
// Scan fallbacks handle dev/local where GSIs aren't provisioned.

export async function ddbGetUser(id: string): Promise<UserRecord | null> {
  const res = await getClient().send(
    new GetCommand({ TableName: env.ddb.users, Key: { id } }),
  );
  return (res.Item as UserRecord) ?? null;
}

export async function ddbGetUserByEmail(
  email: string,
): Promise<UserRecord | null> {
  const normalized = email.trim().toLowerCase();
  try {
    const res = await getClient().send(
      new QueryCommand({
        TableName: env.ddb.users,
        IndexName: "email-index",
        KeyConditionExpression: "email = :e",
        ExpressionAttributeValues: { ":e": normalized },
        Limit: 1,
      }),
    );
    const items = (res.Items as UserRecord[]) ?? [];
    return items[0] ?? null;
  } catch {
    const res = await getClient().send(
      new ScanCommand({
        TableName: env.ddb.users,
        FilterExpression: "email = :e",
        ExpressionAttributeValues: { ":e": normalized },
      }),
    );
    const items = (res.Items as UserRecord[]) ?? [];
    return items[0] ?? null;
  }
}

export async function ddbPutUser(rec: UserRecord): Promise<void> {
  await getClient().send(
    new PutCommand({ TableName: env.ddb.users, Item: rec }),
  );
}

// Set (or clear) the client's current therapist. Guarded so it can only
// touch client rows — never overwrites a provider's profile.
export async function ddbSetClientCurrentProvider(
  clientId: string,
  providerId: string | null,
): Promise<void> {
  await getClient().send(
    new UpdateCommand({
      TableName: env.ddb.users,
      Key: { id: clientId },
      UpdateExpression: "SET currentProviderId = :pid",
      ConditionExpression: "attribute_exists(id) AND #role = :client",
      ExpressionAttributeNames: { "#role": "role" },
      ExpressionAttributeValues: { ":pid": providerId, ":client": "client" },
    }),
  );
}

// Upsert on sign-in: create the row if missing (using `defaults`), otherwise
// just refresh `lastSignInAt`. Does not clobber existing provider profile.
export async function ddbTouchSignIn(
  id: string,
  defaults: UserRecord,
): Promise<void> {
  const now = new Date().toISOString();
  const baseAttrs: Record<string, unknown> = {
    ":email": defaults.email,
    ":role": defaults.role,
    ":tenantId": defaults.tenantId,
    ":createdAt": defaults.createdAt,
    ":now": now,
  };
  // Provider defaults include the Therapist profile fields; seed them on
  // first sign-in via if_not_exists so subsequent sign-ins don't overwrite
  // profile edits the provider made via /provider/onboarding.
  const sets: string[] = [
    "email = if_not_exists(email, :email)",
    "#role = if_not_exists(#role, :role)",
    "tenantId = if_not_exists(tenantId, :tenantId)",
    "createdAt = if_not_exists(createdAt, :createdAt)",
    "lastSignInAt = :now",
  ];
  const names: Record<string, string> = { "#role": "role" };

  if (defaults.role === "provider") {
    const p = defaults as ProviderUserRecord;
    const seed: Record<string, unknown> = {
      ":status": p.status,
      ":name": p.name,
      ":pronouns": p.pronouns,
      ":gender": p.gender,
      ":specialties": p.specialties,
      ":modalities": p.modalities,
      ":bio": p.bio,
      ":nextAvailable": p.nextAvailable,
      ":sessionFormats": p.sessionFormats,
      ":ratePerSessionCents": p.ratePerSessionCents,
    };
    Object.assign(baseAttrs, seed);
    names["#status"] = "status";
    names["#name"] = "name";
    sets.push(
      "#status = if_not_exists(#status, :status)",
      "#name = if_not_exists(#name, :name)",
      "pronouns = if_not_exists(pronouns, :pronouns)",
      "gender = if_not_exists(gender, :gender)",
      "specialties = if_not_exists(specialties, :specialties)",
      "modalities = if_not_exists(modalities, :modalities)",
      "bio = if_not_exists(bio, :bio)",
      "nextAvailable = if_not_exists(nextAvailable, :nextAvailable)",
      "sessionFormats = if_not_exists(sessionFormats, :sessionFormats)",
      "ratePerSessionCents = if_not_exists(ratePerSessionCents, :ratePerSessionCents)",
    );
  }

  await getClient().send(
    new UpdateCommand({
      TableName: env.ddb.users,
      Key: { id },
      UpdateExpression: "SET " + sets.join(", "),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: baseAttrs,
    }),
  );
}

// Provider profile patch via UpdateCommand. Only sets the fields present
// in `patch` so we don't clobber unrelated attributes (e.g. lastSignInAt).
export async function ddbUpdateProviderProfile(
  id: string,
  patch: Partial<Therapist>,
): Promise<ProviderUserRecord> {
  const sets: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  let i = 0;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const nk = `#k${i}`;
    const vk = `:v${i}`;
    names[nk] = k;
    values[vk] = v;
    sets.push(`${nk} = ${vk}`);
    i++;
  }
  if (sets.length === 0) {
    const existing = await ddbGetUser(id);
    if (!existing || existing.role !== "provider") {
      throw new Error(`Provider ${id} not found`);
    }
    return existing;
  }
  const res = await getClient().send(
    new UpdateCommand({
      TableName: env.ddb.users,
      Key: { id },
      UpdateExpression: "SET " + sets.join(", "),
      ExpressionAttributeNames: { ...names, "#role": "role" },
      ExpressionAttributeValues: { ...values, ":provider": "provider" },
      ConditionExpression: "attribute_exists(id) AND #role = :provider",
      ReturnValues: "ALL_NEW",
    }),
  );
  return res.Attributes as ProviderUserRecord;
}

export async function ddbListProvidersForTenant(
  tenantId: string,
): Promise<ProviderUserRecord[]> {
  try {
    const res = await getClient().send(
      new QueryCommand({
        TableName: env.ddb.users,
        IndexName: "tenantId-role-index",
        KeyConditionExpression: "tenantId = :t AND #role = :r",
        ExpressionAttributeNames: { "#role": "role" },
        ExpressionAttributeValues: { ":t": tenantId, ":r": "provider" },
      }),
    );
    return (res.Items as ProviderUserRecord[]) ?? [];
  } catch {
    const res = await getClient().send(
      new ScanCommand({
        TableName: env.ddb.users,
        FilterExpression: "tenantId = :t AND #role = :r",
        ExpressionAttributeNames: { "#role": "role" },
        ExpressionAttributeValues: { ":t": tenantId, ":r": "provider" },
      }),
    );
    return (res.Items as ProviderUserRecord[]) ?? [];
  }
}

export async function ddbListAllProviders(): Promise<ProviderUserRecord[]> {
  const res = await getClient().send(
    new ScanCommand({
      TableName: env.ddb.users,
      FilterExpression: "#role = :r",
      ExpressionAttributeNames: { "#role": "role" },
      ExpressionAttributeValues: { ":r": "provider" },
    }),
  );
  return (res.Items as ProviderUserRecord[]) ?? [];
}

// ---------- Resources ----------

export async function ddbPutResource(r: TherapistResource): Promise<void> {
  await getClient().send(
    new PutCommand({ TableName: requireTable(env.ddb.resources, "DDB_TABLE_RESOURCES"), Item: r }),
  );
}

export async function ddbGetResource(
  id: string,
): Promise<TherapistResource | null> {
  const res = await getClient().send(
    new GetCommand({ TableName: requireTable(env.ddb.resources, "DDB_TABLE_RESOURCES"), Key: { id } }),
  );
  return (res.Item as TherapistResource) ?? null;
}

export async function ddbDeleteResource(id: string): Promise<void> {
  await getClient().send(
    new DeleteCommand({ TableName: requireTable(env.ddb.resources, "DDB_TABLE_RESOURCES"), Key: { id } }),
  );
}

export async function ddbListResourcesForProvider(
  providerId: string,
): Promise<TherapistResource[]> {
  try {
    const res = await getClient().send(
      new QueryCommand({
        TableName: requireTable(env.ddb.resources, "DDB_TABLE_RESOURCES"),
        IndexName: "providerId-createdAt-index",
        KeyConditionExpression: "providerId = :p",
        ExpressionAttributeValues: { ":p": providerId },
        ScanIndexForward: false,
      }),
    );
    return (res.Items as TherapistResource[]) ?? [];
  } catch {
    const res = await getClient().send(
      new ScanCommand({
        TableName: requireTable(env.ddb.resources, "DDB_TABLE_RESOURCES"),
        FilterExpression: "providerId = :p",
        ExpressionAttributeValues: { ":p": providerId },
      }),
    );
    return ((res.Items as TherapistResource[]) ?? []).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }
}

export async function ddbListResourcesForTenant(
  tenantId: string,
): Promise<TherapistResource[]> {
  try {
    const res = await getClient().send(
      new QueryCommand({
        TableName: requireTable(env.ddb.resources, "DDB_TABLE_RESOURCES"),
        IndexName: "tenantId-createdAt-index",
        KeyConditionExpression: "tenantId = :t",
        ExpressionAttributeValues: { ":t": tenantId },
        ScanIndexForward: false,
      }),
    );
    return (res.Items as TherapistResource[]) ?? [];
  } catch {
    const res = await getClient().send(
      new ScanCommand({
        TableName: requireTable(env.ddb.resources, "DDB_TABLE_RESOURCES"),
        FilterExpression: "tenantId = :t",
        ExpressionAttributeValues: { ":t": tenantId },
      }),
    );
    return ((res.Items as TherapistResource[]) ?? []).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }
}
