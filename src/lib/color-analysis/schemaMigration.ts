import { SeasonId } from './types';

/**
 * Maps legacy 4-season profiles securely to a default 16-season sub-palette.
 */
export function migrateLegacySeason(legacySeason: string): SeasonId {
  const normalized = legacySeason.toLowerCase().trim();

  switch (normalized) {
    case 'spring': return 'true_spring';
    case 'summer': return 'true_summer';
    case 'autumn': return 'true_autumn';
    case 'winter': return 'true_winter';
    default:
      // If it's already an exact 16-season ID match, pass it right through
      return normalized as SeasonId;
  }
}