Psyro is the next-generation of mental health treatment.


# The Problem: Telehealth is fragmented
- Finding a good patient / provider match is slow, awkward, and often comes down to guesswork
- Retaining information from sessions for future reference is left entirely to memory and scattered notes
- Old, difficult, and annoying user experiences not designed for modern times, leaving both clients and providers frustrated
- Supplemental materials recommended by therapists get lost in email threads and forgotten between sessions
- Insights from past conversations are trapped in individual calls, with no way to connect themes across a full treatment journey


# Feature Overview:
- Sign up as either a provider, or a client for mental health treatment
- Intake form for both parties includes detailed information about needs, preferences, and specialties
- Automatic matching of client with therapist based on compatibility, using intake responses to surface the strongest-fit providers first
- Billing system and calendar managed by provider, so scheduling, invoicing, and payments all live in one place
- Automatic recording of audio from call, including generated summary, transcript, next-steps, and action items, all approved by therapist before being seen by the client
- Ability to upload third-party, therapist approved resources to supplement and help clients with their issues, with automatic parsing so the content is searchable and referenceable
- Powerful, voice-powered A.I agent capable of ingesting all past meetings, and supplemental materials, to meaningfully answer client questions between sessions
- A.I agent trained on specific calls answering local questions from a call, so clients can revisit a single session and dig into exactly what was said
- Secure, federated login and account management so clients and providers can trust their data is handled properly


# Market + Oppertunity: 
- Telehealth is a massive market which is dominated by a few players with mixed reviews, and problems mentioned previously making them fragmented.
- Serviceable Addressable Market is in the *billions* and waiting to be tapped into.


# Tracks / Sponsors:
- TinyFish: retrieve and parse supplemental materials recommended by therapists, turning outside articles and resources into structured content the A.I agent can actually reason over
- ElevenLabs: speech-to-text, text-to-speech, tool-calling, and natural conversational agents allowing clients to remember the important details from many sessions, and gain deeper insights through real back-and-forth voice conversation
- Stripe: performant payment platform allowing users to pay for private therapy sessions from providers, with provider-managed billing that handles recurring appointments and one-off charges
- Featherless: Models help to answer localized questions about specific sessions, and give clients the best-fit providers based on their specific needs, powering both the matching engine and the per-session Q&A
- AWS: The cloud solution powering the future. Federated logins, email / sms services, and dynamodb for quick access support the platform, keeping auth, notifications, and session data fast and reliable


# Run Project
- Fill in .env.example with API Keys / Service Names (AWS)
- Run with `npm run dev`
- Build for production with `npm run build`