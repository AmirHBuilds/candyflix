/** The age limits an admin can give an account (the highest rating they may watch). */
export type AgeLimit = "G" | "PG" | "PG-13" | "R";

export const AGE_LIMITS: { value: AgeLimit; label: string }[] = [
  { value: "G", label: "G: all ages (TV-Y, TV-G)" },
  { value: "PG", label: "PG (TV-PG)" },
  { value: "PG-13", label: "PG-13: 13 and up (TV-14)" },
  { value: "R", label: "R: 17 and up (TV-MA)" },
];
