/**
 * Derive a centralized "metropolitan area" label from the messy free-text
 * location fields users give us (city / state / zip / country). Used by the
 * Collector Analytics surface so the Location column groups nearby
 * collectors (a suburb rolls up to its metro) instead of showing dozens of
 * distinct small-town strings — and so junk free-text reads as "no location"
 * rather than being echoed back.
 *
 * Self-contained on purpose: no geocoding API, no huge ZIP dataset. Rules:
 *   1. Recognized US state + known city/suburb  → that metro (e.g. "Los Angeles, CA").
 *   2. Recognized US state + unknown city        → cleaned "City, ST".
 *   3. NO recognized state, but city is a major   → that metro (e.g. bare
 *      unambiguous metro city ("new york")          "New York" → "New York, NY").
 *   4. NO recognized state + unrecognized city    → null (treated as garbage,
 *      and a US/blank country                         shows as "—").
 *   5. A real foreign country                     → "City, Country".
 */

const STATE_CODE_TO_NAME: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'Washington, DC',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

const STATE_NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_CODE_TO_NAME).map(([code, name]) => [
    name.toLowerCase(),
    code,
  ]),
);

const US_COUNTRY_ALIASES = new Set([
  '',
  'united states',
  'united states of america',
  'usa',
  'us',
  'u.s.',
  'u.s.a.',
  'america',
]);

/**
 * Metro label → member cities as `"City|ST"`. The anchor maps to itself;
 * listed suburbs roll up into it. State is the 2-letter code.
 */
const METROS: Record<string, string[]> = {
  'Los Angeles, CA': [
    'Los Angeles|CA', 'Long Beach|CA', 'Anaheim|CA', 'Santa Ana|CA',
    'Irvine|CA', 'Pasadena|CA', 'Burbank|CA', 'Glendale|CA', 'Torrance|CA',
    'Santa Monica|CA', 'Thousand Oaks|CA', 'Pomona|CA', 'Inglewood|CA',
  ],
  'Riverside, CA': [
    'Riverside|CA', 'San Bernardino|CA', 'Menifee|CA', 'Temecula|CA',
    'Murrieta|CA', 'Ontario|CA', 'Rancho Cucamonga|CA', 'Fontana|CA',
    'Moreno Valley|CA', 'Corona|CA', 'Hemet|CA',
  ],
  'San Francisco, CA': [
    'San Francisco|CA', 'Oakland|CA', 'Berkeley|CA', 'Daly City|CA',
    'South San Francisco|CA',
  ],
  'San Jose, CA': [
    'San Jose|CA', 'Sunnyvale|CA', 'Santa Clara|CA', 'Mountain View|CA',
    'Palo Alto|CA', 'Cupertino|CA', 'Fremont|CA',
  ],
  'San Diego, CA': ['San Diego|CA', 'Chula Vista|CA', 'Oceanside|CA'],
  'Sacramento, CA': ['Sacramento|CA', 'Roseville|CA', 'Elk Grove|CA'],
  'Miami, FL': [
    'Miami|FL', 'Miami Beach|FL', 'Hialeah|FL', 'Fort Lauderdale|FL',
    'Hollywood|FL', 'Pompano Beach|FL', 'Boca Raton|FL', 'Boynton Beach|FL',
    'West Palm Beach|FL', 'Pembroke Pines|FL', 'Coral Gables|FL',
  ],
  'Tampa, FL': ['Tampa|FL', 'St Petersburg|FL', 'Saint Petersburg|FL', 'Clearwater|FL'],
  'Orlando, FL': ['Orlando|FL', 'Kissimmee|FL', 'Sanford|FL'],
  'Jacksonville, FL': ['Jacksonville|FL'],
  'New York, NY': [
    'New York|NY', 'New York City|NY', 'Brooklyn|NY', 'Queens|NY', 'Bronx|NY',
    'Staten Island|NY', 'Newark|NJ', 'Jersey City|NJ', 'Yonkers|NY',
    'Hoboken|NJ', 'Paterson|NJ',
  ],
  'Chicago, IL': [
    'Chicago|IL', 'Naperville|IL', 'Evanston|IL', 'Aurora|IL', 'Cicero|IL',
    'Schaumburg|IL',
  ],
  'Washington, DC': [
    'Washington|DC', 'Arlington|VA', 'Alexandria|VA', 'Bethesda|MD',
    'Silver Spring|MD', 'Fairfax|VA', 'Reston|VA', 'Rockville|MD',
  ],
  'Baltimore, MD': ['Baltimore|MD', 'Towson|MD', 'Columbia|MD'],
  'Philadelphia, PA': ['Philadelphia|PA', 'Camden|NJ', 'King Of Prussia|PA'],
  'Boston, MA': ['Boston|MA', 'Cambridge|MA', 'Somerville|MA', 'Quincy|MA'],
  'Atlanta, GA': ['Atlanta|GA', 'Marietta|GA', 'Sandy Springs|GA', 'Roswell|GA'],
  'Dallas, TX': [
    'Dallas|TX', 'Fort Worth|TX', 'Arlington|TX', 'Plano|TX', 'Irving|TX',
    'Frisco|TX', 'McKinney|TX',
  ],
  'Houston, TX': ['Houston|TX', 'Sugar Land|TX', 'The Woodlands|TX', 'Katy|TX'],
  'Austin, TX': ['Austin|TX', 'Round Rock|TX', 'Cedar Park|TX'],
  'San Antonio, TX': ['San Antonio|TX'],
  'Phoenix, AZ': [
    'Phoenix|AZ', 'Mesa|AZ', 'Scottsdale|AZ', 'Tempe|AZ', 'Chandler|AZ',
    'Gilbert|AZ', 'Glendale|AZ',
  ],
  'Las Vegas, NV': ['Las Vegas|NV', 'Henderson|NV', 'North Las Vegas|NV'],
  'Denver, CO': ['Denver|CO', 'Aurora|CO', 'Lakewood|CO', 'Boulder|CO'],
  'Seattle, WA': ['Seattle|WA', 'Bellevue|WA', 'Tacoma|WA', 'Redmond|WA', 'Kirkland|WA'],
  'Portland, OR': ['Portland|OR', 'Beaverton|OR', 'Hillsboro|OR', 'Gresham|OR'],
  'Salt Lake City, UT': [
    'Salt Lake City|UT', 'West Valley City|UT', 'West Jordan|UT',
    'Sandy|UT', 'Provo|UT', 'Orem|UT', 'Ogden|UT',
  ],
  'Minneapolis, MN': ['Minneapolis|MN', 'Saint Paul|MN', 'St Paul|MN', 'Bloomington|MN'],
  'Detroit, MI': ['Detroit|MI', 'Dearborn|MI', 'Warren|MI', 'Sterling Heights|MI'],
  'Cleveland, OH': ['Cleveland|OH', 'Akron|OH', 'Parma|OH'],
  'Columbus, OH': ['Columbus|OH', 'Dublin|OH'],
  'Cincinnati, OH': ['Cincinnati|OH'],
  'Pittsburgh, PA': ['Pittsburgh|PA'],
  'St. Louis, MO': ['St Louis|MO', 'Saint Louis|MO'],
  'Kansas City, MO': ['Kansas City|MO', 'Kansas City|KS', 'Overland Park|KS'],
  'Wichita, KS': ['Wichita|KS'],
  'Nashville, TN': ['Nashville|TN', 'Franklin|TN', 'Murfreesboro|TN'],
  'Memphis, TN': ['Memphis|TN'],
  'Charlotte, NC': ['Charlotte|NC', 'Concord|NC'],
  'Raleigh, NC': ['Raleigh|NC', 'Durham|NC', 'Cary|NC', 'Chapel Hill|NC'],
  'Tulsa, OK': ['Tulsa|OK', 'Broken Arrow|OK'],
  'Oklahoma City, OK': ['Oklahoma City|OK', 'Norman|OK', 'Edmond|OK'],
  'Indianapolis, IN': ['Indianapolis|IN', 'Carmel|IN', 'Fishers|IN'],
  'Milwaukee, WI': ['Milwaukee|WI'],
  'Salisbury, MD': ['Crisfield|MD', 'Salisbury|MD'],
};

/** `cityLower|STATEUPPER` → metro label. Built once, normalized consistently. */
const METRO_LOOKUP: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [label, members] of Object.entries(METROS)) {
    for (const member of members) {
      const [c, st] = member.split('|');
      if (!c || !st) continue;
      m.set(`${c.trim().toLowerCase()}|${st.trim().toUpperCase()}`, label);
    }
  }
  return m;
})();

/**
 * Cities whose name maps to a single obvious metro even WITHOUT a state, so a
 * bare "New York" resolves the same as "New York, NY". Deliberately excludes
 * ambiguous names (Portland, Columbus, Arlington, Glendale, Kansas City, …)
 * which need a state to disambiguate.
 */
const UNAMBIGUOUS_CITY_TO_METRO: Map<string, string> = (() => {
  const cities: Record<string, string> = {
    'new york': 'New York, NY', 'new york city': 'New York, NY',
    'brooklyn': 'New York, NY', 'manhattan': 'New York, NY',
    'chicago': 'Chicago, IL', 'los angeles': 'Los Angeles, CA',
    'houston': 'Houston, TX', 'philadelphia': 'Philadelphia, PA',
    'phoenix': 'Phoenix, AZ', 'san antonio': 'San Antonio, TX',
    'san diego': 'San Diego, CA', 'dallas': 'Dallas, TX',
    'san jose': 'San Jose, CA', 'austin': 'Austin, TX',
    'jacksonville': 'Jacksonville, FL', 'san francisco': 'San Francisco, CA',
    'seattle': 'Seattle, WA', 'denver': 'Denver, CO',
    'nashville': 'Nashville, TN', 'detroit': 'Detroit, MI',
    'boston': 'Boston, MA', 'memphis': 'Memphis, TN',
    'baltimore': 'Baltimore, MD', 'milwaukee': 'Milwaukee, WI',
    'atlanta': 'Atlanta, GA', 'miami': 'Miami, FL',
    'minneapolis': 'Minneapolis, MN', 'tampa': 'Tampa, FL',
    'pittsburgh': 'Pittsburgh, PA', 'cincinnati': 'Cincinnati, OH',
    'cleveland': 'Cleveland, OH', 'indianapolis': 'Indianapolis, IN',
    'sacramento': 'Sacramento, CA', 'las vegas': 'Las Vegas, NV',
    'tulsa': 'Tulsa, OK', 'wichita': 'Wichita, KS', 'orlando': 'Orlando, FL',
    'raleigh': 'Raleigh, NC', 'charlotte': 'Charlotte, NC',
    'oklahoma city': 'Oklahoma City, OK', 'salt lake city': 'Salt Lake City, UT',
  };
  return new Map(Object.entries(cities));
})();

const clean = (v: string | null | undefined): string =>
  (v ?? '').replace(/\s+/g, ' ').trim();

const titleCase = (v: string): string =>
  v
    .toLowerCase()
    .split(' ')
    .map(w => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');

/** Resolve a free-text state to a 2-letter US code, or null if not a US state. */
const normalizeStateCode = (raw: string): string | null => {
  const v = clean(raw);
  if (!v) return null;
  const upper = v.toUpperCase();
  if (upper.length === 2 && STATE_CODE_TO_NAME[upper]) return upper;
  return STATE_NAME_TO_CODE[v.toLowerCase()] ?? null;
};

/**
 * Best-effort metropolitan-area label. Returns null when we have nothing
 * trustworthy to show (so the UI renders "—" instead of echoing junk).
 */
export function deriveMetroArea(input: {
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
}): string | null {
  const city = clean(input.city);
  const cityLower = city.toLowerCase();
  const stateCode = normalizeStateCode(input.state ?? '');
  const country = clean(input.country);
  const isUsCountry = US_COUNTRY_ALIASES.has(country.toLowerCase());

  // 1-2: We have a real US state.
  if (stateCode) {
    if (city) {
      return (
        METRO_LOOKUP.get(`${cityLower}|${stateCode}`) ??
        `${titleCase(city)}, ${stateCode}`
      );
    }
    return STATE_CODE_TO_NAME[stateCode] ?? stateCode; // state only
  }

  // 3: No state, but the city alone is an unambiguous metro.
  if (city) {
    const cityMetro = UNAMBIGUOUS_CITY_TO_METRO.get(cityLower);
    if (cityMetro) return cityMetro;
  }

  // 5: A real foreign country (and not blank/US junk).
  if (country && !isUsCountry) {
    return city ? `${titleCase(city)}, ${country}` : country;
  }

  // 4: No state, US/blank country, unrecognized city → unreliable free text.
  return null;
}
