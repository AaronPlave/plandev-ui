/**
 * Splits a read-only value into segments at the places where it may wrap: after `/`, `_`, `;`, after `-` that
 * follows a letter, after `.` between an alphanumeric and a letter (file extensions), and after the `T` of an ISO/DOY
 * timestamp. Numbers (`3.141`, `-0.40`) and timestamps' digits are never split.
 *
 * The segments are joined with `<wbr>` when rendered, so the copied text is unchanged.
 */
export function softBreakSegments(text: string): string[] {
  if (text.length < 8) {
    return [text];
  }
  return text.split(/(?<=[/_;])|(?<=[A-Za-z]-)(?=\w)|(?<=\w\.)(?=[A-Za-z])|(?<=\dT)(?=\d)/).filter(s => s.length > 0);
}

/** Splits an identifier at camelCase boundaries (`primitiveDouble` → `primitive`, `Double`) so labels wrap sensibly. */
export function camelCaseSegments(text: string): string[] {
  return text.split(/(?<=[a-z0-9])(?=[A-Z])/).filter(s => s.length > 0);
}
