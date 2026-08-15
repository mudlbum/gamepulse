/**
 * Prefix root-relative links and images inside markdown with the site's base
 * path.
 *
 * Astro rewrites base paths in .astro templates (via our href() helper) but
 * does NOT touch markdown bodies. So an article that links to `/leaderboards`
 * works on a user site and 404s on a project site served from `/repo/`.
 *
 * This matters more than a one-off fix because the automated article writer is
 * instructed to link internally, and it will keep emitting root-relative
 * hrefs. Handling it at build time means neither a human nor the model has to
 * remember the base path.
 *
 * Left alone: absolute URLs, protocol-relative URLs, anchors, mailto/tel, and
 * anything already carrying the prefix.
 */
export function rehypeBasePath({ base = '/' } = {}) {
  const prefix = base.endsWith('/') ? base : base + '/';
  const needsWork = prefix !== '/';

  return function transformer(tree) {
    if (!needsWork) return;
    visit(tree);
  };

  function visit(node) {
    if (node.type === 'element') {
      if (node.tagName === 'a') rewrite(node, 'href');
      if (node.tagName === 'img') rewrite(node, 'src');
      if (node.tagName === 'source') rewrite(node, 'srcset');
    }
    if (Array.isArray(node.children)) for (const child of node.children) visit(child);
  }

  function rewrite(node, attr) {
    const value = node.properties?.[attr];
    if (typeof value !== 'string' || !value) return;
    if (!value.startsWith('/')) return;      // relative, anchor, mailto, tel
    if (value.startsWith('//')) return;      // protocol-relative
    if (value.startsWith(prefix)) return;    // already prefixed
    node.properties[attr] = prefix + value.slice(1);
  }
}
