import { CurrencyType, CurrencyTypeText } from 'src/enums/currency.enum';

/**
 * Formats a currency type string into its human-readable text representation.
 * Validates against the CurrencyType enum and returns a sentinel value for invalid types.
 * Accepts any string input for flexibility with runtime data (e.g., from JSON parsing).
 * 
 * @param currencyType - The currency type string (should match CurrencyType enum values)
 * @returns The formatted currency text ('Gold Coins', 'Sweep Coins') or CurrencyTypeText.UNKNOWN_CURRENCY for invalid values
 * 
 * @example
 * formatCurrencyType(CurrencyType.GOLD_COINS) // returns 'Gold Coins'
 * formatCurrencyType(CurrencyType.SWEEP_COINS) // returns 'Sweep Coins'
 * formatCurrencyType('invalid') // returns 'UNKNOWN_CURRENCY'
 */
export function formatCurrencyType(currencyType: string): string {
  if (currencyType === CurrencyType.GOLD_COINS) {
    return CurrencyTypeText.GOLD_COINS_TEXT;
  }
  
  if (currencyType === CurrencyType.SWEEP_COINS) {
    return CurrencyTypeText.SWEEP_COINS_TEXT;
  }
  
  // Invalid or unrecognized currency type - return sentinel value
  // Caller should check for this value and log appropriate warnings with context
  return CurrencyTypeText.UNKNOWN_CURRENCY;
}
