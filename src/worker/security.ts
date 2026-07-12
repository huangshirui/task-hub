const encoder = new TextEncoder();

export async function hashRunnerCredential(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function verifyRunnerCredential(value: string, expectedHash: string): Promise<boolean> {
  const actualHash = await hashRunnerCredential(value);
  return constantTimeStringEqual(actualHash, expectedHash);
}

export function constantTimeStringEqual(actual: string, expected: string): boolean {
  const length = Math.max(actual.length, expected.length);
  let difference = actual.length ^ expected.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (actual.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export async function createAdminSocketTicket(
  secret: string,
  now = Date.now(),
  nonce = crypto.randomUUID(),
): Promise<{ ticket: string; expiresAt: string }> {
  const expiresAt = now + 60_000;
  const payload = `${expiresAt}.${nonce}`;
  const signature = await hmacHex(secret, payload);
  return { ticket: `${payload}.${signature}`, expiresAt: new Date(expiresAt).toISOString() };
}

export async function verifyAdminSocketTicket(secret: string, ticket: string, now = Date.now()): Promise<boolean> {
  const parts = ticket.split(".");
  if (parts.length !== 3 || !/^\d+$/.test(parts[0] as string) || !(parts[1] as string)) {
    return false;
  }
  const expiresAt = Number(parts[0]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < now) {
    return false;
  }
  const payload = `${parts[0]}.${parts[1]}`;
  return constantTimeStringEqual(await hmacHex(secret, payload), parts[2] as string);
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToHex(new Uint8Array(signature));
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
