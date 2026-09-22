export function authorize(user: string, role: string): boolean {
  return user.length > 0 && role === "admin";
}

export const authVersion = "v1";
