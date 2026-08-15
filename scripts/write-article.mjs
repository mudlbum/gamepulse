#!/usr/bin/env node
/**
 * Turns a research brief into a bilingual article pair.
 *
 * Requires ANTHROPIC_API_KEY. Without it the script exits cleanly and the
 * workflow falls back to committing the brief and opening an issue, so a
 * missing key never breaks the pipeline — you just get a brief to hand to a
 * writer instead of a draft.
 *
 * Everything published this way lands as a PULL REQUEST with draft: true.
 * Nothing reaches the live site without a human merging it. That gate is the
 * difference between an automated publication and a content farm, and it is
 * also what keeps the site on the right side of Google's scaled-content-abuse
 * policy.
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify, log, warn } from './lib/http.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BRIEFS = resolve(ROOT, 'briefs');
const POSTS = resolve(ROOT, 'src/content/posts');

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

const STYLE_RULES = `
VOICE — this is the part that matters most.

You are writing for a publication that competes with Eurogamer and PC Gamer.
Write the way a good staff writer writes on a Tuesday: informed, specific,
faintly opinionated where the evidence earns it, and never padded.

Hard bans. These are the tells that make writing read as machine-generated,
and a single one undermines the whole piece:
- "In conclusion", "Overall", "It's worth noting", "It's important to note"
- "delve", "landscape", "realm", "tapestry", "testament to", "game-changer"
- "In today's fast-paced world", "Let's dive in", "buckle up"
- "Not only... but also", "isn't just X, it's Y" as a rhetorical crutch
- Opening a paragraph with "Additionally", "Moreover", "Furthermore"
- Tricolon padding: "faster, smoother, and more responsive" where one adjective works
- Ending on a rhetorical question, or on "Only time will tell"
- Summarising in the final paragraph what you just said in the article

Do instead:
- Vary sentence length hard. A nine-word sentence after a thirty-word one.
- Lead with the most interesting specific fact, not with context-setting.
- Use concrete numbers in place of adjectives. Not "sales fell sharply" —
  "sales fell 34.4%".
- Say what you think when the evidence supports it, and say what you do not
  know when it does not.
- Short paragraphs. Two to four sentences.
- Second person is fine when addressing the reader's decision ("if you were
  going to buy one").
- End on a forward-looking specific — a number to watch, a date, a tension —
  not a summary.

ACCURACY — non-negotiable:
- Every factual claim must come from the brief's corroborated facts list.
- Anything in "single-sourced" must be attributed in-text ("according to X")
  or omitted. Never stated flatly.
- Anything in "conflicts" must either be resolved against a primary source or
  reported as a discrepancy. Never silently pick one number.
- Do not invent quotes, dates, version numbers, prices or player counts.
- If the brief is too thin to support an article, say so and stop.
`;

async function main() {
  if (!API_KEY) {
    log('write', 'ANTHROPIC_API_KEY not set — skipping generation, brief committed for manual writing.');
    process.exit(0);
  }

  const briefFile = process.argv[2] || (await newestBrief());
  if (!briefFile) {
    log('write', 'no brief found');
    process.exit(0);
  }

  const brief = JSON.parse(await readFile(resolve(BRIEFS, briefFile), 'utf8'));
  log('write', `writing from ${briefFile}`);

  if (brief.facts.length < 4) {
    warn('write', `brief has only ${brief.facts.length} corroborated facts — too thin to publish. Skipping.`);
    process.exit(0);
  }

  const en = await generate(brief, 'en');
  if (!en) process.exit(1);

  const ko = await generate(brief, 'ko', en);
  const translationKey = slugify(en.slug);

  await mkdir(resolve(POSTS, 'en'), { recursive: true });
  await mkdir(resolve(POSTS, 'ko'), { recursive: true });

  await writeFile(resolve(POSTS, 'en', `${en.slug}.md`), en.markdown, 'utf8');
  log('write', `wrote src/content/posts/en/${en.slug}.md`);

  if (ko) {
    await writeFile(resolve(POSTS, 'ko', `${en.slug}.md`), ko.markdown, 'utf8');
    log('write', `wrote src/content/posts/ko/${en.slug}.md`);
  }

  // Surfaced by the workflow into the PR body.
  await writeFile(
    resolve(ROOT, '.article-output.json'),
    JSON.stringify({ slug: en.slug, title: en.title, translationKey, brief: briefFile, hasKorean: !!ko }, null, 2),
    'utf8'
  );
}

async function generate(brief, lang, enVersion = null) {
  const isKo = lang === 'ko';
  const briefMd = await readFile(resolve(BRIEFS, (process.argv[2] || (await newestBrief())).replace(/\.json$/, '.md')), 'utf8').catch(() => '');

  const prompt = isKo
    ? `You are localising a gaming article into Korean for a bilingual publication.

Here is the English article that was just published:

<english_article>
${enVersion.markdown}
</english_article>

Produce the Korean version. This is a localisation, not a literal translation:
- Natural Korean gaming-press register. Use 합니다체.
- Use the Korean names Korean players actually use for games and terms
  (팰월드, 헬다이버스 2, 동시접속자, 패치노트, 천장, 픽업).
- Keep every number, date, version and source URL byte-identical to the English.
- Keep the same structure, headings and links.
- Do not translate the source titles in the frontmatter sources[] array into
  something unrecognisable — a Korean reader should still be able to find them.
- Keep the frontmatter field NAMES in English. Translate only the values.
- lang must be ko. translationKey must be exactly: ${slugify(enVersion.slug)}

${STYLE_RULES}

Return ONLY the complete markdown file with YAML frontmatter. No preamble.`
    : `Write a gaming news article from the research brief below.

<brief>
${briefMd}
</brief>

<structured_brief>
${JSON.stringify({ facts: brief.facts, conflicts: brief.conflicts, singleSourced: brief.singleSourced, sources: brief.sources, ourData: brief.ourData, guidance: brief.guidance }, null, 2)}
</structured_brief>

${STYLE_RULES}

FORMAT — return a complete markdown file with this exact YAML frontmatter shape:

---
title: "..."                # under 100 chars, specific, no clickbait, no colon-subtitle cliche
description: "..."          # 120-260 chars, states what happened and why it matters
lang: en
translationKey: <slug>
pubDate: ${new Date().toISOString().slice(0, 10)}
category: news             # news|guide|review|opinion|esports|patch-notes|hardware|mobile|console|pc
platforms: []              # pc|playstation|xbox|switch|mobile|vr
games: []
tags: []
author: GamePulse Desk
aiAssisted: true
reviewedBy: "Pending human review"
factChecked: true
readingTime: 5
keyTakeaway: "..."         # ONE paragraph, 60-110 words, complete and self-contained.
                           # This is what an AI search engine will quote verbatim,
                           # so it must stand alone with every key number in it.
faq:                       # 3-4 questions real readers would search for
  - q: "..."
    a: "..."               # 40-80 words, factual, answerable from the brief alone
sources:                   # EVERY url you actually used
  - title: "..."
    url: "..."
    publisher: "..."
    accessed: "${new Date().toISOString().slice(0, 10)}"
---

Then the body: 700-1100 words, H2 subheads (## ), no H1 in the body.
Link inline to primary sources where you cite them.
Where our own leaderboard data is relevant, cite it and link to /leaderboards.

Return ONLY the markdown file. No preamble, no explanation.`;

  const res = await callAnthropic(prompt);
  if (!res) return null;

  const markdown = res.replace(/^```(?:markdown|md)?\s*\n/, '').replace(/\n```\s*$/, '').trim();

  const titleMatch = markdown.match(/^title:\s*["']?(.+?)["']?\s*$/m);
  const title = titleMatch ? titleMatch[1] : brief.workingTitle;
  const slug = enVersion ? enVersion.slug : slugify(title).slice(0, 70);

  // Force draft:true regardless of what the model produced. Publication is a
  // human decision, always.
  const withDraft = /^draft:/m.test(markdown)
    ? markdown.replace(/^draft:.*$/m, 'draft: true')
    : markdown.replace(/^---\n/, '---\ndraft: true\n');

  const fixed = withDraft.replace(/^translationKey:.*$/m, `translationKey: ${slug}`);

  return { markdown: fixed, title, slug };
}

async function callAnthropic(prompt) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      warn('write', `Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return null;
    }
    const json = await res.json();
    return json.content?.map((c) => c.text ?? '').join('') ?? null;
  } catch (err) {
    warn('write', `API call failed: ${err.message}`);
    return null;
  }
}

async function newestBrief() {
  try {
    const files = (await readdir(BRIEFS)).filter((f) => f.endsWith('.json') && f !== 'latest.json').sort();
    return files[files.length - 1] ?? null;
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error('Article generation failed:', err);
  process.exit(1);
});
