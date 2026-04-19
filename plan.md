# TinyFish Mental Health Platform — System Plan

## 1. Overview

**Goal:**  
Build a mental health platform that combines:

- Therapist discovery (like Zocdoc)
- Online therapy experience (like BetterHelp)
- AI-native workflow (transcripts, summaries, Q&A, resource grounding)

**Core Idea:**  
The therapist remains the authority. AI augments:
- Discovery: Finding the best therapist for the client
- Documentation / Follow-Up: automatially recording calls and allowing the user to query questions about the call. Microsoft teams and YouTube has this feature make it identical.

**Key Principle:**  
No AI-generated content is shown to the client without therapist review and approval.

---

## 2. Core Product Capabilities

### 2.1 Therapist Matching
- Uses AWS Bedrock to:
  - Rank therapists based on:
    - Client-described problems
    - Preferences (gender, modality, etc.)
    - Insurance compatibility
    - Availability
- Outputs:
  - Ranked therapist list
  - Structured reasoning (why each therapist fits)
  - Recommend a "top choice" based on the AWS Bedrock reasoning.

---

### 2.2 Booking & Scheduling
- Clients:
  - View availability
  - Book / reschedule / cancel
- System:
  - Sends reminders via:
    - AWS SES (email)
    - SMS via AWS messaging

---

### 2.3 Video Sessions
- Uses Amazon Chime SDK
- Features:
  - Join session (client + provider)
  - Session lifecycle:
    - Created → Joined → Active → Ended

---

### 2.4 AI Transcription & Analysis

#### Transcription (ElevenLabs audio transcription)
- Entire session audio → transcript
- Therapist can edit, review, and submit the transcript after the call.

#### Analysis (ElevenAgents)
- Generate:
  - Draft session summary
  - Key discussion points
  - Action items
  - Suggested follow-ups

#### Critical Constraint:
- Output goes to therapist review queue
- Therapist can:
  - Edit
  - Approve
  - Reject

---

### 2.5 Post-Session AI Q&A

After approval:

Client can:
- Ask questions about the session
- Input:
  - Text OR voice

System:
- Uses ElevenAgents + retrieval
- Answers using ONLY:
  - Approved transcript
  - Approved summary
  - Therapist-provided resources

Voice:
- Answer read aloud using ElevenLabs

---

### 2.6 Therapist Resource System (TinyFish Agents)

Therapists can attach:
- PDFs
- Website links

TinyFish agents:
1. Fetch content
2. Extract text
3. Clean + normalize
4. Chunk into embeddings
5. Store for retrieval

Used in:
- Post-session Q&A grounding

---

## 3. User Roles

### 3.1 Client
- Signs up
- Describes problems
- Provides insurance
- Selects therapist
- Attends sessions
- Views summaries
- Asks follow-up questions

---

### 3.2 Therapist
- Signs up directly with their own email (Cognito email code)
- Creates profile:
  - Specialties
  - Insurance accepted
  - Availability
- Conducts sessions
- Reviews AI-generated notes
- Uploads resources

---

## 4. Frontend Structure (Next.js)

### 4.1 Client App

#### Authentication
- Cognito login/signup -> email codes, no passwords

#### Intake Flow for Client
1. Describe problems
2. Set preferences
3. Enter insurance info

#### Matching Page
- Shows ranked therapists
- Explains match reasoning

#### Booking
- Select time
- Confirm appointment

#### Main Dashboard
- Upcoming appointments
- Join session
- Past sessions

#### Session Summary Page
- View therapist-approved summary
- Ask AI questions:
  - Text input
  - Voice input
- Hear answers (TTS)

---

### 4.2 Provider App

#### Onboarding
- Sign up with email (Cognito email code)
- Setup:
  - Specialties
  - Insurance
  - Availability

#### Dashboard
- Upcoming appointments
- Join sessions

#### Post-Session Review by the Therapist
- View transcript
- Review AI summary
- Edit / approve

#### Resource Manager by the Therapist
- Upload PDF
- Add URL
- Manage resources

---

## 5. Backend Architecture

### 5.1 Authentication
- AWS Cognito
- Handles:
  - Users
  - Roles
  - Sessions

---

### 5.2 Core Services

#### User Service
- Client + provider profiles

#### Therapist Directory Service
- Search + filtering

#### Insurance Service
- Stores insurance info
- Maps therapist compatibility

#### Scheduling Service
- Availability
- Bookings

#### Session Service
- Chime meeting creation
- Join tokens

---

### 5.3 AI Services

#### Matching Service
- Uses Bedrock
- Input: client profile
- Output: ranked therapists

#### Transcription Service
- Stores:
  - Raw transcript
- Enforces:
  - Consent rules

#### Summary Service
- Uses ElevenAgents
- Produces:
  - Draft summary
- Sends to therapist for approval

#### Q&A Service
- Retrieval pipeline using ElevenAgents platform:
  - Transcript
  - Summary
  - Resources
- Generates grounded answers

#### Voice Service
- Speech-to-text (input)
- Text-to-speech (output)

---

### 5.4 Resource Ingestion Service
- Runs TinyFish agents
- Handles:
  - PDFs
  - URLs
- Outputs:
  - Indexed text chunks

---

### 5.5 Notification Service
- Email + SMS reminders
- Appointment lifecycle notifications

---

## 6. Data Model (Core Entities)
Use an AWS db system: dynamodb is a good choice.

### User
- id
- role (client/provider)
- auth_id (Cognito)

### Client Profile
- preferences
- therapy goals
- insurance info
- Appointments

### Provider Profile
- specialties
- insurance accepted
- availability / calender

### Appointment
- client_id
- provider_id
- start_time
- status

### Session Artifact
- transcript
- summary_draft
- summary_final
- review_status

### Therapist Resource
- type (pdf/url)
- extracted_text
- metadata

### Q&A Interaction
- question
- answer
- sources_used

---

## 7. AI Rules

### Hard Constraints
- AI cannot diagnose or prescribe
- AI must be grounded in approved data
- AI must defer when uncertain

### Summary Rules
- Must reflect transcript only
- Must be editable by therapist
- Must not introduce new facts

### Q&A Rules
- Must cite transcript or resources
- If unknown, say so
- For sensitive topics, escalate to therapist

---

## 8. Security & Compliance

### Requirements
- Encryption (in transit + at rest)
- Role-based access control
- Audit logging

### Consent
- Required for recording/transcription

### Data Handling
- Sensitive health data protections
- Therapist approval = trust boundary

---

## 9. Core System Loop

1. Client signs up  
2. Client describes needs  
3. System recommends therapist  
4. Client books appointment  
5. Session occurs (video)  
6. Transcript generated  
7. AI creates draft summary  
8. Therapist reviews + approves  
9. Client receives summary  
10. Client asks follow-up questions  

---

## 10. Key Differentiators

- Therapist-in-the-loop AI
- Grounded Q&A using real session + resources
- Unified experience (discovery → booking → session → follow-up)
- Resource ingestion via TinyFish agents


## 12. One-Line Definition

A Next.js-based therapy platform using Cognito auth, Chime video sessions, Bedrock matching, ElevenLabs AI, and TinyFish agents, with therapist-reviewed summaries as the core trust layer.

Psilo