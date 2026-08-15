import type { APIContext } from 'astro';
import { SITE } from '../config';

export async function GET(context: APIContext) {
  const origin = context.site?.origin ?? SITE.url;

  /**
   * AI crawlers are allowed on purpose.
   *
   * The GEO half of the brief depends on it: if GPTBot, ClaudeBot, PerplexityBot
   * and Google-Extended cannot read the site, the site cannot be cited in an AI
   * answer. Blocking them protects content from training but also removes the
   * traffic and attribution that generative search sends back. Flip any of these
   * to Disallow if that trade stops being worth it.
   */
  const body = `# ${SITE.name}
# Full policy: ${origin}/editorial-policy

User-agent: *
Allow: /
Disallow: /search
Disallow: /*?q=

# Search engines
User-agent: Googlebot
Allow: /

User-agent: Googlebot-News
Allow: /

User-agent: Bingbot
Allow: /

User-agent: Yeti
Allow: /

User-agent: Daum
Allow: /

# AI / answer engines — allowed so this site can be cited in AI answers.
User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-User
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Applebot-Extended
Allow: /

User-agent: CCBot
Allow: /

# Structured summary for language models
# ${origin}/llms.txt

Sitemap: ${origin}/sitemap-index.xml
Host: ${new URL(origin).host}
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
