const encoder = new TextEncoder();

export async function hashRunnerCredential(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function verifyRunnerCredential(value: string, expectedHash: string): Promise<boolean> {
  const actualHash = await hashRunnerCredential(value);
  if (actualHash.length !== expectedHash.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < actualHash.length; index += 1) {
    difference |= actualHash.charCodeAt(index) ^ expectedHash.charCodeAt(index);
  }
  return difference === 0;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
