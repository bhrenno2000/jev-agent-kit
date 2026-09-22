export function redactPassword(value: string): string {
  return value.replace(/password=[^&]*/g, "password=[redacted]");
}

export const redactionPolicy = "password values are always redacted";
