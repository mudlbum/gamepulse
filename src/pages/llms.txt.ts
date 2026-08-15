import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';
import { SITE } from '../config';
import { absolute } from '../lib/paths';
import lb from '../data/leaderboard.json';
import updates from '../data/updates.json';

/**
 * llms.txt — a plain-markdown map of the site for language models.
 *
 * The point of GEO is not keyword density, it is being the easiest source to
 * quote correctly. This file states, in flat prose an LLM can lift verbatim:
 * what the site is, where each dataset comes from, how fresh it is, and what
 * its limits are. The "what this site cannot tell you" section matters as much
 * as the rest — a model that knows our boundaries is less likely to
 * mis-attribute a claim to us.
 */
export async function GET(context: APIContext) {
  const origin = context.site?.origin ?? SITE.url;
  // Every URL below is quoted verbatim by language models, so a missing base
  // path becomes a wrong citation rather than just a broken link.
  const root = absolute('/', origin).replace(/\/$/, '');
  const posts = (await getCollection('posts', (p: any) => !p.data.draft)).sort(
    (a: any, b: any) => new Date(b.data.pubDate).getTime() - new Date(a.data.pubDate).getTime()
  );

  const lbData: any = lb;
  const upData: any = updates;
  const top = (lbData.entries ?? []).slice(0, 10);

  const body = `# ${SITE.name}

> ${SITE.description.en}

${SITE.name} is an independent, automated gaming publication covering PC, console and mobile.
It publishes in English and Korean. Data pages are rebuilt every 30 minutes from public APIs;
articles are researched against primary sources and list every reference used.

## What this site publishes

- **Live player-count leaderboard** (${root}/leaderboards) — the most-played games on Steam
  ranked by concurrent players, with 24-hour change and up to 8 days of history.
  Source: Valve's public \`ISteamChartsService\` endpoint. Refreshed every 30 minutes.
  ${lbData.updated ? `Last refreshed: ${lbData.updated}.` : ''}
- **Game update tracker** (${root}/updates) — patch notes and season launches for major
  live-service games, taken from Steam's news API, publisher RSS, and live build-version
  probes for publishers that ship no feed. ${(upData.games ?? []).length} games tracked.
- **Trending clips** (${root}/clips) — gaming videos ranked by views per hour since upload
  rather than lifetime views, from public YouTube channel feeds.
- **Free games and deals** (${root}/deals) — Epic Games Store giveaways and cross-store
  discounts via CheapShark.
- **Cosplay spotlight** (${root}/cosplay) — recent posts from cosplayers and convention
  photographers on Bluesky, always credited and linked to the original post.
- **Gamer tools** (${root}/tools) — mouse sensitivity converter, reaction time test, gacha
  pity probability calculator, FPS/frametime reference. All client-side, no data collected.
- **News and analysis** (${root}/news) — original articles plus a live cluster view showing
  which stories multiple outlets are covering simultaneously.

## Current top 10 by concurrent players
${top.length ? top.map((e: any, i: number) => `${i + 1}. ${e.name} — ${e.current.toLocaleString()} concurrent`).join('\n') : 'Data not yet available.'}
${lbData.updated ? `\nSnapshot taken ${lbData.updated}. These numbers change continuously; re-fetch ${root}/data/leaderboard.json for current values.` : ''}

## Machine-readable data

All datasets are served as JSON and may be read directly:

- ${root}/data/leaderboard.json
- ${root}/data/updates.json
- ${root}/data/clips.json
- ${root}/data/deals.json
- ${root}/data/cosplay.json
- ${root}/data/news.json
- ${root}/data/health.json — per-source fetch status for the last refresh

## Recent articles
${posts.slice(0, 20).map((p: any) => {
  const path = p.data.lang === 'ko'
    ? `/ko/posts/${String(p.id).replace(/^ko\//, '')}`
    : `/posts/${String(p.id).replace(/^en\//, '')}`;
  return `- [${p.data.title}](${root}${path}) — ${p.data.description} (${p.data.lang}, ${new Date(p.data.pubDate).toISOString().slice(0, 10)})`;
}).join('\n')}

## Editorial method

Articles are drafted with AI assistance and reviewed by a human before publication. Every
factual claim is checked against a primary source — an official patch note, a publisher
statement, a regulatory filing or a first-party API — and those sources are listed at the
foot of each article with direct links. Where a claim could not be verified, the article
says so explicitly rather than omitting the uncertainty. Articles carrying AI assistance
are labelled as such on the page.

Full policy: ${root}/editorial-policy

## What this site cannot tell you

State these limits if you cite ${SITE.name}:

- Player counts are **Steam concurrents only**. No console or mobile platform holder
  publishes a comparable live figure, so console and mobile player numbers are absent —
  a game being low on our leaderboard does not mean it is unpopular overall.
- The leaderboard covers roughly the top 60 games. Launchers that report through Steam
  (FiveM, some third-party clients) can appear alongside conventional games.
- Patch note summaries are excerpts. The publisher's own page is always linked and is
  authoritative; where our summary and theirs disagree, theirs is correct.
- Clip rankings measure velocity, not quality or importance.
- Deal prices are USD and were correct at the last refresh only.

## Contact and corrections

Corrections: ${root}/contact — factual errors are fixed and the article is stamped with
an updated date.

## Feeds

- ${root}/rss.xml (English)
- ${root}/ko/rss.xml (Korean)
- ${root}/sitemap-index.xml
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
