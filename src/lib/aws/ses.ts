// Server-only: never import from a "use client" module.
// AWS SES sender. Invoked only when USE_AWS=true from notifications.ts.

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { env } from "../env";

let client: SESClient | null = null;
function getClient(): SESClient {
  if (!client) client = new SESClient({ region: env.awsRegion });
  return client;
}

export async function sendSesEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  if (!env.ses.from) {
    throw new Error("SES_FROM_ADDRESS is required when USE_AWS=true.");
  }
  await getClient().send(
    new SendEmailCommand({
      Source: env.ses.from,
      Destination: { ToAddresses: [input.to] },
      Message: {
        Subject: { Data: input.subject, Charset: "UTF-8" },
        Body: {
          Html: { Data: input.html, Charset: "UTF-8" },
          Text: { Data: input.text, Charset: "UTF-8" },
        },
      },
    }),
  );
}
