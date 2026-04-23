import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

type EbayListing = {
  title: string | null;
  price: number | null;
  currency: string | null;
  condition: string | null;
  grade: string | null;
  imageUrl: string | null;
  itemWebUrl: string | null;
  seller: string | null;
  buyingOptions: string[];
};

function loadEnvFromFile(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;

    const key = line.slice(0, eqIdx).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = line.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function extractGradeFromTitle(title: string | null): string | null {
  if (!title) return null;

  const patterns = [
    /\b(PSA)\s*(10|9(?:\.5)?|8(?:\.5)?|7(?:\.5)?|6(?:\.5)?|5(?:\.5)?|4(?:\.5)?|3(?:\.5)?|2(?:\.5)?|1)\b/i,
    /\b(BGS|BECKETT)\s*(10|9(?:\.5)?|9|8(?:\.5)?|8|7(?:\.5)?|7|6(?:\.5)?|6|5(?:\.5)?|5)\b/i,
    /\b(SGC)\s*(10|9(?:\.5)?|9|8(?:\.5)?|8|7(?:\.5)?|7|6(?:\.5)?|6|5(?:\.5)?|5)\b/i,
    /\b(CGC)\s*(10|9(?:\.5)?|9|8(?:\.5)?|8|7(?:\.5)?|7|6(?:\.5)?|6|5(?:\.5)?|5)\b/i,
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) {
      const grader = match[1].toUpperCase() === 'BECKETT' ? 'BGS' : match[1].toUpperCase();
      return `${grader} ${match[2]}`;
    }
  }

  return null;
}

function parseBrowseItems(payload: any): EbayListing[] {
  const items: any[] = payload?.itemSummaries ?? [];
  return items.map((item: any) => ({
    title: item?.title ?? null,
    price: item?.price?.value != null ? Number(item.price.value) : null,
    currency: item?.price?.currency ?? null,
    condition: item?.condition ?? null,
    grade: extractGradeFromTitle(item?.title ?? null),
    imageUrl: item?.thumbnailImages?.[0]?.imageUrl ?? item?.image?.imageUrl ?? null,
    itemWebUrl: item?.itemWebUrl ?? null,
    seller: item?.seller?.username ?? null,
    buyingOptions: item?.buyingOptions ?? [],
  }));
}

async function getOauthToken(): Promise<string> {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing EBAY_CLIENT_ID and EBAY_CLIENT_SECRET.');
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await axios.post(
    'https://api.ebay.com/identity/v1/oauth2/token',
    'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
    {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 15000,
    },
  );

  console.log('OAuth check OK');
  console.log(`- token_type: ${response.data?.token_type}`);
  console.log(`- expires_in: ${response.data?.expires_in}`);
  return response.data.access_token as string;
}

async function testBrowseSearch(token: string, title: string, limit: number): Promise<EbayListing[]> {
  const fetchLimit = Math.min(limit * 4, 50);
  const response = await axios.get('https://api.ebay.com/buy/browse/v1/item_summary/search', {
    params: {
      q: title,
      limit: fetchLimit,
      filter: 'buyingOptions:{FIXED_PRICE}',
    },
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      'Content-Type': 'application/json',
    },
    timeout: 20000,
  });

  return parseBrowseItems(response.data)
    .filter((item) => item.price !== null)
    .slice(0, limit);
}

async function main(): Promise<void> {
  loadEnvFromFile();

  const title = getArg('--title') || process.env.EBAY_TEST_TITLE || '';
  const limitArg = getArg('--limit') || process.env.EBAY_TEST_LIMIT || '5';
  const limit = Number(limitArg);

  if (!title.trim()) {
    throw new Error('Provide a title with --title "..." or set EBAY_TEST_TITLE.');
  }

  if (!Number.isFinite(limit) || limit < 1 || limit > 50) {
    throw new Error('Limit must be a number between 1 and 50.');
  }

  console.log('Running eBay active listings smoke test...');
  console.log(`- title: ${title}`);
  console.log(`- limit: ${limit}`);

  const token = await getOauthToken();

  // --- Active listings (Browse API) ---
  console.log('\n--- Active Listings (Browse API) ---');
  const listings = await testBrowseSearch(token, title, limit);
  const topListings = listings.slice(0, 5);
  console.log(`Retrieved: ${listings.length}, showing: ${topListings.length}`);
  topListings.forEach((item, i) => {
    console.log(`\n${i + 1}. ${item.title || 'Untitled'}`);
    console.log(`   price: ${item.price != null ? `$${item.price} ${item.currency ?? ''}`.trim() : 'N/A'}`);
    console.log(`   grade/condition: ${item.grade || item.condition || 'N/A'}`);
    console.log(`   buying: ${item.buyingOptions.join(', ') || 'N/A'}`);
    console.log(`   image: ${item.imageUrl || 'N/A'}`);
    console.log(`   link: ${item.itemWebUrl || 'N/A'}`);
  });

}

main().catch((error) => {
  console.error('\nSmoke test failed:');
  if (axios.isAxiosError(error)) {
    console.error(error.message);
    if (error.response) {
      console.error(`HTTP ${error.response.status}`);
      console.error(JSON.stringify(error.response.data, null, 2));
    }
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});
