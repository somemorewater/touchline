export type Id = string;
/** ISO 8601 timestamp, e.g. 2026-11-21T14:00:00+01:00 */
export type ISODateTime = string;
/** ISO 8601 calendar date, e.g. 2026-11-21 */
export type ISODate = string;

export interface Page<T> {
  items: T[];
  total: number;
}

/** A value that may be genuinely zero, or simply not recorded. Never coerce `unknown` to 0. */
export type Measured<T = number> = { state: 'known'; value: T } | { state: 'unknown' };
export const known = <T>(value: T): Measured<T> => ({ state: 'known', value });
export const notRecorded: Measured<never> = { state: 'unknown' };
