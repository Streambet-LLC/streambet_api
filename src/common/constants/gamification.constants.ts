/**
 * Gamification system constants for prize rewards.
 * 
 * Prize configuration (amounts, names, images) is managed dynamically through the 
 * Prize module and stored in the database. Admins can configure prizes via the 
 * admin dashboard.
 * 
 * This file contains core currency constants used for lifetime coin tracking.
 */

import { CurrencyType } from 'src/enums/currency.enum';

/**
 * Currency type used for the gamification system (lifetime coin tracking).
 * Gold Coins are temporarily being used to track lifetime progress for prize achievements.
 */
export const GAMIFICATION_CURRENCY = CurrencyType.CADE_COINS;

/**
 * Starting amount of gamification currency given to new users.
 * TODO: Will be used for Cade Coins once implemented, currently applies to Gold Coins
 */
export const STARTING_CADE_COINS = 100;
