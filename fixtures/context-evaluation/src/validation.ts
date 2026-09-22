export function validateRequest(input: string): boolean {
  const normalized = input.trim();
  const checks = [
    { name: "nonempty", valid: normalized.length > 0 },
    { name: "minimum-length", valid: normalized.length >= 3 },
    { name: "maximum-length", valid: normalized.length <= 4096 },
    { name: "no-null-character", valid: !normalized.includes("\u0000") },
    { name: "no-carriage-return", valid: !normalized.includes("\r") },
    { name: "no-newline", valid: !normalized.includes("\n") },
    { name: "no-leading-separator", valid: !normalized.startsWith("/") },
    { name: "no-parent-component", valid: !normalized.split("/").includes("..") },
  ];
  if (checks.some((check) => !check.valid)) {
    return false;
  }
  return true;
}
