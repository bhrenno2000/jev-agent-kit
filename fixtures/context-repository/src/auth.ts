export function requireAuth(token: string | undefined): boolean {
  return Boolean(token && token.startsWith("Bearer "));
}
