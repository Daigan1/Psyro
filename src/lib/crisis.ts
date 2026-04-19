const CRISIS_KEYWORDS = [
  "suicide",
  "suicidal",
  "kill myself",
  "end my life",
  "hurt myself",
  "self-harm",
  "self harm",
  "want to die",
  "dont want to live",
  "don't want to live",
];

export const CRISIS_RESOURCES = [
  { label: "988 Suicide & Crisis Lifeline", number: "988" },
  { label: "Crisis Text Line", number: "Text HOME to 741741" },
  { label: "Emergency services", number: "911" },
];

// Keyword screen — cheap, conservative, not a substitute for a trained classifier.
// Real implementation: route through Bedrock with a safety-tuned prompt + escalation policy.
export function screenForCrisis(input: {
  imminentHarm: boolean;
  description: string;
  notes?: string;
}): boolean {
  if (input.imminentHarm) return true;
  const text = `${input.description} ${input.notes ?? ""}`.toLowerCase();
  return CRISIS_KEYWORDS.some((kw) => text.includes(kw));
}
