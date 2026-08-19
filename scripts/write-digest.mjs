#!/usr/bin/env node
/**
 * The daily data digest.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT AN LLM.
 *
 * The news pipeline (generate-brief → select-story → write-article) publishes
 * only when a story clears an evidence gate, needs an API key, and is by
 * construction a write-up of other people's reporting. This is the opposite on
 * all three counts: it never calls a model, it needs no credentials, and every
 * number in it is ours — measured by our own collectors, timestamped, and
 * checkable against the live pages on this site.
 *
 * That distinction matters beyond convenience. Google's scaled-content-abuse
 * policy is aimed at bulk-produced pages that add nothing a reader could not
 * get elsewhere. A daily page of first-party measurements is the one kind of
 * daily page that is not that: nobody else is publishing our 24-hour deltas,
 * because nobody else has them.
 *
 * It still refuses to publish on a genuinely dead day — see `notable()`. A
 * digest that reports "nothing moved" every day would be padding, and padding
 * is the thing we are avoiding.
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { log, warn } from './lib/http.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POSTS = resolve(ROOT, 'src/content/posts');

/** A mover has to move this much before it is worth a reader's attention. */
const MOVE_PCT = 8;
/** How many risers/fallers to name. */
const MOVERS = 4;
/** A patch note counts as "today's" within this window. */
const FRESH_HOURS = 26;
/** Link a mover to its patch notes only if they are recent enough to plausibly
    explain the movement. Beyond this it is a coincidence, not a cause. */
const PATCH_LINK_DAYS = 7;

const num = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US') : '—');
const pct = (n) => (Number.isFinite(n) ? `${n > 0 ? '+' : ''}${n.toFixed(1)}%` : '—');
const hoursSince = (iso) => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? (Date.now() - t) / 3600_000 : Infinity;
};
const absPct = (n) => (Number.isFinite(n) ? `${Math.abs(n).toFixed(1)}%` : '—');
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');
/* Some publisher feeds emit site-relative URLs (Bungie's returns
   "/7/en/News/Article/..."). Our markdown pipeline rewrites root-relative links
   onto this site's base path, which would turn one of those into a 404 on
   gamepulse. Link only what is unambiguously absolute; keep the rest as plain
   text so the item is still reported. */
const linkOr = (label, url) => (/^https?:\/\//i.test(String(url ?? '')) ? `[${label}](${url})` : label);
const yaml = (s) => `"${String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

async function readData(name) {
  try {
    return JSON.parse(await readFile(resolve(ROOT, 'src/data', `${name}.json`), 'utf8'));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */

async function main() {
  const [leaderboard, updates, deals, mobile] = await Promise.all(
    ['leaderboard', 'updates', 'deals', 'mobile'].map(readData)
  );

  if (!leaderboard?.entries?.length) {
    warn('digest', 'no leaderboard data — refusing to publish a digest with no numbers in it');
    return finish(null, 'leaderboard data missing');
  }
  if (leaderboard._stale) {
    warn('digest', 'leaderboard is flagged stale — publishing yesterday\'s numbers under today\'s date would be a lie');
    return finish(null, 'leaderboard data is stale');
  }

  const facts = collect({ leaderboard, updates, deals, mobile });
  const why = notable(facts);
  if (why) {
    log('digest', `nothing worth publishing — ${why}`);
    return finish(null, why);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const key = `daily-pulse-${stamp}`;

  const existing = await readdir(resolve(POSTS, 'en')).catch(() => []);
  if (existing.some((f) => f.includes(key))) {
    log('digest', `${key} already published today — nothing to do`);
    return finish(null, 'already published today');
  }

  for (const lang of ['en', 'ko']) {
    const body = render(facts, lang, stamp, key);
    await mkdir(resolve(POSTS, lang), { recursive: true });
    await writeFile(resolve(POSTS, lang, `${key}.md`), body, 'utf8');
  }

  log('digest', `wrote ${key} (en + ko) — lead: ${facts.lead.kind}`);
  return finish(key, null, facts);
}

/* ---------------- what the data actually says ---------------- */

function collect({ leaderboard, updates, deals, mobile }) {
  const entries = leaderboard.entries.filter((e) => Number.isFinite(e.current));
  const moved = entries.filter((e) => Number.isFinite(e.change24h));

  const risers = moved
    .filter((e) => e.change24h >= MOVE_PCT)
    .sort((a, b) => b.change24h - a.change24h)
    .slice(0, MOVERS);
  const fallers = moved
    .filter((e) => e.change24h <= -MOVE_PCT)
    .sort((a, b) => a.change24h - b.change24h)
    .slice(0, MOVERS);

  const top = entries.slice().sort((a, b) => b.current - a.current).slice(0, 5);

  /* Patch notes published since yesterday, and — separately — patch notes that
     might explain a mover. The second is the only genuinely editorial thing
     this script does, and it is stated as a coincidence in time, not a cause. */
  const games = updates?.games ?? [];
  const freshPatches = games
    .filter((g) => g.latest?.title && hoursSince(g.latest.date) <= FRESH_HOURS)
    .sort((a, b) => Date.parse(b.latest.date) - Date.parse(a.latest.date))
    .slice(0, 6);

  const patchFor = (name) => {
    const n = String(name).toLowerCase();
    return games.find((g) => {
      if (!g.latest?.title) return false;
      const gn = String(g.game).toLowerCase();
      const hit = n.includes(gn.slice(0, 8)) || gn.includes(n.slice(0, 8));
      return hit && hoursSince(g.latest.date) <= PATCH_LINK_DAYS * 24;
    });
  };

  const freeNow = (deals?.freeNow ?? []).slice(0, 4);
  const freeSoon = (deals?.freeSoon ?? []).slice(0, 3);
  /* Sorting purely by discount percentage surfaces the same 96%-off catalogue
     filler every single day — technically the biggest saving, useless to a
     reader, and exactly the texture of a spam page. The dataset is full of it:
     of 24 discounts in a typical run, 19 are asset-flip titles at 95% off.
     A Metacritic score is the one signal in this feed that reliably separates
     a game that was actually released and reviewed from one that was not, so
     that is the bar. A tracked game passes regardless — if it is in our top 60
     it is a real game by definition. If nothing qualifies, the table is simply
     omitted rather than padded. */
  const trackedIds = new Set(entries.map((e) => String(e.appid)));
  const seenTitle = new Set();
  const discounts = (deals?.discounts ?? [])
    .filter(
      (d) =>
        Number.isFinite(d.savings) &&
        d.savings >= 50 &&
        Number.isFinite(d.salePrice) &&
        (Number(d.metacritic) >= 65 || trackedIds.has(String(d.steamAppId)))
    )
    .sort((a, b) => b.savings - a.savings || a.salePrice - b.salePrice)
    .filter((d) => {
      // The same game shows up once per store. Keep the best offer only.
      const k = String(d.title).toLowerCase().trim();
      if (seenTitle.has(k)) return false;
      seenTitle.add(k);
      return true;
    })
    .slice(0, 5);

  const charts = mobile?.charts ?? {};
  const mobileTop = Object.entries(charts)
    .map(([cc, c]) => ({ cc, label: c.label, labelKo: c.labelKo, top: (c.entries ?? [])[0] }))
    .filter((m) => m.top);
  const mobileUpdated = Object.values(charts)
    .flatMap((c) => c.entries ?? [])
    .filter((e) => e.version && hoursSince(e.versionDate) <= FRESH_HOURS)
    .slice(0, 4);

  const lead = pickLead({ risers, fallers, freshPatches, top });

  return {
    updated: leaderboard.updated,
    metric: leaderboard.metric,
    totalPlayers: leaderboard.totalPlayers,
    tracked: entries.length,
    top,
    risers,
    fallers,
    patchFor,
    freshPatches,
    freeNow,
    freeSoon,
    discounts,
    mobileTop,
    mobileUpdated,
    lead,
  };
}

/** The single most interesting thing in today's data. Drives the headline, so
    that 365 digests a year do not all open the same way. */
function pickLead({ risers, fallers, freshPatches, top }) {
  const r = risers[0];
  const f = fallers[0];
  const biggest =
    r && f ? (Math.abs(r.change24h) >= Math.abs(f.change24h) ? r : f) : r || f || null;
  if (biggest) {
    return { kind: biggest.change24h > 0 ? 'riser' : 'faller', entry: biggest };
  }
  if (freshPatches.length) return { kind: 'patch', patch: freshPatches[0] };
  return { kind: 'steady', entry: top[0] };
}

/** Returns a reason to NOT publish, or null to go ahead. */
function notable(f) {
  if (f.risers.length || f.fallers.length) return null;
  if (f.freshPatches.length) return null;
  if (f.freeNow.length) return null;
  return `no game moved ${MOVE_PCT}% in 24h, no patch notes in ${FRESH_HOURS}h, nothing new free`;
}

/* ---------------- rendering ---------------- */

const T = {
  en: {
    lead_riser: (e) => `${e.name} is up ${absPct(e.change24h)} in 24 hours`,
    lead_faller: (e) => `${e.name} is down ${absPct(e.change24h)} in 24 hours`,
    lead_patch: (p) => `${p.game} shipped patch notes overnight`,
    lead_steady: (e) => `${e.name} still leads Steam with ${num(e.current)} playing`,
    subtitle: 'the rest of what our trackers logged today',
    h_now: 'Where the numbers stand',
    h_movers: 'Biggest 24-hour moves',
    h_patch: 'Publisher posts since yesterday',
    h_timing: 'Timing worth noting',
    h_deals: 'Free and heavily discounted right now',
    h_mobile: 'Mobile',
    h_method: 'How this page was made',
    col_game: 'Game', col_players: 'Concurrent', col_24h: '24h', col_rank: 'Rank',
    col_save: 'Discount', col_price: 'Price', col_store: 'Store',
    rising: 'Rising', falling: 'Falling',
    no_movers: 'No game in the tracked top 60 moved more than 8% either way in the last 24 hours.',
    patch_link: (t, u, d) => `the publisher's most recent post — ${linkOr(t, u)} — went up ${d}. We are noting the timing, not claiming it caused the move.`,
    free_soon: 'Free next',
    mobile_top: (label, name, ratings) => `**${label}**: ${name} leads our tracked roster with ${num(ratings)} lifetime App Store ratings.`,
    mobile_upd: 'App updates in the last day',
    method: [
      'Every figure above was measured by GamePulse itself and is timestamped. Steam concurrents come from Valve\'s public charts API, sampled every 30 minutes; the 24-hour change compares the current sample against the closest sample to 24 hours ago, and is left blank rather than guessed when there is no usable earlier sample.',
      'Patch notes are pulled from each publisher\'s own feed. Prices come from CheapShark and the Epic Games Store promotions endpoint. App Store figures are lifetime rating counts from Apple\'s iTunes Lookup API — a popularity proxy, not a player count, because Apple publishes no player numbers for anyone.',
      'This page is assembled by a script from that data. No language model wrote any part of it, and nothing in it is an estimate. If a number here disagrees with the live page it links to, the live page is newer.',
    ],
    see_live: 'Live leaderboard',
  },
  ko: {
    lead_riser: (e) => `${e.name}, 24시간 만에 ${absPct(e.change24h)} 상승`,
    lead_faller: (e) => `${e.name}, 24시간 만에 ${absPct(e.change24h)} 하락`,
    lead_patch: (p) => `${p.game} 패치 노트가 밤사이 올라왔습니다`,
    lead_steady: (e) => `${e.name}가 동시접속 ${num(e.current)}명으로 스팀 1위를 지켰습니다`,
    subtitle: '오늘 트래커가 기록한 나머지 수치',
    h_now: '현재 수치',
    h_movers: '24시간 변동 폭이 가장 큰 게임',
    h_patch: '어제 이후 올라온 퍼블리셔 소식',
    h_timing: '눈여겨볼 시점',
    h_deals: '지금 무료이거나 크게 할인 중인 게임',
    h_mobile: '모바일',
    h_method: '이 페이지가 만들어진 방식',
    col_game: '게임', col_players: '동시접속', col_24h: '24시간', col_rank: '순위',
    col_save: '할인율', col_price: '가격', col_store: '상점',
    rising: '상승', falling: '하락',
    no_movers: '지난 24시간 동안 추적 중인 스팀 상위 60개 게임 가운데 8% 이상 움직인 게임은 없습니다.',
    patch_link: (t, u, d) => `퍼블리셔의 가장 최근 게시물 ${linkOr(t, u)}이(가) ${d}에 올라왔습니다. 시점을 적어둘 뿐, 이것이 원인이라고 주장하지는 않습니다.`,
    free_soon: '곧 무료',
    mobile_top: (label, name, ratings) => `**${label}**: 추적 목록 기준 ${name}가 앱스토어 누적 평가 ${num(ratings)}건으로 선두입니다.`,
    mobile_upd: '최근 하루 사이 업데이트된 앱',
    method: [
      '위의 모든 수치는 GamePulse가 직접 측정했으며 측정 시각이 함께 기록됩니다. 스팀 동시접속자는 밸브의 공개 차트 API에서 30분마다 수집하며, 24시간 변동은 현재 표본과 24시간 전에 가장 가까운 표본을 비교한 값입니다. 쓸 만한 과거 표본이 없으면 추정하지 않고 비워 둡니다.',
      '패치 노트는 각 퍼블리셔의 공식 피드에서 가져옵니다. 가격 정보는 CheapShark와 에픽게임즈 스토어 프로모션 API에서, 앱스토어 수치는 애플 iTunes Lookup API의 누적 평가 수에서 옵니다. 애플은 어떤 앱에 대해서도 이용자 수를 공개하지 않기 때문에, 평가 수는 인기도의 대리 지표일 뿐 이용자 수가 아닙니다.',
      '이 페이지는 위 데이터를 바탕으로 스크립트가 조립합니다. 어떤 부분도 언어 모델이 쓰지 않았고, 추정치는 하나도 없습니다. 여기 수치가 링크된 실시간 페이지와 다르다면 실시간 페이지가 더 최신입니다.',
    ],
    see_live: '실시간 리더보드',
  },
};

function headline(f, lang) {
  const t = T[lang];
  const { lead } = f;
  if (lead.kind === 'riser') return t.lead_riser(lead.entry);
  if (lead.kind === 'faller') return t.lead_faller(lead.entry);
  if (lead.kind === 'patch') return t.lead_patch(lead.patch);
  return t.lead_steady(lead.entry);
}

function render(f, lang, stamp, key) {
  const t = T[lang];
  const L = [];
  const head = headline(f, lang);
  const title = `${head} — ${t.subtitle}`.slice(0, 118);
  const seoTitle = head.slice(0, 63);

  const movers = [...f.risers, ...f.fallers];
  const games = [...new Set(movers.map((m) => m.name))].slice(0, 6);

  const takeaway =
    lang === 'en'
      ? `${head}. Across the ${f.tracked} Steam games we track, ${f.risers.length} gained more than ${MOVE_PCT}% in the last 24 hours and ${f.fallers.length} lost more than ${MOVE_PCT}%. ${f.freshPatches.length} publisher${f.freshPatches.length === 1 ? '' : 's'} shipped patch notes since yesterday, and ${f.freeNow.length} game${f.freeNow.length === 1 ? ' is' : 's are'} free to claim right now. All figures measured by GamePulse at ${f.updated}.`
      : `${head}. 추적 중인 스팀 게임 ${f.tracked}개 가운데 지난 24시간 동안 ${MOVE_PCT}% 이상 오른 게임이 ${f.risers.length}개, 같은 폭으로 내린 게임이 ${f.fallers.length}개입니다. 어제 이후 패치 노트를 낸 퍼블리셔는 ${f.freshPatches.length}곳이고, 지금 무료로 받을 수 있는 게임은 ${f.freeNow.length}개입니다. 모든 수치는 ${f.updated} 기준으로 GamePulse가 측정했습니다.`;

  const description =
    lang === 'en'
      ? `${head} — plus every other 24-hour move, patch note and price drop our trackers logged on ${stamp}. First-party numbers, timestamped and checkable.`.slice(0, 295)
      : `${head} — 그 밖에 ${stamp}에 트래커가 기록한 24시간 변동, 패치 노트, 가격 인하를 모두 정리했습니다. 직접 측정한 수치이며 시각과 출처를 함께 남깁니다.`.slice(0, 295);

  /* ---- frontmatter ---- */
  L.push('---');
  L.push(`title: ${yaml(title)}`);
  L.push(`seoTitle: ${yaml(seoTitle)}`);
  L.push(`description: ${yaml(description)}`);
  L.push(`lang: ${lang}`);
  L.push(`translationKey: ${key}`);
  L.push(`pubDate: ${stamp}`);
  L.push('category: news');
  L.push('platforms: ["pc", "mobile"]');
  L.push(`games: [${games.map((g) => yaml(g)).join(', ')}]`);
  L.push(
    lang === 'en'
      ? 'tags: ["daily", "Steam", "player counts", "patch notes", "deals"]'
      : 'tags: ["데일리", "스팀", "동시접속자", "패치 노트", "할인"]'
  );
  L.push('author: GamePulse Trackers');
  /* Not AI-assisted and not human-reviewed: assembled from measurements. The
     badge on the page says exactly that rather than borrowing a label that
     would overstate or understate what happened. */
  L.push('aiAssisted: false');
  L.push('factChecked: false');
  L.push('dataGenerated: true');
  L.push(`keyTakeaway: ${yaml(takeaway)}`);
  L.push('sources:');
  L.push('  - title: "Steam Charts — most played games"');
  L.push('    url: "https://store.steampowered.com/charts/mostplayed"');
  L.push('    publisher: "Valve"');
  L.push(`    accessed: "${stamp}"`);
  if (f.freeNow.length || f.discounts.length) {
    L.push('  - title: "CheapShark price API"');
    L.push('    url: "https://apidocs.cheapshark.com/"');
    L.push('    publisher: "CheapShark"');
    L.push(`    accessed: "${stamp}"`);
    L.push('  - title: "Epic Games Store free games"');
    L.push('    url: "https://store.epicgames.com/free-games"');
    L.push('    publisher: "Epic Games"');
    L.push(`    accessed: "${stamp}"`);
  }
  if (f.mobileTop.length) {
    L.push('  - title: "Apple iTunes Lookup API"');
    L.push('    url: "https://performance-partners.apple.com/search-api"');
    L.push('    publisher: "Apple"');
    L.push(`    accessed: "${stamp}"`);
  }
  L.push('---');
  L.push('');

  /* ---- body ---- */
  L.push(`## ${t.h_now}`, '');
  L.push(`| ${t.col_rank} | ${t.col_game} | ${t.col_players} | ${t.col_24h} |`);
  L.push('| --- | --- | ---: | ---: |');
  for (const e of f.top) L.push(`| ${e.rank} | ${linkOr(esc(e.name), e.url)} | ${num(e.current)} | ${pct(e.change24h)} |`);
  L.push('');

  L.push(`## ${t.h_movers}`, '');
  if (!movers.length) {
    L.push(t.no_movers, '');
  } else {
    if (f.risers.length) {
      L.push(`**${t.rising}**`, '');
      for (const e of f.risers) L.push(`- **${esc(e.name)}** ${pct(e.change24h)} → ${num(e.current)}`);
      L.push('');
    }
    if (f.fallers.length) {
      L.push(`**${t.falling}**`, '');
      for (const e of f.fallers) L.push(`- **${esc(e.name)}** ${pct(e.change24h)} → ${num(e.current)}`);
      L.push('');
    }
    // The only inference on the page, and it is labelled as one.
    const timing = [];
    for (const e of movers.slice(0, 3)) {
      const p = f.patchFor(e.name);
      if (!p) continue;
      const days = Math.round(hoursSince(p.latest.date) / 24);
      const when =
        lang === 'en'
          ? days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
          : days <= 0 ? '오늘' : days === 1 ? '어제' : `${days}일 전`;
      timing.push(`- ${esc(e.name)}: ${t.patch_link(esc(p.latest.title), p.latest.url, when)}`);
    }
    if (timing.length) {
      L.push(`**${t.h_timing}**`, '');
      L.push(...timing);
    }
    L.push('');
  }

  if (f.freshPatches.length) {
    L.push(`## ${t.h_patch}`, '');
    for (const g of f.freshPatches) L.push(`- **${esc(g.game)}** — ${linkOr(esc(g.latest.title), g.latest.url)}`);
    L.push('');
  }

  if (f.freeNow.length || f.discounts.length || f.freeSoon.length) {
    L.push(`## ${t.h_deals}`, '');
    for (const d of f.freeNow) {
      const claim = /^https?:\/\//i.test(String(d.url ?? '')) ? ` · ${linkOr(lang === 'en' ? 'claim' : '받기', d.url)}` : '';
      L.push(`- **${esc(d.title)}** — ${esc(d.store)}${claim}`);
    }
    if (f.freeSoon.length) {
      L.push('');
      L.push(`**${t.free_soon}**`, '');
      for (const d of f.freeSoon) L.push(`- ${esc(d.title)} — ${esc(d.store)}`);
    }
    if (f.discounts.length) {
      L.push('');
      L.push(`| ${t.col_game} | ${t.col_save} | ${t.col_price} | ${t.col_store} |`);
      L.push('| --- | ---: | ---: | --- |');
      for (const d of f.discounts)
        L.push(`| ${esc(d.title)} | ${Math.round(d.savings)}% | $${d.salePrice.toFixed(2)} | ${esc(d.store)} |`);
    }
    L.push('');
  }

  if (f.mobileTop.length || f.mobileUpdated.length) {
    L.push(`## ${t.h_mobile}`, '');
    for (const m of f.mobileTop) {
      const label = lang === 'ko' ? m.labelKo || m.label : m.label;
      L.push(`- ${t.mobile_top(esc(label), esc(m.top.name), m.top.ratings)}`);
    }
    if (f.mobileUpdated.length) {
      L.push('');
      L.push(`**${t.mobile_upd}**`, '');
      for (const e of f.mobileUpdated) L.push(`- ${esc(e.name)} → ${esc(e.version)}`);
    }
    L.push('');
  }

  L.push(`## ${t.h_method}`, '');
  for (const p of t.method) L.push(p, '');
  L.push(`[${t.see_live}](${lang === 'ko' ? '/ko/leaderboards' : '/leaderboards'})`, '');

  return L.join('\n');
}

async function finish(key, skipReason, facts) {
  if (key) {
    await writeFile(
      resolve(ROOT, '.digest-output.json'),
      JSON.stringify(
        {
          key,
          title: facts ? headline(facts, 'en') : key,
          lead: facts?.lead?.kind ?? null,
          generated: new Date().toISOString(),
        },
        null,
        2
      ),
      'utf8'
    );
  }
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_OUTPUT, `wrote=${key ? 'true' : 'false'}\nkey=${key ?? ''}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      key
        ? `### Daily data digest\n\nPublished \`${key}\` (EN + KO). Lead: **${facts?.lead?.kind}**.\n`
        : `### Daily data digest\n\nNothing published — ${skipReason}.\n`
    );
  }
}

export { collect, notable, render, pickLead };

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Digest generation failed:', err);
    process.exit(1);
  });
}
