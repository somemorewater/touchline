/**
 * "demo" loads clearly-labelled sample fixtures and results so the UI can be exercised.
 * Anything else loads only real, confirmed competition data (currently: teams and leagues, no matches).
 */
export const IS_DEMO_DATA = process.env.NEXT_PUBLIC_TOUCHLINE_DATA === 'demo';
