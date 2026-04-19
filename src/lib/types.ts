export type Gender = "male" | "female" | "nonbinary" | "no-preference";

export type SessionFormat = "video" | "audio" | "either";

export type IntakeInput = {
  // Display name used in video sessions and on the dashboard. Captured
  // during intake so neither the client nor the therapist has to type
  // their name into the Daily preview screen on every call.
  personalInfo: {
    name: string;
  };
  crisis: {
    imminentHarm: boolean;
    notes?: string;
  };
  problems: {
    description: string;
    tags: string[];
  };
  preferences: {
    therapistGender: Gender;
    modalities: string[];
    format: SessionFormat;
  };
};

export type ProviderStatus = "active" | "suspended";

export type Therapist = {
  id: string;
  email: string;
  status: ProviderStatus;
  name: string;
  pronouns: string;
  gender: Exclude<Gender, "no-preference">;
  specialties: string[];
  modalities: string[];
  bio: string;
  nextAvailable: string;
  sessionFormats: Exclude<SessionFormat, "either">[];
  weeklyAvailability?: WeeklyAvailability;
  // Self-pay rate in cents (USD). Provider sets this; Stripe Checkout charges it.
  ratePerSessionCents: number;
};

export type Match = {
  therapist: Therapist;
  score: number;
  reasoning: string;
  isTopChoice: boolean;
};

export type AppointmentStatus =
  | "scheduled"
  | "in-progress"
  | "completed"
  | "no-show"
  | "late-cancel"
  | "cancelled"
  | "tech-failure";

export type Appointment = {
  id: string;
  clientId: string;
  clientEmail: string;
  providerId: string;
  providerName: string;
  providerEmail: string;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  format: Exclude<SessionFormat, "either">;
  createdAt: string;
  // Payment details captured at booking from the Stripe Checkout Session.
  pricePaidCents: number;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
};

// UserRecord is the persisted auth+profile record in tinyfish_users,
// role-discriminated. Partition key: `id`. GSI: email-index (on `email`).
export type ClientUserRecord = {
  id: string;
  email: string;
  role: "client";
  createdAt: string;
  lastSignInAt: string;
  // Last therapist the client booked with (or chose explicitly via Settings).
  // Null = no therapist selected yet. Surfaced in the topbar / dashboard so
  // the client always knows who their current provider is and can switch.
  currentProviderId?: string | null;
};

export type ProviderUserRecord = Therapist & {
  role: "provider";
  createdAt: string;
  lastSignInAt: string;
};

export type UserRecord = ClientUserRecord | ProviderUserRecord;

export type ParticipantRole = "client" | "provider";

export type SessionEndReason =
  | "completed"
  | "tech-failure"
  | "cancelled"
  | "no-consent";

export type ResourceKind = "url" | "text";

export type ResourceStatus = "ingested" | "pending" | "failed";

export type ResourceChunk = {
  id: string;
  resourceId: string;
  index: number;
  text: string;
};

export type TherapistResource = {
  id: string;
  providerId: string;
  kind: ResourceKind;
  title: string;
  source: string | null;
  status: ResourceStatus;
  failureReason: string | null;
  extractedText: string;
  chunks: ResourceChunk[];
  createdAt: string;
  // Per-client visibility. Empty / missing array = visible to ALL of the
  // therapist's clients. Populated array = scoped to those specific
  // clientIds. Used by qa-retrieval and the search_my_resources tool to
  // filter what each client can see.
  clientIds?: string[];
};

export type QACitation = {
  source: string;
  sourceId: string;
  quote: string;
  // Present only for transcript citations on artifacts that have Whisper
  // segments. Lets the QnA panel render a clickable "listen back" link.
  timestamp?: number; // seconds into the recording
  humanTimestamp?: string; // "0:42" style, ready to render
  replayUrl?: string; // e.g. "/sessions/abc?t=42" (audio + transcript live on the session page)
};

export type QAInteraction = {
  id: string;
  appointmentId: string;
  clientId: string;
  question: string;
  answer: string;
  citations: QACitation[];
  askedAt: string;
};

export type DraftSummary = {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  followUps: string[];
};

export type ReviewStatus =
  | "pending-transcript-review"
  | "pending-summary-review"
  | "approved"
  | "rejected";

// Word/segment-level timestamps from STT. Surfaces in citations so the
// ElevenLabs Q&A agent can deep-link the user back to a specific moment
// in the recording. Empty when transcription comes from a source without
// timestamps.
export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

export type SessionArtifact = {
  appointmentId: string;
  providerId: string;
  clientId: string;
  transcriptRaw: string;
  transcriptEdited: string | null;
  transcriptSegments: TranscriptSegment[];
  summaryDraft: DraftSummary | null;
  summaryFinal: DraftSummary | null;
  reviewStatus: ReviewStatus;
  rejectionNote: string | null;
  transcribedAt: string;
  summarizedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
};

export type SessionState = {
  appointmentId: string;
  // Consent from both parties is required before a video meeting is created.
  consent: { client: string | null; provider: string | null };
  // One of the parties refused — blocks meeting creation permanently.
  refused: { by: ParticipantRole; at: string } | null;
  // Daily.co room id (also kept for back-compat with old "meeting id" callers).
  meetingId: string | null;
  // The clickable Daily room URL that the iframe loads. Populated alongside
  // meetingId. Null until both parties consent.
  meetingUrl: string | null;
  // Daily access link to the post-call MP4 recording. Set once the recording
  // is ready (Daily encodes asynchronously after the call ends).
  recordingUrl: string | null;
  joined: { client: string | null; provider: string | null };
  endedAt: string | null;
  endReason: SessionEndReason | null;
};

export type AvailabilitySlot = {
  providerId: string;
  startTime: string;
  endTime: string;
};

// Weekly recurring availability. Key is day-of-week (0=Sun..6=Sat, UTC),
// value is the list of start hours (0-23 UTC) the provider accepts on that day.
// Each hour seeds a single 50-minute slot, matching the existing booking window.
export type WeeklyAvailability = {
  [dayOfWeek: number]: number[];
};

export type PendingBooking = {
  id: string;
  providerId: string;
  providerName: string;
  providerEmail: string;
  clientId: string;
  clientEmail: string;
  startTime: string;
  endTime: string;
  format: Exclude<SessionFormat, "either">;
  amountCents: number;
  createdAt: string;
  appointmentId: string | null;
  checkoutSessionId: string | null;
};

export type IntakeProgress = {
  clientId: string;
  data: IntakeInput;
  step: number;
  completed: boolean;
  completedAt: string | null;
  matchResult: MatchResult | null;
};

export type MatchResult =
  | {
      kind: "matches";
      matches: Match[];
      topChoiceId: string | null;
    }
  | {
      kind: "crisis";
      hotline: { label: string; number: string }[];
      message: string;
    }
  | {
      kind: "no-matches";
      reason: string;
    };
