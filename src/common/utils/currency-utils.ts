import { CurrencyType, CurrencyTypeText } from 'src/enums/currency.enum';

/**
 * Formats a currency type enum value into its human-readable text representation.
 * Validates against the CurrencyType enum and returns a sentinel value for invalid types.
 * 
 * @param currencyType - The currency type enum value (e.g., 'gold_coins', 'sweep_coins')
 * @returns The formatted currency text ('Gold Coins', 'Stream Coins') or 'UNKNOWN_CURRENCY' for invalid values
 * 
 * @example
 * formatCurrencyType('gold_coins') // returns 'Gold Coins'
 * formatCurrencyType('sweep_coins') // returns 'Stream Coins'
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
  return 'UNKNOWN_CURRENCY';
}
