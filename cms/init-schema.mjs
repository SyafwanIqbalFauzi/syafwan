// Creates the initial Directus schema (collections, fields, relations) through the REST API.
//
// Run once against an EMPTY Directus, then `npm run cms:snapshot` to export it to
// cms/schema/snapshot.yaml. From then on the snapshot is the source of truth:
// change the schema in the Directus UI, re-snapshot, commit, and other
// environments use `npm run cms:apply`.
import { adminApi } from './lib.mjs';

const api = await adminApi();

// ---------------------------------------------------------------------------
// Field builders
// ---------------------------------------------------------------------------
const relations = [];

const pk = () => ({
  field: 'id',
  type: 'integer',
  meta: { hidden: true, readonly: true, interface: 'input' },
  schema: { is_primary_key: true, has_auto_increment: true },
});

const STATUS_CHOICES = [
  { text: 'Published', value: 'published', color: '#2ECDA7' },
  { text: 'Draft', value: 'draft', color: '#A2B5CD' },
  { text: 'Archived', value: 'archived', color: '#F7971C' },
];

const status = () => ({
  field: 'status',
  type: 'string',
  meta: {
    width: 'half',
    interface: 'select-dropdown',
    options: { choices: STATUS_CHOICES },
    display: 'labels',
    display_options: { showAsDot: true, choices: STATUS_CHOICES },
  },
  schema: { default_value: 'draft', is_nullable: false },
});

const sort = () => ({ field: 'sort', type: 'integer', meta: { hidden: true, interface: 'input' }, schema: {} });

const timestamp = (field, special) => ({
  field,
  type: 'timestamp',
  meta: {
    special: [special],
    interface: 'datetime',
    readonly: true,
    hidden: true,
    width: 'half',
    display: 'datetime',
    display_options: { relative: true },
  },
  schema: {},
});

const userUpdated = (collection) => {
  relations.push({ collection, field: 'user_updated', related_collection: 'directus_users', schema: {} });
  return {
    field: 'user_updated',
    type: 'uuid',
    meta: {
      special: ['user-updated'],
      interface: 'select-dropdown-m2o',
      options: { template: '{{first_name}} {{last_name}}' },
      readonly: true,
      hidden: true,
      width: 'half',
      display: 'user',
    },
    schema: {},
  };
};

const audit = (collection) => [
  timestamp('date_created', 'date-created'),
  timestamp('date_updated', 'date-updated'),
  userUpdated(collection),
];

const string = (field, { required = false, unique = false, width = 'full', note, placeholder } = {}) => ({
  field,
  type: 'string',
  meta: { interface: 'input', width, required, note, options: placeholder ? { placeholder } : null },
  schema: { is_nullable: !required, is_unique: unique },
});

const text = (field, { note } = {}) => ({
  field,
  type: 'text',
  meta: { interface: 'input-multiline', note },
  schema: {},
});

const markdown = (field, { note } = {}) => ({
  field,
  type: 'text',
  meta: { interface: 'input-rich-text-md', note },
  schema: {},
});

const integer = (field, { width = 'half', note } = {}) => ({
  field,
  type: 'integer',
  meta: { interface: 'input', width, note },
  schema: {},
});

const boolean = (field, { label, note } = {}) => ({
  field,
  type: 'boolean',
  meta: { interface: 'boolean', width: 'half', note, options: label ? { label } : null, display: 'boolean' },
  schema: { default_value: false, is_nullable: false },
});

const date = (field, { required = false, note } = {}) => ({
  field,
  type: 'date',
  meta: { interface: 'datetime', width: 'half', required, note, display: 'datetime' },
  schema: { is_nullable: !required },
});

const dropdown = (field, choices, { required = false, defaultValue } = {}) => ({
  field,
  type: 'string',
  meta: {
    interface: 'select-dropdown',
    width: 'half',
    required,
    options: { choices: choices.map(([value, text]) => ({ value, text })) },
    display: 'labels',
  },
  schema: { is_nullable: !required, default_value: defaultValue ?? null },
});

const tags = (field, { note } = {}) => ({
  field,
  type: 'json',
  meta: { special: ['cast-json'], interface: 'tags', width: 'half', note, display: 'labels' },
  schema: {},
});

/** JSON repeater; `subfields` is a list of [name, interface] pairs. */
const repeater = (field, subfields, { template, note } = {}) => ({
  field,
  type: 'json',
  meta: {
    special: ['cast-json'],
    interface: 'list',
    note,
    options: {
      template,
      fields: subfields.map(([name, iface]) => ({
        field: name,
        name,
        type: iface === 'input-multiline' ? 'text' : 'string',
        meta: { field: name, interface: iface, width: iface === 'input-multiline' ? 'full' : 'half', type: iface === 'input-multiline' ? 'text' : 'string' },
      })),
    },
  },
  schema: {},
});

const file = (collection, field, { image = true, note } = {}) => {
  relations.push({
    collection,
    field,
    related_collection: 'directus_files',
    schema: { on_delete: 'SET NULL' },
  });
  return {
    field,
    type: 'uuid',
    meta: { special: ['file'], interface: image ? 'file-image' : 'file', width: 'half', note, display: image ? 'image' : 'file' },
    schema: {},
  };
};

const translationsAlias = (template) => ({
  field: 'translations',
  type: 'alias',
  meta: {
    special: ['translations'],
    interface: 'translations',
    options: { languageField: 'name', defaultLanguage: 'en-US', defaultOpenSplitView: true },
    display: 'translations',
    display_options: { template, languageField: 'name', defaultLanguage: 'en-US' },
  },
});

const m2mAlias = (field, template) => ({
  field,
  type: 'alias',
  meta: {
    special: ['m2m'],
    interface: 'list-m2m',
    options: { template },
    display: 'related-values',
    display_options: { template },
  },
});

/** Numbers fields so the editor shows them in declaration order. */
const ordered = (fields) => fields.map((f, i) => ({ ...f, meta: f.meta ? { ...f.meta, sort: i + 1 } : f.meta }));

// ---------------------------------------------------------------------------
// Collection definitions
// ---------------------------------------------------------------------------
const contentMeta = (extra) => ({
  sort_field: 'sort',
  archive_field: 'status',
  archive_value: 'archived',
  unarchive_value: 'draft',
  ...extra,
});

/** Each entry: { collection, meta, fields, translations?: fields[] } */
const collections = [
  {
    collection: 'profile',
    meta: { singleton: true, icon: 'person', note: 'Profil, headline hero, highlight angka, dan prinsip "How I work"', sort: 1 },
    fields: (c) => [
      pk(),
      string('full_name', { required: true }),
      string('email', { width: 'half', note: 'Ditampilkan publik' }),
      string('linkedin_url', { width: 'half' }),
      string('location', { width: 'half', placeholder: 'Bandung, Indonesia' }),
      file(c, 'photo', { note: 'Opsional. Kalau kosong, hero memakai cover proyek featured' }),
      file(c, 'cv_file', { image: false, note: 'PDF. Tombol "Download CV" muncul kalau diisi' }),
      translationsAlias('{{headline}}'),
      timestamp('date_updated', 'date-updated'),
      userUpdated(c),
    ],
    translations: [
      string('headline', { note: 'Kalimat prinsip di hero' }),
      text('short_bio', { note: '2-3 kalimat untuk home' }),
      markdown('summary', { note: 'Ringkasan lengkap untuk halaman About' }),
      repeater('highlights', [['value', 'input'], ['label', 'input']], { template: '{{value}} {{label}}', note: 'Angka di home, mis. 20+ digital products' }),
      repeater('principles', [['title', 'input'], ['description', 'input-multiline']], { template: '{{title}}', note: 'Section "How I work"' }),
      repeater('spoken_languages', [['name', 'input'], ['level', 'input']], { template: '{{name}} — {{level}}' }),
    ],
  },
  {
    collection: 'experiences',
    meta: contentMeta({ icon: 'work_history', display_template: '{{company}} · {{start_date}}', sort: 2 }),
    fields: (c) => [
      pk(),
      status(),
      sort(),
      string('company', { required: true, width: 'half' }),
      string('company_url', { width: 'half' }),
      string('location', { width: 'half' }),
      dropdown('employment_type', [
        ['full_time', 'Full-time'],
        ['contract', 'Contract'],
        ['internship', 'Internship'],
        ['apprenticeship', 'Apprenticeship'],
      ], { defaultValue: 'full_time' }),
      date('start_date', { required: true }),
      date('end_date', { note: 'Kosongkan = masih berjalan (Present)' }),
      translationsAlias('{{role}}'),
      m2mAlias('projects', '{{projects_id.title}}'),
      ...audit(c),
    ],
    translations: [
      string('role', { note: 'mis. Senior Product Manager — SIDEBAR' }),
      string('context', { note: 'mis. Promoted · Government Operation and Service Tribe' }),
      markdown('responsibilities'),
      markdown('achievements'),
    ],
  },
  {
    collection: 'projects',
    meta: contentMeta({ icon: 'deployed_code', display_template: '{{title}}', sort: 3 }),
    fields: (c) => [
      pk(),
      status(),
      sort(),
      string('slug', { required: true, unique: true, width: 'half' }),
      string('title', { required: true, width: 'half' }),
      dropdown('type', [['product', 'Product'], ['project', 'Project']], { required: true, defaultValue: 'project' }),
      string('client', { width: 'half' }),
      integer('year_start'),
      integer('year_end', { note: 'Kosong kalau satu tahun atau masih berjalan' }),
      boolean('is_ongoing', { label: 'Masih berjalan' }),
      boolean('featured', { label: 'Tampil di home' }),
      tags('platforms'),
      tags('roles'),
      file(c, 'cover'),
      string('url', { width: 'half', note: 'Link produk live (opsional)' }),
      translationsAlias('{{summary}}'),
      m2mAlias('experiences', '{{experiences_id.company}}'),
      ...audit(c),
    ],
    translations: [
      text('summary', { note: '±160 karakter, untuk kartu & meta description' }),
      markdown('body'),
    ],
  },
  {
    collection: 'posts',
    meta: contentMeta({ sort_field: null, icon: 'edit_note', display_template: '{{slug}}', sort: 4 }),
    fields: (c) => {
      relations.push({
        collection: c,
        field: 'original_language',
        related_collection: 'languages',
        schema: { on_delete: 'SET NULL' },
      });
      return [
        pk(),
        status(),
        string('slug', { required: true, unique: true, width: 'half' }),
        date('published_at', { required: true }),
        tags('tags'),
        string('medium_url', { width: 'half' }),
        {
          field: 'original_language',
          type: 'string',
          meta: { special: ['m2o'], interface: 'select-dropdown-m2o', width: 'half', options: { template: '{{name}}' } },
          schema: { default_value: 'id-ID' },
        },
        file(c, 'cover'),
        translationsAlias('{{title}}'),
        ...audit(c),
      ];
    },
    translations: [string('title'), text('excerpt'), markdown('body')],
  },
  {
    collection: 'education',
    meta: contentMeta({ icon: 'school', display_template: '{{institution}}', sort: 5 }),
    fields: (c) => [
      pk(),
      status(),
      sort(),
      string('institution', { required: true }),
      dropdown('category', [['formal', 'Formal'], ['non_formal', 'Non-formal']], { defaultValue: 'formal' }),
      string('grade', { width: 'half' }),
      integer('start_year'),
      integer('end_year'),
      translationsAlias('{{degree}}'),
      ...audit(c),
    ],
    translations: [string('degree'), markdown('description')],
  },
  {
    collection: 'certifications',
    meta: contentMeta({ icon: 'workspace_premium', display_template: '{{name}} · {{issuer}}', sort: 6 }),
    fields: (c) => [
      pk(),
      status(),
      sort(),
      string('name', { required: true }),
      string('issuer', { width: 'half' }),
      date('issued_date'),
      string('credential_url'),
      ...audit(c),
    ],
  },
  {
    collection: 'skills',
    meta: contentMeta({ icon: 'psychology', display_template: '{{translations}}', sort: 7 }),
    fields: (c) => [pk(), status(), sort(), translationsAlias('{{name}}'), ...audit(c)],
    translations: [string('name'), tags('keywords')],
  },
];

// ---------------------------------------------------------------------------
// Create everything
// ---------------------------------------------------------------------------
const ours = ['languages', 'experiences_projects', ...collections.flatMap((c) => [c.collection, `${c.collection}_translations`])];
const existing = new Set((await api.get('/collections')).map((c) => c.collection));
const clash = ours.filter((c) => existing.has(c));
if (clash.length) {
  console.error(`Schema sudah ada (${clash.join(', ')}). Gunakan "npm run cms:apply" untuk menerapkan snapshot.`);
  process.exit(1);
}

async function createCollection(collection, meta, fields) {
  await api.post('/collections', { collection, meta, schema: {}, fields: ordered(fields) });
  console.log(`+ ${collection}`);
}

// Languages first: every translations junction points at it.
await createCollection('languages', { icon: 'translate', hidden: true, display_template: '{{name}}', sort: 99 }, [
  { field: 'code', type: 'string', meta: { interface: 'input' }, schema: { is_primary_key: true, max_length: 10 } },
  string('name', { required: true }),
  dropdown('direction', [['ltr', 'LTR'], ['rtl', 'RTL']], { defaultValue: 'ltr' }),
]);

for (const def of collections) {
  await createCollection(def.collection, def.meta, def.fields(def.collection));

  if (def.translations) {
    const parent = def.collection;
    const junction = `${parent}_translations`;
    await createCollection(junction, { hidden: true, icon: 'import_export' }, [
      pk(),
      { field: `${parent}_id`, type: 'integer', meta: { hidden: true }, schema: {} },
      { field: 'languages_code', type: 'string', meta: { hidden: true }, schema: { max_length: 10 } },
      ...def.translations,
    ]);
    relations.push(
      {
        collection: junction,
        field: `${parent}_id`,
        related_collection: parent,
        meta: { one_field: 'translations', junction_field: 'languages_code', one_deselect_action: 'delete' },
        schema: { on_delete: 'CASCADE' },
      },
      {
        collection: junction,
        field: 'languages_code',
        related_collection: 'languages',
        meta: { junction_field: `${parent}_id`, one_deselect_action: 'nullify' },
        schema: { on_delete: 'CASCADE' },
      },
    );
  }
}

// experiences <-> projects (M2M, editable from both sides)
await createCollection('experiences_projects', { hidden: true, icon: 'import_export' }, [
  pk(),
  { field: 'experiences_id', type: 'integer', meta: { hidden: true }, schema: {} },
  { field: 'projects_id', type: 'integer', meta: { hidden: true }, schema: {} },
]);
relations.push(
  {
    collection: 'experiences_projects',
    field: 'projects_id',
    related_collection: 'projects',
    meta: { one_field: 'experiences', junction_field: 'experiences_id', one_deselect_action: 'delete' },
    schema: { on_delete: 'CASCADE' },
  },
  {
    collection: 'experiences_projects',
    field: 'experiences_id',
    related_collection: 'experiences',
    meta: { one_field: 'projects', junction_field: 'projects_id', one_deselect_action: 'delete' },
    schema: { on_delete: 'CASCADE' },
  },
);

for (const relation of relations) {
  await api.post('/relations', relation);
  console.log(`~ ${relation.collection}.${relation.field} -> ${relation.related_collection}`);
}

console.log('\nSchema dibuat. Lanjut: npm run cms:snapshot');
