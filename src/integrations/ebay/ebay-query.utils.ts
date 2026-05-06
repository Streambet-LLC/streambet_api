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

/**
 * Extract PSA grade from an item title.
 * Handles formats like "PSA 10", "PSA NM-MT 8", "PSA GEM-MT 10", etc.
 * Returns normalized format "PSA {number}" or null if no PSA grade found.
 * 
 * @example
 * extractPsaGradeFromItemTitle("1997 Charizard PSA NM-MT 8") // "PSA 8"
 * extractPsaGradeFromItemTitle("1997 Charizard PSA 10") // "PSA 10"
 * extractPsaGradeFromItemTitle("1997 Charizard Raw") // null
 */
export function extractPsaGradeFromItemTitle(title: string): string | null {
  if (!title) return null;

  // Pattern to match PSA followed by optional condition abbreviation and grade number
  const psaPattern = new RegExp(
    `\\b(PSA)\\s+(?:(?:${PSA_GRADE_ABBREVIATIONS.map(token => token.replace('-', '\\-')).join('|')})\\s+)?(\\d{1,2}(?:\\.\\d+)?)\\b`,
    'i',
  );

  const match = title.match(psaPattern);
  if (match) {
    const grader = match[1].toUpperCase();
    const grade = match[2];
    return `${grader} ${grade}`;
  }

  return null;
}

/**
 * Compare two PSA grade strings for equality.
 * Case-insensitive comparison.
 * 
 * @example
 * psaGradesMatch("PSA 10", "PSA 10") // true
 * psaGradesMatch("PSA 10", "psa 10") // true
 * psaGradesMatch("PSA 10", "PSA 9") // false
 * psaGradesMatch("PSA 10", null) // false
 */
export function psaGradesMatch(grade1: string | null, grade2: string | null): boolean {
  if (!grade1 || !grade2) return false;
  return grade1.toLowerCase().trim() === grade2.toLowerCase().trim();
}

/**
 * Extract card number from an item title.
 * Handles formats like "#94", "# 94", "No. 94", "Number 94", "#94/132", etc.
 * Returns normalized number as string (without leading zeros) or null if no card number found.
 * For sets with multiple numbers (e.g., "#94/132"), extracts only the first number.
 * 
 * @example
 * extractCardNumberFromTitle("Pokemon Gengar #94") // "94"
 * extractCardNumberFromTitle("Pokemon Gengar # 94") // "94"
 * extractCardNumberFromTitle("Pokemon Gengar #094") // "94"
 * extractCardNumberFromTitle("Pokemon Gengar No. 94") // "94"
 * extractCardNumberFromTitle("Pokemon Gengar Number 94") // "94"
 * extractCardNumberFromTitle("Pokemon Gengar #94/132") // "94"
 * extractCardNumberFromTitle("Pokemon Gengar") // null
 */
export function extractCardNumberFromTitle(title: string): string | null {
  if (!title) return null;

  // Pattern to match:
  // - #94, # 94, #094
  // - No. 94, No.94
  // - Number 94, Number94
  // - Handles #94/132 format (extracts first number only)
  const cardNumberPattern = /(?:#|No\.|Number)\s*(\d+)(?:\/\d+)?/i;

  const match = title.match(cardNumberPattern);
  if (match) {
    // Remove leading zeros and return as string
    const cardNumber = parseInt(match[1], 10).toString();
    return cardNumber;
  }

  return null;
}

/**
 * Compare two card numbers for equality.
 * Handles leading zeros by normalizing both numbers.
 * 
 * @example
 * cardNumbersMatch("94", "94") // true
 * cardNumbersMatch("94", "094") // true
 * cardNumbersMatch("94", "5") // false
 * cardNumbersMatch("94", null) // false
 */
export function cardNumbersMatch(number1: string | null, number2: string | null): boolean {
  if (!number1 || !number2) return false;
  
  // Normalize by removing leading zeros
  const normalized1 = parseInt(number1, 10).toString();
  const normalized2 = parseInt(number2, 10).toString();
  
  return normalized1 === normalized2;
}

/**
 * Extract 4-digit year from an item title.
 * Returns the year as a string or null if no year found.
 * Looks for years in the typical range for trading cards (1900-2099).
 * 
 * @example
 * extractYearFromTitle("1997 Pokemon Fossil Gengar #94") // "1997"
 * extractYearFromTitle("1999 Pokemon Gym 2 Sabrina's Gengar") // "1999"
 * extractYearFromTitle("Pokemon Gengar #94") // null
 */
export function extractYearFromTitle(title: string): string | null {
  if (!title) return null;

  // Pattern to match 4-digit year (19xx or 20xx)
  const yearPattern = /\b(19\d{2}|20\d{2})\b/;

  const match = title.match(yearPattern);
  if (match) {
    return match[1];
  }

  return null;
}

/**
 * Compare two year strings for equality.
 * 
 * @example
 * yearsMatch("1997", "1997") // true
 * yearsMatch("1997", "1999") // false
 * yearsMatch("1997", null) // false
 */
export function yearsMatch(year1: string | null, year2: string | null): boolean {
  if (!year1 || !year2) return false;
  return year1 === year2;
}
