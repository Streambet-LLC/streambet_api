/**
 * Standalone renderer + validator for the seller-side emails we just
 * upgraded:
 *
 *   1. seller_shipping_reminder  (used by ShippingReminderService cron)
 *   2. seller_shop_purchase      (used by PrizeService for shop sales
 *                                 AND now by AuctionsNotificationsService
 *                                 for auction sales)
 *
 * Renders both with a representative payload, validates against their
 * JSON schemas, and writes the resulting HTML to ./tmp-email-output/
 * so we can eyeball the layout / shipping address block / "Mark as
 * Shipped" CTA without poking the real SMTP transport.
 *
 * Run from the streambet_api project root:
 *   npx ts-node scripts/test-seller-emails.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ejs from 'ejs';
import { Validator } from 'jsonschema';

const ROOT = path.resolve(__dirname, '..');
const TPL = path.join(ROOT, 'src', 'templates');
const OUT = path.join(ROOT, 'tmp-email-output');

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

interface Case {
  id: string;
  template: string;
  schema: string;
  params: Record<string, unknown>;
}

const sharedShipping = {
  buyerFullName: 'Jane Buyer',
  shippingAddressLine1: '742 Evergreen Terrace',
  shippingAddressLine2: 'Apt 3B',
  shippingCity: 'Springfield',
  shippingState: 'IL',
  shippingZipCode: '62704',
  shippingCountry: 'United States',
  markShippedUrl:
    'http://localhost:8080/seller/shop/manage?tab=orders&orderId=ord_test_123',
};

const cases: Case[] = [
  {
    id: 'seller_shipping_reminder',
    template: path.join(TPL, 'seller_shipping_reminder.ejs'),
    schema: path.join(TPL, 'seller_shipping_reminder.json'),
    params: {
      sellerName: 'Acme Cards',
      itemName: '2024 Topps Chrome Patrick Mahomes /99',
      buyerName: 'jbuyer',
      orderId: 'ord_test_123',
      purchaseDate: 'May 10, 2026',
      ...sharedShipping,
    },
  },
  {
    id: 'seller_shop_purchase_auction_sale',
    template: path.join(TPL, 'seller_shop_purchase.ejs'),
    schema: path.join(TPL, 'seller_shop_purchase.json'),
    params: {
      sellerName: 'Acme Cards',
      itemName: '2024 Topps Chrome Patrick Mahomes /99',
      buyerName: 'jbuyer',
      amount: 142.85,
      orderId: 'ord_auction_456',
      purchaseDate: 'May 12, 2026',
      ...sharedShipping,
      markShippedUrl:
        'http://localhost:8080/seller/shop/manage?tab=orders&orderId=ord_auction_456',
    },
  },
  {
    id: 'seller_shipping_reminder_no_address',
    template: path.join(TPL, 'seller_shipping_reminder.ejs'),
    schema: path.join(TPL, 'seller_shipping_reminder.json'),
    // Backward-compat: if a caller forgets the new optional fields, the
    // template should still render cleanly (no shipping block, no CTA).
    params: {
      sellerName: 'Acme Cards',
      itemName: 'Mystery Pack',
      buyerName: 'jbuyer',
      orderId: 'ord_legacy_789',
      purchaseDate: 'May 1, 2026',
    },
  },
  {
    id: 'seller_shop_purchase_in_person',
    template: path.join(TPL, 'seller_shop_purchase.ejs'),
    schema: path.join(TPL, 'seller_shop_purchase.json'),
    // In-person fulfillment: no shipping address, no Mark-as-Shipped CTA.
    // Template should render the "In-Person Pickup" note instead.
    params: {
      sellerName: 'Acme Cards',
      itemName: 'PSA 10 Charizard (in-person hand-off)',
      buyerName: 'jbuyer',
      amount: 999,
      orderId: 'ord_in_person_001',
      purchaseDate: 'May 13, 2026',
    },
  },
];

(async () => {
  const validator = new Validator();
  let failed = 0;

  for (const c of cases) {
    const schema = JSON.parse(fs.readFileSync(c.schema, 'utf8'));
    const result = validator.validate(
      {
        toAddress: ['seller@example.com'],
        subject: `[test] ${c.id}`,
        params: c.params,
      },
      schema,
    );
    if (!result.valid) {
      failed++;
      console.error(`❌ [${c.id}] schema validation failed:`);
      for (const e of result.errors) console.error('   -', e.stack);
      continue;
    }
    try {
      const html = await ejs.renderFile(
        c.template,
        { params: c.params },
        { async: true },
      );
      const outFile = path.join(OUT, `${c.id}.html`);
      fs.writeFileSync(outFile, html as string);
      console.log(`✅ [${c.id}] rendered → ${path.relative(ROOT, outFile)}`);
    } catch (err) {
      failed++;
      console.error(
        `❌ [${c.id}] EJS render failed:`,
        (err as Error).message,
      );
    }
  }

  console.log(`\nDone. ${cases.length - failed}/${cases.length} cases passed.`);
  if (failed > 0) process.exit(1);
})();
