import { Marked, type Tokens } from 'marked';
import sanitizeHtml from 'sanitize-html';

// `breaks` keeps single newlines as line breaks: many posts were written for
// LinkedIn/Medium where one line per thought is the norm.
const marked = new Marked({ gfm: true, breaks: true });

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'del'],
  allowedAttributes: {
    a: ['href', 'title', 'rel', 'target'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
  },
  transformTags: {
    a: (tagName, attribs) => {
      const external = /^https?:\/\//.test(attribs.href ?? '');
      return {
        tagName,
        attribs: external ? { ...attribs, target: '_blank', rel: 'noopener noreferrer' } : attribs,
      };
    },
  },
};

/**
 * Renders CMS markdown. Headings are shifted so the highest one becomes <h2>:
 * the page already owns the <h1>, and content may start at ### (e.g. Sapawarga).
 */
export function renderMarkdown(source: string | null | undefined): string {
  if (!source) return '';
  const tokens = marked.lexer(source);
  const headings = tokens.filter((token): token is Tokens.Heading => token.type === 'heading');
  if (headings.length) {
    const shift = Math.min(...headings.map((h) => h.depth)) - 2;
    for (const heading of headings) heading.depth = Math.min(6, Math.max(2, heading.depth - shift));
  }
  return sanitizeHtml(marked.parser(tokens), SANITIZE);
}
