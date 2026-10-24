// Copy for the Autoplay Blocker privacy policy and report form. Kept in code like autoplay-blocker-content.ts.
// The policy text must stay identical in meaning to the Chrome Web Store listing (extension repo: docs/Web Store Listing.md).
import type { Locale } from './i18n';

export const PRIVACY_UPDATED = '2026-10-24'; // still unpublished: bump to the publish date when the install date ships

interface Section {
  heading: string;
  paragraphs?: string[];
  items?: string[];
}

interface Legal {
  privacy: { seoTitle: string; title: string; updatedLabel: string; intro: string; sections: Section[]; reportLink: string; back: string };
  report: {
    seoTitle: string;
    title: string;
    lead: string;
    kindLabel: string;
    kinds: { site_bug: string; question: string; privacy: string };
    siteLabel: string;
    siteHint: string;
    versionLabel: string;
    messageLabel: string;
    messageHint: string;
    emailLabel: string;
    emailHint: string;
    submit: string;
    sent: string;
    sentNote: string;
    again: string;
    unavailable: string;
    throttled: string;
    failed: string;
    privacyNote: string;
    privacyLink: string;
    back: string;
  };
}

const en: Legal = {
  privacy: {
    seoTitle: 'Autoplay Blocker privacy policy',
    title: 'Privacy policy',
    updatedLabel: 'Last updated',
    intro:
      'Autoplay Blocker is a Chrome extension that stops videos and audio from playing on their own. This page explains what it stores, what it never does, and what happens to a message you send from the report form on this website.',
    sections: [
      {
        heading: 'Who is responsible',
        paragraphs: ['Autoplay Blocker is made and published by Syafwan Iqbal Fauzi (syafwan.com). To ask a question or make a request about your data, use the report form linked at the bottom of this page.'],
      },
      {
        heading: 'What the extension stores on your device',
        items: [
          'Your site rules: the site names you allowed, blocked or set to “after click”.',
          'Your settings, such as hover previews on or off.',
          'A licence key, only if you paste one into Settings (Pro, once licences are active).',
          'The date you installed the extension, kept so that offers for early users, such as the launch bonus, can be honoured fairly later.',
          'A per-tab counter of blocked media. It lives in the browser’s session storage and is cleared when the browser closes.',
        ],
        paragraphs: ['All of this stays in your browser’s extension storage. The extension does not send it anywhere.'],
      },
      {
        heading: 'What the extension does not do',
        items: [
          'It makes no network requests of its own.',
          'It does not collect, keep or send your browsing history. It reads the site name of the page you are on only to find your rule for that site.',
          'It has no analytics, advertising or tracking, and it does not sell or share data.',
          'It loads no remote code. Everything it runs ships inside the extension package.',
        ],
      },
      {
        heading: 'Permissions and why they are needed',
        items: [
          'Access to all sites: the blocker has to run on every page and frame to stop media before it starts. It does not read page content beyond the media elements it holds back.',
          'storage: keeps your site rules, settings and the per-tab counter.',
          'declarativeNetRequestWithHostAccess: Pro only, one rule that blocks YouTube’s animated preview images.',
        ],
      },
      {
        heading: 'The report form on this website',
        paragraphs: [
          'The extension itself sends nothing. The “Report a broken site” button in the popup only opens the report form on syafwan.com in a new tab, with the site name and extension version filled in.',
          'If you send the form, what you typed (the kind of message, the site, the message, and an optional email address) is saved in this website’s content system. It is used only to read your message, reply if you left an email address, and fix the problem. It is not shared with anyone and not used for anything else. Reports are deleted after 12 months. To have yours deleted sooner, send a message of the kind “Privacy question” and describe it.',
        ],
      },
      {
        heading: 'Pro licences',
        paragraphs: [
          'Today every Pro feature is free as a launch bonus and no licence is checked. When paid licences start, the extension will send your licence key to Polar (api.polar.sh) only to check that it is valid. Polar handles the payment as merchant of record; Autoplay Blocker never sees your card details. This page will be updated before that change ships.',
        ],
      },
      {
        heading: 'Limited use',
        paragraphs: ['Data the extension handles is used only to provide its single purpose: stopping media from playing on its own. It is not transferred to others, except if the law requires it, and it is not used for credit, lending or advertising decisions.'],
      },
      {
        heading: 'Deleting your data',
        paragraphs: ['Removing the extension from Chrome deletes everything it stored on your device. Data from the report form is handled as described above.'],
      },
      {
        heading: 'Changes to this policy',
        paragraphs: ['If this policy changes, the new text and date appear on this page. A change that adds data collection is announced in the extension’s release notes first.'],
      },
    ],
    reportLink: 'Ask a privacy question',
    back: 'Back to Autoplay Blocker',
  },
  report: {
    seoTitle: 'Report a problem with Autoplay Blocker',
    title: 'Report a problem',
    lead: 'A site that stopped working, a question, or a privacy request. A few lines are enough.',
    kindLabel: 'What is this about?',
    kinds: { site_bug: 'A site is not working', question: 'A question', privacy: 'Privacy question or data request' },
    siteLabel: 'Site',
    siteHint: 'For example news.example. Optional.',
    versionLabel: 'Extension version',
    messageLabel: 'Message',
    messageHint: 'What did you click, and what did you see? 5 to 2000 characters.',
    emailLabel: 'Email (optional)',
    emailHint: 'Only if you want a reply.',
    submit: 'Send',
    sent: 'Thank you, your message was sent.',
    sentNote: 'If you left an email address, you will get a reply there.',
    again: 'Send another',
    unavailable: 'The form is not available right now. Please try again later.',
    throttled: 'Too many messages in a short time. Try again in a few minutes.',
    failed: 'Your message could not be saved. Please try again.',
    privacyNote: 'What you type is saved on this website to answer you and is deleted after 12 months.',
    privacyLink: 'Privacy policy',
    back: 'Back to Autoplay Blocker',
  },
};

const id: Legal = {
  privacy: {
    seoTitle: 'Kebijakan privasi Autoplay Blocker',
    title: 'Kebijakan privasi',
    updatedLabel: 'Diperbarui',
    intro:
      'Autoplay Blocker adalah ekstensi Chrome yang menghentikan video dan audio yang putar sendiri. Halaman ini menjelaskan apa yang disimpannya, apa yang tidak pernah dilakukannya, dan apa yang terjadi pada pesan yang kamu kirim lewat formulir laporan di situs ini.',
    sections: [
      {
        heading: 'Siapa yang bertanggung jawab',
        paragraphs: ['Autoplay Blocker dibuat dan diterbitkan oleh Syafwan Iqbal Fauzi (syafwan.com). Untuk bertanya atau mengajukan permintaan terkait datamu, gunakan formulir laporan yang ditautkan di bagian bawah halaman ini.'],
      },
      {
        heading: 'Yang disimpan ekstensi di perangkatmu',
        items: [
          'Aturan situsmu: nama situs yang kamu izinkan, blokir, atau atur ke “setelah klik”.',
          'Pengaturanmu, misalnya preview hover aktif atau mati.',
          'Kunci lisensi, hanya jika kamu menempelkannya di Pengaturan (Pro, setelah lisensi aktif).',
          'Tanggal kamu memasang ekstensi, disimpan agar penawaran untuk pengguna awal, seperti bonus peluncuran, bisa dihormati secara adil di kemudian hari.',
          'Penghitung media yang diblokir per tab. Disimpan di penyimpanan sesi browser dan dihapus saat browser ditutup.',
        ],
        paragraphs: ['Semua ini tetap berada di penyimpanan ekstensi di browsermu. Ekstensi tidak mengirimnya ke mana pun.'],
      },
      {
        heading: 'Yang tidak dilakukan ekstensi',
        items: [
          'Tidak membuat permintaan jaringan sendiri.',
          'Tidak mengumpulkan, menyimpan, atau mengirim riwayat penjelajahanmu. Ia hanya membaca nama situs dari halaman yang sedang dibuka untuk mencari aturanmu untuk situs itu.',
          'Tidak ada analitik, iklan, atau pelacakan, dan tidak menjual atau membagikan data.',
          'Tidak memuat kode dari jarak jauh. Semua yang dijalankan sudah ada di dalam paket ekstensi.',
        ],
      },
      {
        heading: 'Izin dan alasannya',
        items: [
          'Akses ke semua situs: pemblokir harus berjalan di setiap halaman dan frame agar media berhenti sebelum mulai. Ia tidak membaca isi halaman selain elemen media yang ditahannya.',
          'storage: menyimpan aturan situs, pengaturan, dan penghitung per tab.',
          'declarativeNetRequestWithHostAccess: hanya Pro, satu aturan yang memblokir gambar preview animasi YouTube.',
        ],
      },
      {
        heading: 'Formulir laporan di situs ini',
        paragraphs: [
          'Ekstensi sendiri tidak mengirim apa pun. Tombol “Laporkan situs bermasalah” di popup hanya membuka formulir laporan di syafwan.com di tab baru, dengan nama situs dan versi ekstensi sudah terisi.',
          'Jika kamu mengirim formulir, yang kamu ketik (jenis pesan, situs, pesan, dan alamat email yang opsional) disimpan di sistem konten situs ini. Isinya hanya dipakai untuk membaca pesanmu, membalas jika kamu mengisi email, dan memperbaiki masalahnya. Tidak dibagikan kepada siapa pun dan tidak dipakai untuk hal lain. Laporan dihapus setelah 12 bulan. Untuk menghapus laporanmu lebih cepat, kirim pesan dengan jenis “Pertanyaan privasi” dan jelaskan permintaannya.',
        ],
      },
      {
        heading: 'Lisensi Pro',
        paragraphs: [
          'Saat ini semua fitur Pro gratis sebagai bonus peluncuran dan tidak ada lisensi yang diperiksa. Ketika lisensi berbayar dimulai, ekstensi akan mengirim kunci lisensimu ke Polar (api.polar.sh) hanya untuk memastikan kunci itu sah. Polar mengurus pembayaran sebagai merchant of record; Autoplay Blocker tidak pernah melihat data kartumu. Halaman ini diperbarui sebelum perubahan itu dirilis.',
        ],
      },
      {
        heading: 'Penggunaan terbatas',
        paragraphs: ['Data yang ditangani ekstensi hanya dipakai untuk tujuan tunggalnya: menghentikan media yang putar sendiri. Data tidak dialihkan kepada pihak lain, kecuali diwajibkan hukum, dan tidak dipakai untuk keputusan kredit, pinjaman, atau iklan.'],
      },
      {
        heading: 'Menghapus datamu',
        paragraphs: ['Mencopot ekstensi dari Chrome menghapus semua yang disimpannya di perangkatmu. Data dari formulir laporan diperlakukan seperti dijelaskan di atas.'],
      },
      {
        heading: 'Perubahan kebijakan',
        paragraphs: ['Jika kebijakan ini berubah, teks dan tanggal baru muncul di halaman ini. Perubahan yang menambah pengumpulan data diumumkan lebih dulu di catatan rilis ekstensi.'],
      },
    ],
    reportLink: 'Ajukan pertanyaan privasi',
    back: 'Kembali ke Autoplay Blocker',
  },
  report: {
    seoTitle: 'Laporkan masalah Autoplay Blocker',
    title: 'Laporkan masalah',
    lead: 'Situs yang berhenti berfungsi, pertanyaan, atau permintaan terkait privasi. Beberapa baris sudah cukup.',
    kindLabel: 'Soal apa?',
    kinds: { site_bug: 'Sebuah situs tidak berfungsi', question: 'Sebuah pertanyaan', privacy: 'Pertanyaan privasi atau permintaan data' },
    siteLabel: 'Situs',
    siteHint: 'Contoh: news.example. Opsional.',
    versionLabel: 'Versi ekstensi',
    messageLabel: 'Pesan',
    messageHint: 'Apa yang kamu klik, dan apa yang terlihat? 5 sampai 2000 karakter.',
    emailLabel: 'Email (opsional)',
    emailHint: 'Hanya jika kamu ingin dibalas.',
    submit: 'Kirim',
    sent: 'Terima kasih, pesanmu terkirim.',
    sentNote: 'Jika kamu mengisi email, balasan akan dikirim ke sana.',
    again: 'Kirim pesan lain',
    unavailable: 'Formulir sedang tidak tersedia. Coba lagi nanti.',
    throttled: 'Terlalu banyak pesan dalam waktu singkat. Coba lagi dalam beberapa menit.',
    failed: 'Pesanmu tidak bisa disimpan. Coba lagi.',
    privacyNote: 'Yang kamu ketik disimpan di situs ini untuk membalasmu dan dihapus setelah 12 bulan.',
    privacyLink: 'Kebijakan privasi',
    back: 'Kembali ke Autoplay Blocker',
  },
};

export const autoplayBlockerLegal: Record<Locale, Legal> = { en, id };
