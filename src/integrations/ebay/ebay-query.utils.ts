const PSA_GRADE_ABBREVIATIONS = [
  'GEM-MT',
  'MINT',
  'NM-MT',
  'NM',
  'EX-MT',
  'EX',
  'VG-EX',
  'VG',
  'GOOD',
  'FR',
  'PR',
] as const;

const PSA_GRADE_PATTERN = new RegExp(
  `\\b(PSA)\\s+(?:${PSA_GRADE_ABBREVIATIONS.map(token => token.replace('-', '\\-')).join('|')})\\s+(\\d{1,2}(?:\\.\\d+)?)\\b`,
  'gi',
);

/**
 * Remove PSA condition abbreviations when they appear between "PSA" and a grade number.
 * Example: "PSA NM-MT 8 ..." -> "PSA 8 ..."
 */
export function normalizeEbaySearchKeywords(keywords: string): string {
  const trimmed = keywords.trim();
  if (!trimmed) {
    return '';
  }

  return trimmed.replace(PSA_GRADE_PATTERN, '$1 $2').replace(/\s{2,}/g, ' ');
}
