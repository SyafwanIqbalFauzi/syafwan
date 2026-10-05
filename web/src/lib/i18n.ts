import type { LanguageCode } from './schema';

export const LOCALES = ['en', 'id'] as const;
export type Locale = (typeof LOCALES)[number];

export const isLocale = (value: unknown): value is Locale => LOCALES.includes(value as Locale);

export const LANGUAGE_CODE: Record<Locale, LanguageCode> = { en: 'en-US', id: 'id-ID' };
export const INTL_LOCALE: Record<Locale, string> = { en: 'en-US', id: 'id-ID' };

const dictionary = {
  en: {
    'nav.work': 'work',
    'nav.about': 'about',
    'nav.writing': 'writing',
    'nav.home': 'home',
    'nav.sub.products': 'products',
    'nav.sub.projects': 'client projects',
    'nav.sub.allWork': 'all work',
    'nav.sub.how': 'how I work',
    'nav.sub.experience': 'experience',
    'nav.sub.skills': 'skills',
    'nav.sub.pm': 'product management',
    'nav.sub.agile': 'agile',
    'nav.sub.allWriting': 'all writing',
    'lang.switch': 'Bahasa Indonesia',
    'common.present': 'present',
    'common.ongoing': 'ongoing',
    'common.all': 'all',
    'common.product': 'product',
    'common.project': 'project',
    'common.previous': 'previous',
    'common.next': 'next',
    'common.visit': 'visit',
    'common.viewProject': 'view project',
    'common.verify': 'verify',
    'common.writtenIn.id-ID': 'Written in Bahasa Indonesia',
    'common.writtenIn.en-US': 'Written in English',
    'home.status': 'Currently',
    'home.cta.work': 'see work',
    'home.cta.contact': 'get in touch',
    'home.highlights': 'In numbers',
    'home.selected': 'Selected work',
    'home.allWork': 'all work',
    'home.experience': 'Experience',
    'home.fullExperience': 'full experience',
    'home.writing': 'Latest writing',
    'home.allWriting': 'all writing',
    'home.contact.title': "Let's build something people need.",
    'home.contact.body': 'Open to conversations about digital product, project, GIS, and applied AI.',
    'about.title': 'About',
    'about.how': 'How I work',
    'about.experience': 'Experience',
    'about.skills': 'Skills',
    'about.education': 'Education',
    'about.certifications': 'Certifications',
    'about.languages': 'Languages',
    'about.location': 'Location',
    'about.downloadCv': 'Download CV',
    'about.responsibilities': 'Responsibilities',
    'about.achievements': 'Achievements',
    'about.relatedWork': 'Related work',
    'about.formal': 'Formal',
    'about.non_formal': 'Non-formal',
    'about.grade': 'Grade',
    'employment.contract': 'contract',
    'employment.internship': 'internship',
    'employment.apprenticeship': 'apprenticeship',
    'work.title': 'Work',
    'work.count': '{n} products & projects',
    'meta.client': 'Client',
    'meta.period': 'Period',
    'meta.type': 'Type',
    'meta.platforms': 'Platforms',
    'meta.roles': 'Role',
    'meta.link': 'Link',
    'work.builtWhileAt': 'Built while at',
    'writing.title': 'Writing',
    'writing.count': '{n} posts',
    'writing.originally': 'Originally published on Medium',
    'notFound.title': 'Page not found',
    'notFound.body': "The page you're looking for doesn't exist or has moved.",
    'notFound.back': 'back to home',
    'footer.rights': 'All rights reserved.',
    'footer.cta': 'get in touch',
  },
  id: {
    'nav.work': 'karya',
    'nav.about': 'tentang',
    'nav.writing': 'tulisan',
    'nav.home': 'beranda',
    'nav.sub.products': 'produk',
    'nav.sub.projects': 'proyek klien',
    'nav.sub.allWork': 'semua karya',
    'nav.sub.how': 'cara saya bekerja',
    'nav.sub.experience': 'pengalaman',
    'nav.sub.skills': 'keahlian',
    'nav.sub.pm': 'product management',
    'nav.sub.agile': 'agile',
    'nav.sub.allWriting': 'semua tulisan',
    'lang.switch': 'English',
    'common.present': 'sekarang',
    'common.ongoing': 'berjalan',
    'common.all': 'semua',
    'common.product': 'produk',
    'common.project': 'proyek',
    'common.previous': 'sebelumnya',
    'common.next': 'berikutnya',
    'common.visit': 'kunjungi',
    'common.viewProject': 'lihat proyek',
    'common.verify': 'verifikasi',
    'common.writtenIn.id-ID': 'Ditulis dalam Bahasa Indonesia',
    'common.writtenIn.en-US': 'Ditulis dalam Bahasa Inggris',
    'home.status': 'Saat ini',
    'home.cta.work': 'lihat karya',
    'home.cta.contact': 'hubungi saya',
    'home.highlights': 'Dalam angka',
    'home.selected': 'Karya pilihan',
    'home.allWork': 'semua karya',
    'home.experience': 'Pengalaman',
    'home.fullExperience': 'pengalaman lengkap',
    'home.writing': 'Tulisan terbaru',
    'home.allWriting': 'semua tulisan',
    'home.contact.title': 'Mari membangun sesuatu yang benar-benar dibutuhkan.',
    'home.contact.body': 'Terbuka untuk diskusi seputar produk digital, proyek, GIS, dan penerapan AI.',
    'about.title': 'Tentang',
    'about.how': 'Cara saya bekerja',
    'about.experience': 'Pengalaman',
    'about.skills': 'Keahlian',
    'about.education': 'Pendidikan',
    'about.certifications': 'Sertifikasi',
    'about.languages': 'Bahasa',
    'about.location': 'Lokasi',
    'about.downloadCv': 'Unduh CV',
    'about.responsibilities': 'Tanggung jawab',
    'about.achievements': 'Pencapaian',
    'about.relatedWork': 'Karya terkait',
    'about.formal': 'Formal',
    'about.non_formal': 'Non-formal',
    'about.grade': 'IPK',
    'employment.contract': 'kontrak',
    'employment.internship': 'magang',
    'employment.apprenticeship': 'apprenticeship',
    'work.title': 'Karya',
    'work.count': '{n} produk & proyek',
    'meta.client': 'Klien',
    'meta.period': 'Periode',
    'meta.type': 'Jenis',
    'meta.platforms': 'Platform',
    'meta.roles': 'Peran',
    'meta.link': 'Tautan',
    'work.builtWhileAt': 'Dikerjakan saat di',
    'writing.title': 'Tulisan',
    'writing.count': '{n} tulisan',
    'writing.originally': 'Pertama kali terbit di Medium',
    'notFound.title': 'Halaman tidak ditemukan',
    'notFound.body': 'Halaman yang kamu cari tidak ada atau sudah dipindahkan.',
    'notFound.back': 'kembali ke beranda',
    'footer.rights': 'Hak cipta dilindungi.',
    'footer.cta': 'hubungi saya',
  },
} as const;

export type MessageKey = keyof (typeof dictionary)['en'];

export function t(locale: Locale, key: MessageKey, vars: Record<string, string | number> = {}): string {
  const message: string = dictionary[locale][key] ?? dictionary.en[key];
  return message.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));
}

/**
 * Picks the translation for `locale`, falling back to the other language.
 * `fallback` is true when the content is shown in a language other than the page's.
 */
export function pick<T extends { languages_code: LanguageCode }>(
  translations: T[] | undefined,
  locale: Locale,
): { value: T | undefined; fallback: boolean } {
  const wanted = LANGUAGE_CODE[locale];
  const exact = translations?.find((tr) => tr.languages_code === wanted);
  if (exact) return { value: exact, fallback: false };
  return { value: translations?.[0], fallback: Boolean(translations?.length) };
}

/** Same path in the other language: /en/work/x -> /id/work/x */
export function switchLocalePath(pathname: string, target: Locale): string {
  return pathname.replace(/^\/(en|id)(?=\/|$)/, `/${target}`) || `/${target}`;
}

export const otherLocale = (locale: Locale): Locale => (locale === 'en' ? 'id' : 'en');

// ---------------------------------------------------------------------------
// Dates & periods
// ---------------------------------------------------------------------------
const parseDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00Z`);

export function formatMonthYear(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    parseDate(value),
  );
}

export function formatDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parseDate(value));
}

export function formatPeriod(start: string, end: string | null, locale: Locale): string {
  return `${formatMonthYear(start, locale)} – ${end ? formatMonthYear(end, locale) : t(locale, 'common.present')}`;
}

export function formatYears(
  project: { year_start: number | null; year_end: number | null; is_ongoing: boolean },
  locale: Locale,
): string {
  if (!project.year_start) return '';
  if (project.is_ongoing) return `${project.year_start} – ${t(locale, 'common.present')}`;
  if (project.year_end && project.year_end !== project.year_start) return `${project.year_start} – ${project.year_end}`;
  return String(project.year_start);
}
