// Copy for the Autoplay Blocker landing page (pages/[lang]/work/autoplay-blocker.astro).
// Kept in code, not in the CMS: it is one page with a lot of small strings. The project's
// title, summary and cover for the work grid still come from Directus.
import type { Locale } from './i18n';

interface Content {
  seoTitle: string;
  hero: { kicker: string; headline: string; sub: string; install: string; installNote: string; how: string; tags: string[] };
  problem: { title: string; lead: string; points: { title: string; text: string }[] };
  demo: { title: string; without: string; withIt: string; withoutCaption: string; withCaption: string };
  features: { title: string; items: { title: string; text: string }[] };
  plans: {
    title: string;
    lead: string;
    free: string;
    pro: string;
    rows: { label: string; free: boolean; pro: boolean }[];
    bonus: string;
    price: string;
    priceNote: string;
    buy: string;
    buySoon: string;
  };
  how: { title: string; steps: { title: string; text: string }[] };
  privacy: { title: string; lead: string; permissions: { name: string; why: string }[]; policy: string; report: string };
  limits: { title: string; items: string[] };
  faq: { title: string; items: { q: string; a: string }[] };
  closing: { title: string; text: string; share: string };
}

const en: Content = {
  seoTitle: 'Autoplay Blocker: stop videos from playing on their own',
  hero: {
    kicker: 'Chrome extension · side project',
    headline: 'Videos and audio play when you ask, not when a page decides.',
    sub: 'Autoplay Blocker stops the playback itself, not only the sound. One click allows any site you trust.',
    install: 'Add to Chrome',
    installNote: 'coming soon',
    how: 'see how it works',
    tags: ['Manifest V3', 'Free + Pro', 'EN / ID'],
  },
  problem: {
    title: 'Muting is not stopping',
    lead: 'Chrome has no setting that turns autoplay off. Its Sound setting only silences a site: the video keeps running, keeps downloading and keeps using your CPU.',
    points: [
      { title: 'Muted video is always allowed', text: 'Chrome lets any video play without sound, so the embed in every news article starts by itself.' },
      { title: 'Surprise sound in meetings', text: 'A background tab starts talking in the middle of a call.' },
      { title: 'Data you did not ask for', text: 'On a limited plan, a muted autoplay video still downloads in full.' },
    ],
  },
  demo: {
    title: 'Same page, with and without',
    without: 'Chrome alone',
    withIt: 'With Autoplay Blocker',
    withoutCaption: 'Both videos start on their own, muted but running.',
    withCaption: 'Nothing starts. The toolbar badge counts what was held back.',
  },
  features: {
    title: 'One job, done properly',
    items: [
      { title: 'Stops, not mutes', text: 'Blocks autoplay of video and audio on every site, muted autoplay included.' },
      { title: 'Allow a site in one click', text: 'Allow or block the current site from the toolbar. A rule for a domain also covers its subdomains.' },
      { title: 'Knows what you chose', text: 'Click a video, or press a key for the main one, and it plays. The approval belongs to that video only.' },
      { title: 'Badge and dimmed icon', text: 'See how many media were blocked on the tab. The icon dims on sites you allow.' },
      { title: 'Never breaks calls', text: 'Live media such as video calls and streams is left alone.' },
      { title: 'Embeds follow the page', text: 'The site in the address bar decides, so allowing a news site also allows the player inside it.' },
    ],
  },
  plans: {
    title: 'Free and Pro',
    lead: 'Blocking is free and always will be. Pro adds control for people who tune their sites.',
    free: 'Free',
    pro: 'Pro',
    rows: [
      { label: 'Blocks video and audio autoplay on every site', free: true, pro: true },
      { label: 'Allow or block the current site from the toolbar', free: true, pro: true },
      { label: 'Badge with the number of media blocked', free: true, pro: true },
      { label: 'Manage site rules in settings', free: false, pro: true },
      { label: 'Changes apply to the open page, no reload', free: false, pro: true },
      { label: '"After click" mode: blocked until you click the page', free: false, pro: true },
      { label: 'Blocks YouTube animated hover previews', free: false, pro: true },
      { label: 'Supports the development of Autoplay Blocker', free: false, pro: true },
    ],
    bonus: 'Every Pro feature is free during the launch.',
    price: '$15',
    priceNote: 'one payment, yours for good',
    buy: 'Get Pro',
    buySoon: 'coming soon',
  },
  how: {
    title: 'How it works',
    steps: [
      { title: 'It runs first', text: 'A small script runs in every frame before the page loads and holds playback back until it knows the rule for the site.' },
      { title: 'Rules stay with you', text: 'Your rules live in the extension on your computer. They never enter the page, so a page cannot forge an "allow".' },
      { title: 'The top site decides', text: 'The page in the address bar picks the rule, and an embedded player follows it.' },
    ],
  },
  privacy: {
    title: 'Privacy and permissions',
    lead: 'The extension collects nothing and makes no network requests of its own. Your rules and settings stay in your browser.',
    permissions: [
      { name: 'Access to all sites', why: 'The blocker has to run on every page and frame to stop media before it starts.' },
      { name: 'storage', why: 'Keeps your site rules, settings and the per-tab blocked counter.' },
      { name: 'declarativeNetRequestWithHostAccess', why: 'Pro: one rule that blocks YouTube animated preview images.' },
    ],
    policy: 'Read the full privacy policy',
    report: 'Report a problem',
  },
  limits: {
    title: 'What it does not do yet',
    items: [
      'Audio made with the Web Audio API and players that draw to a canvas are not covered.',
      'Animated hover thumbnails are pictures, not media. On Free they keep moving; Pro blocks YouTube’s.',
      'On sites such as TikTok the arrow keys count as asking for the next video, so it plays.',
      'Whether a click means "play this video" is a heuristic. Unusual players may need a fix.',
    ],
  },
  faq: {
    title: 'Questions',
    items: [
      { q: 'Why not just mute the site in Chrome?', a: 'Muting only removes the sound. The video still plays and downloads. This stops it.' },
      { q: 'A site stopped working. What now?', a: 'Allow it from the toolbar. To report it, turn on debug mode: run localStorage.setItem("ab-debug", "1") in the page console and reload, then send the lines starting with [AB].' },
      { q: 'Is it free?', a: 'Blocking is free. Pro features are free during the launch and will need a licence later.' },
      { q: 'Does it work in Edge or Firefox?', a: 'Chrome first. Edge is next. Firefox and Safari are not planned.' },
      { q: 'When will it be on the Chrome Web Store?', a: 'Soon. Until then it is built and tested locally.' },
    ],
  },
  closing: {
    title: 'Let playback be your choice again',
    text: 'The Chrome Web Store listing is on its way.',
    share: 'Built by syafwan, in the open as a side project.',
  },
};

const id: Content = {
  seoTitle: 'Autoplay Blocker: hentikan video yang putar sendiri',
  hero: {
    kicker: 'Ekstensi Chrome · proyek sampingan',
    headline: 'Video dan audio diputar saat kamu minta, bukan saat halaman memutuskan.',
    sub: 'Autoplay Blocker menghentikan pemutarannya, bukan hanya suaranya. Satu klik untuk mengizinkan situs yang kamu percaya.',
    install: 'Tambahkan ke Chrome',
    installNote: 'segera hadir',
    how: 'lihat cara kerjanya',
    tags: ['Manifest V3', 'Gratis + Pro', 'EN / ID'],
  },
  problem: {
    title: 'Membisukan bukan menghentikan',
    lead: 'Chrome tidak punya pengaturan untuk mematikan autoplay. Pengaturan Suara hanya membisukan situs: videonya tetap jalan, tetap mengunduh, dan tetap memakai CPU.',
    points: [
      { title: 'Video tanpa suara selalu diizinkan', text: 'Chrome membiarkan video apa pun diputar tanpa suara, jadi video sematan di setiap artikel berita mulai sendiri.' },
      { title: 'Suara tiba-tiba saat rapat', text: 'Tab di latar belakang mendadak bersuara di tengah panggilan.' },
      { title: 'Kuota terpakai tanpa diminta', text: 'Di paket data terbatas, video autoplay yang dibisukan tetap diunduh penuh.' },
    ],
  },
  demo: {
    title: 'Halaman yang sama, dengan dan tanpa',
    without: 'Hanya Chrome',
    withIt: 'Dengan Autoplay Blocker',
    withoutCaption: 'Kedua video mulai sendiri, dibisukan tetapi tetap berjalan.',
    withCaption: 'Tidak ada yang mulai. Badge di toolbar menghitung yang ditahan.',
  },
  features: {
    title: 'Satu tugas, dikerjakan dengan benar',
    items: [
      { title: 'Menghentikan, bukan membisukan', text: 'Memblokir autoplay video dan audio di semua situs, termasuk autoplay tanpa suara.' },
      { title: 'Izinkan situs dengan satu klik', text: 'Izinkan atau blokir situs yang sedang dibuka dari toolbar. Aturan untuk sebuah domain juga berlaku untuk subdomainnya.' },
      { title: 'Paham pilihanmu', text: 'Klik sebuah video, atau tekan tombol untuk video utama, dan video itu diputar. Izinnya hanya untuk video tersebut.' },
      { title: 'Badge dan ikon yang meredup', text: 'Lihat berapa media yang diblokir di tab ini. Ikon meredup di situs yang kamu izinkan.' },
      { title: 'Panggilan video aman', text: 'Media langsung seperti panggilan video dan siaran tidak disentuh.' },
      { title: 'Video sematan mengikuti halaman', text: 'Situs di address bar yang menentukan, jadi mengizinkan situs berita juga mengizinkan pemutar di dalamnya.' },
    ],
  },
  plans: {
    title: 'Gratis dan Pro',
    lead: 'Pemblokiran gratis dan akan selalu begitu. Pro menambah kendali untuk yang suka mengatur situs satu per satu.',
    free: 'Gratis',
    pro: 'Pro',
    rows: [
      { label: 'Memblokir autoplay video dan audio di semua situs', free: true, pro: true },
      { label: 'Izinkan atau blokir situs yang dibuka dari toolbar', free: true, pro: true },
      { label: 'Badge jumlah media yang diblokir', free: true, pro: true },
      { label: 'Kelola aturan situs di pengaturan', free: false, pro: true },
      { label: 'Perubahan langsung berlaku di halaman terbuka, tanpa reload', free: false, pro: true },
      { label: 'Mode "setelah klik": diblokir sampai kamu mengklik halaman', free: false, pro: true },
      { label: 'Memblokir preview hover animasi YouTube', free: false, pro: true },
      { label: 'Mendukung pengembangan Autoplay Blocker', free: false, pro: true },
    ],
    bonus: 'Semua fitur Pro gratis selama masa peluncuran.',
    price: '$15',
    priceNote: 'sekali bayar, milikmu selamanya',
    buy: 'Dapatkan Pro',
    buySoon: 'segera hadir',
  },
  how: {
    title: 'Cara kerjanya',
    steps: [
      { title: 'Berjalan paling awal', text: 'Skrip kecil berjalan di setiap frame sebelum halaman dimuat dan menahan pemutaran sampai aturan situsnya diketahui.' },
      { title: 'Aturan tetap bersamamu', text: 'Aturan tersimpan di ekstensi, di komputermu. Aturan tidak pernah masuk ke halaman, jadi halaman tidak bisa memalsukan "izinkan".' },
      { title: 'Situs teratas yang menentukan', text: 'Halaman di address bar memilih aturannya, dan pemutar yang disematkan mengikutinya.' },
    ],
  },
  privacy: {
    title: 'Privasi dan izin',
    lead: 'Ekstensi tidak mengumpulkan data apa pun dan tidak membuat permintaan jaringan sendiri. Aturan dan pengaturanmu tetap di browser.',
    permissions: [
      { name: 'Akses ke semua situs', why: 'Pemblokir harus berjalan di setiap halaman dan frame agar media berhenti sebelum mulai.' },
      { name: 'storage', why: 'Menyimpan aturan situs, pengaturan, dan penghitung media yang diblokir per tab.' },
      { name: 'declarativeNetRequestWithHostAccess', why: 'Pro: satu aturan yang memblokir gambar preview animasi YouTube.' },
    ],
    policy: 'Baca kebijakan privasi lengkap',
    report: 'Laporkan masalah',
  },
  limits: {
    title: 'Yang belum bisa dilakukan',
    items: [
      'Audio dari Web Audio API dan pemutar yang menggambar ke canvas belum tercakup.',
      'Thumbnail hover beranimasi adalah gambar, bukan media. Di Gratis tetap bergerak; Pro memblokir milik YouTube.',
      'Di situs seperti TikTok, tombol panah dianggap meminta video berikutnya, sehingga video itu diputar.',
      'Apakah sebuah klik berarti "putar video ini" adalah perkiraan. Pemutar yang tidak lazim mungkin perlu perbaikan.',
    ],
  },
  faq: {
    title: 'Pertanyaan',
    items: [
      { q: 'Kenapa tidak bisukan saja situsnya di Chrome?', a: 'Membisukan hanya menghilangkan suara. Videonya tetap diputar dan diunduh. Ini menghentikannya.' },
      { q: 'Sebuah situs jadi tidak berfungsi. Bagaimana?', a: 'Izinkan dari toolbar. Untuk melaporkannya, nyalakan mode debug: jalankan localStorage.setItem("ab-debug", "1") di console halaman lalu muat ulang, kemudian kirim baris yang diawali [AB].' },
      { q: 'Apakah gratis?', a: 'Pemblokiran gratis. Fitur Pro gratis selama peluncuran dan nanti memerlukan lisensi.' },
      { q: 'Apakah jalan di Edge atau Firefox?', a: 'Chrome dulu. Edge menyusul. Firefox dan Safari belum direncanakan.' },
      { q: 'Kapan ada di Chrome Web Store?', a: 'Segera. Sampai saat itu, ekstensi dibangun dan diuji secara lokal.' },
    ],
  },
  closing: {
    title: 'Kembalikan pemutaran ke tanganmu',
    text: 'Halaman di Chrome Web Store sedang disiapkan.',
    share: 'Dibuat oleh syafwan sebagai proyek sampingan.',
  },
};

export const autoplayBlockerContent: Record<Locale, Content> = { en, id };
export const AUTOPLAY_BLOCKER_VERSION = '0.1.0';
export type { Content as AutoplayBlockerContent };
