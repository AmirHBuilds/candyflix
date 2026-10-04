/** "Amir" -> "Amir Box". Uses the first word of the display name so long names stay tidy. */
export const DEFAULT_BOX_NAME = "Candy Box";

export function boxNameFor(displayName: string | null | undefined): string {
  const first = (displayName ?? "").trim().split(/\s+/)[0];
  return first ? `${first} Box` : DEFAULT_BOX_NAME;
}
