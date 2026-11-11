import { Controller, Get, Logger, Param, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuctionsService } from './auctions.service';

/**
 * Link previews (Open Graph / Twitter cards) for collectiqapp.xyz.
 *
 * The site is a client-rendered SPA, and chat apps' link-preview bots
 * (Telegram, iMessage, Slack, X, Discord, WhatsApp…) don't run JavaScript,
 * so they only ever saw index.html's static tags. The web CloudFront
 * Function sends just those bots here:
 *   /auctions/<id>…  →  /api/og/auctions/<id>   (the lot itself)
 *   anything else    →  /api/og/page/<name>     (home | about | analytics)
 * Humans never hit this; if one does, the meta refresh sends them on.
 */
@ApiExcludeController()
@Controller('og')
export class AuctionsOgController {
  private readonly logger = new Logger(AuctionsOgController.name);

  constructor(
    private readonly auctions: AuctionsService,
    private readonly config: ConfigService,
  ) {}

  @Get('auctions/:id')
  async auction(@Param('id') id: string, @Res() res: Response) {
    const site = this.site();
    if (UUID_RE.test(id)) {
      try {
        const a = (await this.auctions.getPublic(id)) as unknown as OgAuction;
        return this.send(res, {
          title: a.title,
          description: auctionSummary(a),
          image: a.images?.[0]?.url || `${site}${HERMES_IMAGE}`,
          imageAlt: a.title,
          url: `${site}/auctions/${id}`,
          large: true,
        });
      } catch (err) {
        // Unknown / unlisted lot: fall back to the Hermes card below.
        this.logger.debug(`OG for auction ${id}: ${(err as Error).message}`);
      }
    }
    return this.send(res, pageMeta('home', site));
  }

  @Get('page/:name')
  page(@Param('name') name: string, @Res() res: Response) {
    return this.send(res, pageMeta(name, this.site()));
  }

  private site(): string {
    return (
      this.config.get<string>('app.clientUrl') || 'https://collectiqapp.xyz'
    ).replace(/\/+$/, '');
  }

  private send(res: Response, m: OgMeta) {
    // Short edge cache so bids and prices in previews stay fresh.
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.type('html').send(renderOgHtml(m));
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hermes + collectIQ share cards in the web build's /public (1200×630 / 523×275). */
const HERMES_IMAGE = '/hermes/hermes-social.png?v=1';
const COLLECTIQ_IMAGE = '/lovable-uploads/socialshare.png?v=2';

const HERMES_TITLE = 'Hermes Auctions — zero-seller-fee collectibles auctions';
const HERMES_DESCRIPTION =
  'Bid on sports cards, TCG and sports memorabilia with zero seller fees. Every lot is hosted and shipped by Hermes Auctions.';

interface OgMeta {
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  url: string;
  /** Twitter large-image card (vs. the small summary card). */
  large: boolean;
  siteName?: string;
}

/** The public auction fields a preview uses (AuctionsService.getPublic). */
interface OgAuction {
  title: string;
  images?: Array<{ url: string }>;
  status: string;
  startsAt: string;
  endsAt: string;
  startingPriceUsd: number;
  currentBidUsd: number | null;
  /** Set once the lot has settled. */
  result?: { sold: boolean; winningBidUsd: number | null } | null;
  bidCount: number;
  estValueUsd: number | null;
  estValueHighUsd?: number | null;
}

function pageMeta(name: string, site: string): OgMeta {
  if (name === 'analytics') {
    return {
      title: 'collectIQ Analytics — trading card market intelligence',
      description:
        'AI-powered market intelligence for trading cards: real-time pricing, trend forecasts and a research analyst. Coming soon.',
      image: `${site}${COLLECTIQ_IMAGE}`,
      imageAlt: 'collectIQ Analytics',
      url: `${site}/analytics`,
      large: true,
      siteName: 'collectIQ',
    };
  }
  if (name === 'about') {
    return {
      title: 'About — Hermes Auctions & collectIQ',
      description:
        'Meet the founder behind Hermes Auctions and collectIQ: zero-seller-fee collectibles auctions and AI market intelligence.',
      image: `${site}${HERMES_IMAGE}`,
      imageAlt: 'Hermes Auctions',
      url: `${site}/about`,
      large: true,
    };
  }
  return {
    title: HERMES_TITLE,
    description: HERMES_DESCRIPTION,
    image: `${site}${HERMES_IMAGE}`,
    imageAlt: 'Hermes Auctions — zero-seller-fee collectibles auctions',
    url: `${site}/`,
    large: true,
  };
}

const usd = (n: number) =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
  });

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });

/** "Current bid $120 · 3 bids · Ends Fri, Nov 14 · Est. Value $400 – $600" */
export function auctionSummary(a: OgAuction): string {
  const parts: string[] = [];
  const bids = `${a.bidCount} bid${a.bidCount === 1 ? '' : 's'}`;
  if (a.status === 'active') {
    parts.push(
      a.currentBidUsd != null
        ? `Current bid ${usd(a.currentBidUsd)} · ${bids}`
        : `Starting bid ${usd(a.startingPriceUsd)} · No bids yet`,
      `Ends ${day(a.endsAt)}`,
    );
  } else if (a.status === 'scheduled') {
    parts.push(
      `Starts ${day(a.startsAt)}`,
      `Starting bid ${usd(a.startingPriceUsd)}`,
    );
  } else if (a.result?.sold) {
    const hammer = a.result.winningBidUsd ?? a.currentBidUsd;
    parts.push(hammer != null ? `Sold for ${usd(hammer)}` : 'Sold');
  } else {
    parts.push('Auction ended');
  }
  if (a.estValueUsd != null) {
    parts.push(
      `Est. Value ${usd(a.estValueUsd)}${
        a.estValueHighUsd != null ? ` – ${usd(a.estValueHighUsd)}` : ''
      }`,
    );
  }
  parts.push('Zero seller fees on Hermes Auctions');
  return parts.join(' · ');
}

const esc = (s: string) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function renderOgHtml(m: OgMeta): string {
  const t = esc(m.title);
  const d = esc(m.description);
  const img = esc(m.image);
  const url = esc(m.url);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${t}</title>
<meta name="description" content="${d}">
<link rel="canonical" href="${url}">
<meta property="og:site_name" content="${esc(m.siteName ?? 'Hermes Auctions')}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:image" content="${img}">
<meta property="og:image:alt" content="${esc(m.imageAlt)}">
<meta name="twitter:card" content="${m.large ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${img}">
<meta http-equiv="refresh" content="0; url=${url}">
</head>
<body><p><a href="${url}">${t}</a></p></body>
</html>
`;
}
