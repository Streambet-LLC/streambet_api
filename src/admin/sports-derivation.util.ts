/**
 * Heuristic "preferred sport + team" derivation for Sports-category
 * collectors. Items carry no structured sport/team metadata, so we infer it
 * from the card titles they bought: full pro-team names that appear in a
 * title are unambiguous (e.g. "… Cincinnati Reds …" → Baseball / Cincinnati
 * Reds), and explicit sport/league keywords give the sport on their own.
 * Aggregated across a collector's sports purchases, the most frequent sport
 * and team become their "preferred" values. Best-effort — anything we can't
 * confidently read stays null, and an admin tag always overrides it.
 */

export const SPORTS = [
  'Football',
  'Basketball',
  'Baseball',
  'Hockey',
  'Soccer',
] as const;

export type Sport = (typeof SPORTS)[number];

/** Full "City Nickname" → sport. Full names are unambiguous across leagues. */
const TEAMS: Array<{ team: string; sport: Sport }> = [
  // NFL
  ...[
    'Arizona Cardinals', 'Atlanta Falcons', 'Baltimore Ravens', 'Buffalo Bills',
    'Carolina Panthers', 'Chicago Bears', 'Cincinnati Bengals', 'Cleveland Browns',
    'Dallas Cowboys', 'Denver Broncos', 'Detroit Lions', 'Green Bay Packers',
    'Houston Texans', 'Indianapolis Colts', 'Jacksonville Jaguars',
    'Kansas City Chiefs', 'Las Vegas Raiders', 'Los Angeles Chargers',
    'Los Angeles Rams', 'Miami Dolphins', 'Minnesota Vikings',
    'New England Patriots', 'New Orleans Saints', 'New York Giants',
    'New York Jets', 'Philadelphia Eagles', 'Pittsburgh Steelers',
    'San Francisco 49ers', 'Seattle Seahawks', 'Tampa Bay Buccaneers',
    'Tennessee Titans', 'Washington Commanders',
  ].map(team => ({ team, sport: 'Football' as Sport })),
  // NBA
  ...[
    'Atlanta Hawks', 'Boston Celtics', 'Brooklyn Nets', 'Charlotte Hornets',
    'Chicago Bulls', 'Cleveland Cavaliers', 'Dallas Mavericks', 'Denver Nuggets',
    'Detroit Pistons', 'Golden State Warriors', 'Houston Rockets',
    'Indiana Pacers', 'Los Angeles Clippers', 'Los Angeles Lakers',
    'Memphis Grizzlies', 'Miami Heat', 'Milwaukee Bucks',
    'Minnesota Timberwolves', 'New Orleans Pelicans', 'New York Knicks',
    'Oklahoma City Thunder', 'Orlando Magic', 'Philadelphia 76ers',
    'Phoenix Suns', 'Portland Trail Blazers', 'Sacramento Kings',
    'San Antonio Spurs', 'Toronto Raptors', 'Utah Jazz', 'Washington Wizards',
  ].map(team => ({ team, sport: 'Basketball' as Sport })),
  // MLB
  ...[
    'Arizona Diamondbacks', 'Atlanta Braves', 'Baltimore Orioles',
    'Boston Red Sox', 'Chicago Cubs', 'Chicago White Sox', 'Cincinnati Reds',
    'Cleveland Guardians', 'Colorado Rockies', 'Detroit Tigers',
    'Houston Astros', 'Kansas City Royals', 'Los Angeles Angels',
    'Los Angeles Dodgers', 'Miami Marlins', 'Milwaukee Brewers',
    'Minnesota Twins', 'New York Mets', 'New York Yankees', 'Oakland Athletics',
    'Philadelphia Phillies', 'Pittsburgh Pirates', 'San Diego Padres',
    'San Francisco Giants', 'Seattle Mariners', 'St. Louis Cardinals',
    'Tampa Bay Rays', 'Texas Rangers', 'Toronto Blue Jays',
    'Washington Nationals',
  ].map(team => ({ team, sport: 'Baseball' as Sport })),
  // NHL
  ...[
    'Anaheim Ducks', 'Arizona Coyotes', 'Boston Bruins', 'Buffalo Sabres',
    'Calgary Flames', 'Carolina Hurricanes', 'Chicago Blackhawks',
    'Colorado Avalanche', 'Columbus Blue Jackets', 'Dallas Stars',
    'Detroit Red Wings', 'Edmonton Oilers', 'Florida Panthers',
    'Los Angeles Kings', 'Minnesota Wild', 'Montreal Canadiens',
    'Nashville Predators', 'New Jersey Devils', 'New York Islanders',
    'New York Rangers', 'Ottawa Senators', 'Philadelphia Flyers',
    'Pittsburgh Penguins', 'San Jose Sharks', 'Seattle Kraken',
    'St. Louis Blues', 'Tampa Bay Lightning', 'Toronto Maple Leafs',
    'Vancouver Canucks', 'Vegas Golden Knights', 'Washington Capitals',
    'Winnipeg Jets',
  ].map(team => ({ team, sport: 'Hockey' as Sport })),
];

/**
 * Star athletes → { sport, team }. Card titles are dominated by player names
 * (rarely the team or a sport word), so this is the main driver of detection.
 * `needle` is a distinctive normalized fragment searched in the title; `team`
 * is their best-known team (a fuzzy "preferred team" signal). Seeded with the
 * players present in our data plus widely-carded stars; extend as needed.
 */
const PLAYERS: Array<{ needle: string; sport: Sport; team?: string }> = [
  // Baseball
  { needle: 'ohtani', sport: 'Baseball', team: 'Los Angeles Dodgers' },
  { needle: 'bobby witt', sport: 'Baseball', team: 'Kansas City Royals' },
  { needle: 'elly de la cruz', sport: 'Baseball', team: 'Cincinnati Reds' },
  { needle: 'crow armstrong', sport: 'Baseball', team: 'Chicago Cubs' },
  { needle: 'rece hinds', sport: 'Baseball', team: 'Cincinnati Reds' },
  { needle: 'mike trout', sport: 'Baseball', team: 'Los Angeles Angels' },
  { needle: 'aaron judge', sport: 'Baseball', team: 'New York Yankees' },
  { needle: 'mookie betts', sport: 'Baseball', team: 'Los Angeles Dodgers' },
  { needle: 'ronald acuna', sport: 'Baseball', team: 'Atlanta Braves' },
  { needle: 'juan soto', sport: 'Baseball', team: 'New York Mets' },
  { needle: 'fernando tatis', sport: 'Baseball', team: 'San Diego Padres' },
  { needle: 'vladimir guerrero', sport: 'Baseball', team: 'Toronto Blue Jays' },
  { needle: 'julio rodriguez', sport: 'Baseball', team: 'Seattle Mariners' },
  { needle: 'gunnar henderson', sport: 'Baseball', team: 'Baltimore Orioles' },
  { needle: 'paul skenes', sport: 'Baseball', team: 'Pittsburgh Pirates' },
  { needle: 'jackson holliday', sport: 'Baseball', team: 'Baltimore Orioles' },
  { needle: 'corbin carroll', sport: 'Baseball', team: 'Arizona Diamondbacks' },
  { needle: 'jackson chourio', sport: 'Baseball', team: 'Milwaukee Brewers' },
  // Basketball
  { needle: 'durant', sport: 'Basketball', team: 'Phoenix Suns' },
  { needle: 'kobe bryant', sport: 'Basketball', team: 'Los Angeles Lakers' },
  { needle: 'gilgeous', sport: 'Basketball', team: 'Oklahoma City Thunder' },
  { needle: 'buzelis', sport: 'Basketball', team: 'Chicago Bulls' },
  { needle: 'lebron', sport: 'Basketball', team: 'Los Angeles Lakers' },
  { needle: 'stephen curry', sport: 'Basketball', team: 'Golden State Warriors' },
  { needle: 'giannis', sport: 'Basketball', team: 'Milwaukee Bucks' },
  { needle: 'luka doncic', sport: 'Basketball', team: 'Los Angeles Lakers' },
  { needle: 'wembanyama', sport: 'Basketball', team: 'San Antonio Spurs' },
  { needle: 'jayson tatum', sport: 'Basketball', team: 'Boston Celtics' },
  { needle: 'jokic', sport: 'Basketball', team: 'Denver Nuggets' },
  { needle: 'anthony edwards', sport: 'Basketball', team: 'Minnesota Timberwolves' },
  { needle: 'michael jordan', sport: 'Basketball', team: 'Chicago Bulls' },
  { needle: 'ja morant', sport: 'Basketball', team: 'Memphis Grizzlies' },
  { needle: 'zion williamson', sport: 'Basketball', team: 'New Orleans Pelicans' },
  { needle: 'cooper flagg', sport: 'Basketball', team: 'Dallas Mavericks' },
  // Football
  { needle: 'mahomes', sport: 'Football', team: 'Kansas City Chiefs' },
  { needle: 'josh allen', sport: 'Football', team: 'Buffalo Bills' },
  { needle: 'justin jefferson', sport: 'Football', team: 'Minnesota Vikings' },
  { needle: 'jamarr chase', sport: 'Football', team: 'Cincinnati Bengals' },
  { needle: 'ja marr chase', sport: 'Football', team: 'Cincinnati Bengals' },
  { needle: 'caleb williams', sport: 'Football', team: 'Chicago Bears' },
  { needle: 'stroud', sport: 'Football', team: 'Houston Texans' },
  { needle: 'jayden daniels', sport: 'Football', team: 'Washington Commanders' },
  { needle: 'joe burrow', sport: 'Football', team: 'Cincinnati Bengals' },
  { needle: 'jalen hurts', sport: 'Football', team: 'Philadelphia Eagles' },
  { needle: 'tom brady', sport: 'Football', team: 'Tampa Bay Buccaneers' },
  { needle: 'travis kelce', sport: 'Football', team: 'Kansas City Chiefs' },
  { needle: 'bijan robinson', sport: 'Football', team: 'Atlanta Falcons' },
  // Hockey
  { needle: 'mcdavid', sport: 'Hockey', team: 'Edmonton Oilers' },
  { needle: 'auston matthews', sport: 'Hockey', team: 'Toronto Maple Leafs' },
  { needle: 'sidney crosby', sport: 'Hockey', team: 'Pittsburgh Penguins' },
  { needle: 'connor bedard', sport: 'Hockey', team: 'Chicago Blackhawks' },
  { needle: 'nathan mackinnon', sport: 'Hockey', team: 'Colorado Avalanche' },
  // Soccer
  { needle: 'lionel messi', sport: 'Soccer', team: 'Inter Miami' },
  { needle: 'cristiano ronaldo', sport: 'Soccer' },
  { needle: 'erling haaland', sport: 'Soccer' },
  { needle: 'kylian mbappe', sport: 'Soccer' },
];

/** Sport/league keywords for when no full team name is present. */
const SPORT_KEYWORDS: Array<{ kw: string; sport: Sport }> = [
  { kw: 'nfl', sport: 'Football' },
  { kw: 'football', sport: 'Football' },
  { kw: 'nba', sport: 'Basketball' },
  { kw: 'basketball', sport: 'Basketball' },
  { kw: 'mlb', sport: 'Baseball' },
  { kw: 'baseball', sport: 'Baseball' },
  { kw: 'nhl', sport: 'Hockey' },
  { kw: 'hockey', sport: 'Hockey' },
  { kw: 'mls', sport: 'Soccer' },
  { kw: 'soccer', sport: 'Soccer' },
  { kw: 'fifa', sport: 'Soccer' },
  { kw: 'premier league', sport: 'Soccer' },
];

/** Lowercase + strip punctuation to spaces, padded for word-ish matching. */
const normalize = (s: string): string =>
  ` ${s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

const TEAM_INDEX: Array<{ needle: string; team: string; sport: Sport }> =
  TEAMS.map(({ team, sport }) => ({
    needle: ` ${normalize(team).trim()} `,
    team,
    sport,
  }));

/** Read a single card title → best-effort { sport, team } (either may be null). */
export function detectSportTeam(itemName: string): {
  sport: Sport | null;
  team: string | null;
} {
  const n = normalize(itemName);
  // Explicit full team name in the title is the most specific signal.
  for (const { needle, team, sport } of TEAM_INDEX) {
    if (n.includes(needle)) return { sport, team };
  }
  // Otherwise a known player drives both sport and (best-known) team.
  for (const { needle, sport, team } of PLAYERS) {
    if (n.includes(` ${needle} `) || n.includes(` ${needle}`)) {
      return { sport, team: team ?? null };
    }
  }
  for (const { kw, sport } of SPORT_KEYWORDS) {
    if (n.includes(` ${kw} `) || n.includes(`${kw} `) || n.includes(` ${kw}`)) {
      return { sport, team: null };
    }
  }
  return { sport: null, team: null };
}

/** Cap on auto-derived teams so a wide collector doesn't get a huge list. */
const MAX_DERIVED_TEAMS = 6;

/**
 * Aggregate a collector's sports-card titles into their preferred sports and
 * teams (ALL detected, ordered most-bought first; teams capped). Empty arrays
 * when nothing is detectable.
 */
export function derivePreferredSportTeam(itemNames: string[]): {
  sports: Sport[];
  teams: string[];
} {
  const sportCounts = new Map<Sport, number>();
  const teamCounts = new Map<string, number>();
  for (const name of itemNames) {
    if (!name) continue;
    const { sport, team } = detectSportTeam(name);
    if (sport) sportCounts.set(sport, (sportCounts.get(sport) ?? 0) + 1);
    if (team) teamCounts.set(team, (teamCounts.get(team) ?? 0) + 1);
  }
  const sports = [...sportCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([s]) => s);
  const teams = [...teamCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t)
    .slice(0, MAX_DERIVED_TEAMS);
  return { sports, teams };
}
