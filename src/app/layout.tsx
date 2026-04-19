import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { ElevenLabsWidget } from "./elevenlabs-widget";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "TinyFish — Therapy, with your therapist in the loop",
  description:
    "Therapist-led mental health platform with AI-assisted matching, session summaries, and grounded follow-up Q&A.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Only mount the floating widget for signed-in clients. Providers and
  // signed-out visitors don't have a `currentProviderId` or session
  // history, so the agent has nothing to draw on — and would just hammer
  // /api/eleven/signed-url for 401s.
  const session = await getCurrentUser();
  const showWidget = session?.role === "client";

  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {showWidget && <ElevenLabsWidget />}
      </body>
    </html>
  );
}
