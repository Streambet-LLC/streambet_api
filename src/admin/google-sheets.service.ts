import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';

// Inferred from `google.auth.OAuth2` to avoid the dual google-auth-library
// type hazard (googleapis bundles its own copy).
type OAuthClient = InstanceType<typeof google.auth.OAuth2>;
type GoogleCredentials = Parameters<OAuthClient['setCredentials']>[0];

/**
 * Google Sheets ingest via OAuth.
 *
 * Requires three env vars (set in the API task definition / parameter store):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI
 * The redirect URI must point at the web app's Google callback route and be
 * registered in the Google Cloud OAuth client.
 *
 * NOTE: connected tokens are held in-memory keyed by admin user id. That's
 * fine for a single-instance first pass — an admin reconnects after a restart.
 * Persist the refresh token (a small table) before relying on it across
 * deploys / multiple API instances.
 */
@Injectable()
export class GoogleSheetsService {
  private readonly logger = new Logger(GoogleSheetsService.name);
  private readonly tokens = new Map<string, GoogleCredentials>();

  private get configured(): boolean {
    return !!(
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_OAUTH_REDIRECT_URI
    );
  }

  private client(): OAuthClient {
    if (!this.configured) {
      throw new BadRequestException(
        'Google integration is not configured (missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_OAUTH_REDIRECT_URI).',
      );
    }
    return new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_OAUTH_REDIRECT_URI,
    );
  }

  /** Consent URL the admin opens to grant read-only Sheets access. */
  getAuthUrl(adminId: string): { url: string; configured: boolean } {
    if (!this.configured) {
      return { url: '', configured: false };
    }
    const url = this.client().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/spreadsheets.readonly',
        'https://www.googleapis.com/auth/drive.readonly',
      ],
      state: adminId,
    });
    return { url, configured: true };
  }

  /** Exchange the OAuth code (from the redirect) for tokens. */
  async exchangeCode(
    adminId: string,
    code: string,
  ): Promise<{ connected: boolean }> {
    if (!code) throw new BadRequestException('Missing authorization code');
    const client = this.client();
    const { tokens } = await client.getToken(code);
    this.tokens.set(adminId, tokens);
    return { connected: true };
  }

  /** Whether this admin has a live Google connection in memory. */
  isConnected(adminId: string): boolean {
    return this.tokens.has(adminId);
  }

  private extractSpreadsheetId(input: {
    spreadsheetId?: string;
    url?: string;
  }): string {
    if (input.spreadsheetId) return input.spreadsheetId;
    const m = (input.url ?? '').match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!m) {
      throw new BadRequestException(
        'Provide a Google Sheets URL or spreadsheet id.',
      );
    }
    return m[1];
  }

  /**
   * Read a sheet's cell grid for ingest. Returns the raw rows (array of string
   * arrays) so the client can run the same column-mapping flow as CSV/Excel.
   */
  async readSheet(
    adminId: string,
    input: { spreadsheetId?: string; url?: string; range?: string },
  ): Promise<{ title: string; rows: string[][] }> {
    const creds = this.tokens.get(adminId);
    if (!creds) {
      throw new BadRequestException(
        'Connect a Google account first (no active session).',
      );
    }
    const client = this.client();
    client.setCredentials(creds);
    const sheets = google.sheets({ version: 'v4', auth: client });
    const spreadsheetId = this.extractSpreadsheetId(input);

    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const title = meta.data.properties?.title ?? 'Google Sheet';
    const firstTab = meta.data.sheets?.[0]?.properties?.title ?? 'Sheet1';
    const range = input.range ?? `${firstTab}!A1:Z5000`;

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
    const rows = (res.data.values ?? []).map((r) =>
      r.map((c) => (c == null ? '' : String(c))),
    );
    return { title, rows };
  }
}
