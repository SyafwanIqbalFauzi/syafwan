// Turns the Obsidian vault ("[999] Brains") into plain objects shaped like the
// Directus collections. No network access here, so it can be reviewed with --dry-run.
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import matter from 'gray-matter';

// ---------------------------------------------------------------------------
// Copy agreed with Syafwan (not in the vault): hero headline, highlights, "How I work".
// ---------------------------------------------------------------------------
const HEADLINE = 'I listen to users, align with the business, and ship what serves both.';

const HIGHLIGHTS = [
  { value: '20+', label: 'digital products launched' },
  { value: '3', label: 'ministries & agencies on GeoDashboard' },
  { value: 'IDR 60B', label: 'monthly tax revenue via Sapawarga' },
  { value: '500K+', label: 'Sapawarga downloads in year one' },
];

const PRINCIPLES = [
  {
    title: 'Problem before solution',
    description:
      'I spend more time understanding the problem than admiring the solution. A clever feature that solves the wrong problem is still the wrong feature.',
  },
  {
    title: 'An MVP is an experiment',
    description:
      "An MVP isn't a half-built product. It's the fastest way to test an assumption, and sometimes that means a prototype, a form, or a conversation before any code.",
  },
  {
    title: '"Not yet" over "no"',
    description:
      'Every stakeholder request carries a real need. I dig for that need first, then we decide together what to build now and what can wait.',
  },
  {
    title: 'Ship steadily',
    description:
      'Small, steady releases build more trust than big, rare launches. Consistency is how a team learns, and how users feel the product getting better.',
  },
];

export const FEATURED = [
  'geodashboard-penegakan-hukum-kehutanan',
  'geodashboard-ketaatan-lingkungan-perusahaan',
  'sapawarga',
  'sidebar',
];

// Card summaries for notes whose first sentence only makes sense next to the others.
const SUMMARY_OVERRIDES = {
  'geodashboard-penegakan-hukum-kehutanan':
    'GeoDashboard for Kementerian Kehutanan: forestry law-enforcement and budget performance, fire hotspots, and spatial analysis of parties around each hotspot.',
  'geodashboard-ketaatan-lingkungan-perusahaan':
    'GeoDashboard for Kementerian Lingkungan Hidup that automates corporate environmental compliance checks with rule-based analysis, AI, and a RAG assistant.',
  'geodashboard-dashboard-spasial-gizi-nasional':
    "GeoDashboard for Badan Gizi Nasional mapping the nutrition program's kitchens (SPPG) and the schools they serve.",
};

const PUBLISHED_POST_STATUSES = new Set(['done', 'posted']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export const slugify = (value) =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const readNote = (path) => matter(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'));
const listNotes = (dir) => readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('!'));
const noteName = (file) => basename(file, '.md');

const wikiToText = (md) => md.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias ?? target);
const tidy = (md) => md.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();

/** Splits a note body on `## ` headings. Keys are lowercased, emoji/punctuation stripped. */
function sections(body) {
  const out = { _intro: [] };
  let key = '_intro';
  for (const line of body.split('\n')) {
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) {
      key = heading[1].replace(/[^\p{L}\p{N} ]/gu, '').trim().toLowerCase();
      out[key] = [];
    } else {
      out[key].push(line);
    }
  }
  return Object.fromEntries(Object.entries(out).map(([k, lines]) => [k, lines.join('\n').trim()]));
}

/** Normalises "•" bullets and drops blank lines between list items. */
const bulletList = (md = '') =>
  md
    .split('\n')
    .map((line) => line.replace(/^\s*•\s*/, '- '))
    .filter((line) => line.trim())
    .join('\n');

const plainText = (md) =>
  md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** First paragraph, trimmed to one sentence and at most ~200 characters. */
function summarize(md, max = 200) {
  const paragraph = md
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .find((p) => p && !/^(#|\*\*[^*]+\*\*:?$|- |\d+\. |---)/.test(p));
  if (!paragraph) return null;
  const text = plainText(paragraph);
  const sentence = text.split(/(?<=[.!?])\s+/)[0];
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, agu: 8, agt: 8,
  sep: 9, sept: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12,
};

/** "Okt 2024" -> "2024-10-01"; "Present" -> null. */
function monthYear(value) {
  const match = value?.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (!month) throw new Error(`Unknown month "${match[1]}"`);
  return `${match[2]}-${String(month).padStart(2, '0')}-01`;
}

/** "2019, 2020, 2021" / "2022 - 2025" / "2025-" -> { year_start, year_end, is_ongoing } */
function years(...values) {
  const strings = values.filter((v) => v !== undefined && v !== null).map(String);
  const nums = strings.flatMap((s) => s.match(/\d{4}/g) ?? []).map(Number);
  const ongoing = strings.some((s) => /-\s*$/.test(s.trim()));
  const start = nums.length ? Math.min(...nums) : null;
  const end = nums.length ? Math.max(...nums) : null;
  return { year_start: start, year_end: ongoing || end === start ? null : end, is_ongoing: ongoing };
}

/** Rough language guess for posts: share of common Indonesian function words. */
function detectLanguage(text) {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const indonesian = new Set([
    'yang', 'dan', 'saya', 'itu', 'ini', 'gak', 'nggak', 'aja', 'kita', 'buat', 'untuk', 'dengan', 'dari',
    'kalau', 'kalo', 'jadi', 'tapi', 'juga', 'udah', 'sama', 'bisa', 'lebih', 'dulu', 'apa', 'ada', 'ke',
  ]);
  const hits = words.filter((w) => indonesian.has(w)).length;
  return hits / Math.max(words.length, 1) > 0.04 ? 'id-ID' : 'en-US';
}

/** 𝗯𝗼𝗹𝗱 Unicode math letters (LinkedIn-style) -> **bold** */
const unicodeBoldToMarkdown = (md) =>
  md.replace(/[\u{1D400}-\u{1D7FF}]+(?:[ \t]+[\u{1D400}-\u{1D7FF}]+)*/gu, (run) => `**${run.normalize('NFKC')}**`);

const isoDate = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------
function parseProfile(root) {
  const cv = sections(readNote(join(root, 'CV', '!CV.md')).content);
  const field = (label) => cv.kontak.match(new RegExp(`^- ${label}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? null;
  const linkedin = field('LinkedIn');

  const about = readFileSync(join(root, 'Linkedin', 'About.md'), 'utf8').replace(/\r\n/g, '\n');
  const future = about.split('**To be October 2026**')[1] ?? '';
  const shortBio = future
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .find((p) => p.startsWith("I'm "));

  const spokenLanguages = [...cv.languages.matchAll(/^- (.+?) — (.+)$/gm)].map(([, name, level]) => ({ name, level }));

  // The phone number in the CV is deliberately never read.
  return {
    full_name: 'Syafwan Iqbal Fauzi',
    email: field('Email'),
    linkedin_url: linkedin ? `https://www.${linkedin.replace(/^https?:\/\/(www\.)?/, '')}` : null,
    location: field('Lokasi'),
    translations: [
      {
        languages_code: 'en-US',
        headline: HEADLINE,
        short_bio: shortBio ?? null,
        summary: cv.summary,
        highlights: HIGHLIGHTS,
        principles: PRINCIPLES,
        spoken_languages: spokenLanguages,
      },
    ],
  };
}

function parseProjects(root) {
  const dir = join(root, 'CV', 'Portfolio');
  const index = readFileSync(join(dir, '!Daftar Portfolio.md'), 'utf8');
  const rows = [...index.matchAll(/^\|\s*\[\[([^\]]+)\]\]\s*\|\s*([^|]*)\|\s*([^|]*)\|/gm)].map(([, name, , year]) => ({
    name: name.trim(),
    year: year.trim(),
  }));
  const order = new Map(rows.map((r, i) => [r.name, i]));
  const indexYear = new Map(rows.map((r) => [r.name, r.year]));

  const projects = [];
  for (const file of listNotes(dir)) {
    const { data, content } = readNote(join(dir, file));
    if (!data.type) continue; // legacy stubs ("X - Y.md" without `type`) are ignored
    const name = noteName(file);
    const parts = sections(content);
    const description = tidy(wikiToText(parts.description ?? ''));
    const cover = content.match(/!\[\[([^\]]+\.(?:png|jpe?g|webp|gif))\]\]/i)?.[1] ?? null;
    const url = description.match(/\[([a-z0-9-]+(?:\.[a-z0-9-]+)+)\]\((https?:\/\/[^)]+)\)/i)?.[2] ?? null;
    const slug = slugify(name);
    projects.push({
      slug,
      title: name.replace(/ - /g, ' — '),
      status: 'published',
      sort: order.get(name) ?? 999,
      type: String(data.type).toLowerCase(),
      client: data.client ?? null,
      ...years(data.year, indexYear.get(name)),
      platforms: String(data.platform ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      roles: String(data.role ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      featured: FEATURED.includes(slug),
      url,
      cover, // file name in Files/, uploaded by the importer
      translations: [
        { languages_code: 'en-US', summary: SUMMARY_OVERRIDES[slug] ?? summarize(description), body: description },
      ],
    });
  }
  return projects.sort((a, b) => a.sort - b.sort).map((p, i) => ({ ...p, sort: i + 1 }));
}

function parseExperiences(root) {
  const dir = join(root, 'CV', 'Work Experience');
  const experiences = listNotes(dir).map((file) => {
    const { data, content } = readNote(join(dir, file));
    const parts = sections(content);
    const introLines = parts._intro
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    const location = introLines.find((l) => l.startsWith('📍'))?.replace(/^📍\s*/, '') ?? null;
    const context = introLines
      .filter((l) => !l.startsWith('📍'))
      .map((l) => l.replace(/^[^\p{L}\p{N}]+/u, '').replace(/\.$/, ''))
      .join(' · ');

    const rawRole = String(data.role);
    const rawCompany = String(data.company);
    const employmentType = /intern/i.test(rawRole)
      ? 'internship'
      : /contract/i.test(rawCompany)
        ? 'contract'
        : /apiary|student|apprentice/i.test(`${rawRole} ${rawCompany}`)
          ? 'apprenticeship'
          : 'full_time';
    const [start, end] = String(data.period).split(/\s+-\s+/);

    return {
      company: rawCompany.replace(/\s*\((contract|internship)\)\s*/i, '').trim(),
      location,
      employment_type: employmentType,
      start_date: monthYear(start),
      end_date: /present/i.test(end ?? '') ? null : monthYear(end),
      status: 'published',
      projects: [...(parts['produk terkait'] ?? '').matchAll(/\[\[([^\]|]+)/g)].map(([, name]) => slugify(name)),
      translations: [
        {
          languages_code: 'en-US',
          role: rawRole.replace(/\s*\((internship|contract)\)\s*/i, '').replace(/ - /g, ' — ').trim(),
          context: context || null,
          responsibilities: bulletList(parts.responsibilities) || null,
          achievements: bulletList(parts.achievements) || null,
        },
      ],
    };
  });
  return experiences
    .sort((a, b) => b.start_date.localeCompare(a.start_date))
    .map((e, i) => ({ ...e, sort: i + 1 }));
}

function parsePosts(root) {
  const dir = join(root, 'Tulisan');
  const posts = [];
  for (const file of listNotes(dir)) {
    const { data, content } = readNote(join(dir, file));
    if (!PUBLISHED_POST_STATUSES.has(String(data.status).toLowerCase())) continue;

    const fileTitle = noteName(file).replace(/^\d{8}\s+/, '');
    const h1 = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
    let body = content
      .replace(/^#\s+.+\n?/m, '')
      .replace(/^Dipublikasikan di Medium:.*$/m, '')
      .replace(/^\s*(#[A-Za-z][\w-]*\s*)+$/gm, ''); // trailing hashtag lines
    body = tidy(wikiToText(unicodeBoldToMarkdown(body)));
    const title = h1 ?? fileTitle;
    const source = data.sumber ? String(data.sumber) : null;

    posts.push({
      slug: slugify(title),
      status: 'published',
      published_at: data.tanggal ? isoDate(data.tanggal) : `${file.slice(0, 4)}-${file.slice(4, 6)}-${file.slice(6, 8)}`,
      tags: (data.tags ?? []).map((t) => String(t).replace(/^#/, '')),
      // A bare profile URL (medium.com/@user) is not a link to the article.
      medium_url: source && /medium\.com\/@[^/]+\/.+/.test(source) ? source : null,
      original_language: detectLanguage(body),
      translations: [{ title, excerpt: summarize(body, 180), body }],
    });
  }
  for (const post of posts) post.translations[0].languages_code = post.original_language;
  return posts.sort((a, b) => b.published_at.localeCompare(a.published_at));
}

function parseEducation(root) {
  const { content } = readNote(join(root, 'CV', 'Education.md'));
  const entries = [];
  let category = 'formal';
  for (const line of content.split('\n')) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      category = /informal|non/i.test(heading[1]) ? 'non_formal' : 'formal';
      continue;
    }
    const top = line.match(/^- \*\*(.+?)\*\* — (.+)$/);
    if (top) {
      entries.push({ institution: top[2].trim(), category, degree: top[1].trim(), lines: [] });
      continue;
    }
    const sub = line.match(/^\s+- (.+)$/);
    if (sub && entries.length) entries.at(-1).lines.push(sub[1].trim());
  }
  return entries.map((e, i) => {
    const span = e.lines.find((l) => /^(?:[A-Za-z]{3,4}\s+)?\d{4}\s*[–-]\s*(?:[A-Za-z]{3,4}\s+)?\d{4}$/.test(l));
    const grade = e.lines.find((l) => /^Grade:/i.test(l));
    const rest = e.lines.filter((l) => l !== span && l !== grade);
    return {
      institution: e.institution,
      category: e.category,
      status: 'published',
      sort: i + 1,
      grade: grade?.replace(/^Grade:\s*/i, '') ?? null,
      start_year: span ? Number(span.match(/\d{4}/g)[0]) : null,
      end_year: span ? Number(span.match(/\d{4}/g).at(-1)) : null,
      translations: [
        { languages_code: 'en-US', degree: e.degree, description: rest.map((l) => `- ${l}`).join('\n') || null },
      ],
    };
  });
}

function parseCertifications(root) {
  const { content } = readNote(join(root, 'CV', 'Certifications.md'));
  const certs = [];
  for (const line of content.split('\n')) {
    const top = line.match(/^- \*\*(.+?)\*\* — (?:By\s+)?(.+?)(?:\s+\(([A-Za-z]{3,4})\s+(\d{4})\))?$/);
    if (top) {
      const [, name, issuer, month, year] = top;
      certs.push({
        name: name.trim(),
        issuer: issuer.trim(),
        issued_date: month ? monthYear(`${month} ${year}`) : null,
        credential_url: null,
        status: 'published',
        sort: certs.length + 1,
      });
      continue;
    }
    const link = line.match(/^\s+- .*\]\((https?:\/\/[^)]+)\)/);
    if (link && certs.length) certs.at(-1).credential_url = link[1];
  }
  return certs;
}

function parseSkills(root) {
  const { content } = readNote(join(root, 'CV', 'Skills.md'));
  return [...content.matchAll(/^- \S*\s*\*\*(.+?)\*\*:\s*(.+)$/gm)].map(([, name, keywords], i) => ({
    status: 'published',
    sort: i + 1,
    translations: [
      { languages_code: 'en-US', name: name.trim(), keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean) },
    ],
  }));
}

export function parseVault(root) {
  return {
    profile: parseProfile(root),
    projects: parseProjects(root),
    experiences: parseExperiences(root),
    posts: parsePosts(root),
    education: parseEducation(root),
    certifications: parseCertifications(root),
    skills: parseSkills(root),
  };
}
