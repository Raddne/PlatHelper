/** Return the CSS variable reference for a riven overall grade (S, A, B, C, D, F). */
export function gradeColor(grade: string): string {
  const base = grade.charAt(0);
  switch (base) {
    case "S":
      return "var(--grade-s)";
    case "A":
      return "var(--grade-a)";
    case "B":
      return "var(--grade-b)";
    case "C":
      return "var(--grade-c)";
    case "D":
      return "var(--grade-d)";
    case "F":
      return "var(--grade-f)";
    default:
      return "var(--grade-default)";
  }
}

/** Return a disposition star string for a given disposition value. */
export function dispoStars(dispo: number): string {
  if (dispo >= 1.3) return "●●●●●";
  if (dispo >= 1.1) return "●●●●○";
  if (dispo >= 0.9) return "●●●○○";
  if (dispo >= 0.7) return "●●○○○";
  return "●○○○○";
}
