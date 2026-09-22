import { authorize } from "./auth.js";

export function charge(user: string, role: string, amount: number): number {
  if (!authorize(user, role)) throw new Error("forbidden");
  return amount;
}
