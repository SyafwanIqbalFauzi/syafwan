#!/usr/bin/env python3
"""Adds the finance_* collections to a Directus schema snapshot (JSON).

Usage (on the VPS, nothing here touches the database):
  docker exec syafwan-directus npx directus schema snapshot --format json /tmp/before.json
  docker cp syafwan-directus:/tmp/before.json /tmp/before.json
  python3 cms/finance-snapshot.py /tmp/before.json /tmp/after.json
  docker cp /tmp/after.json syafwan-directus:/tmp/after.json
  docker exec syafwan-directus npx directus schema apply --dry-run /tmp/after.json   # review
  docker exec syafwan-directus npx directus schema apply --yes /tmp/after.json

Idempotent: collections/fields/relations that already exist in the snapshot are left alone.
Design: Catat Money moves from a Google Sheet to Directus; Telegram stays the input channel.
"""
import json
import sys

src, dst = sys.argv[1], sys.argv[2]
snap = json.load(open(src))
have_c = {c['collection'] for c in snap['collections']}
have_f = {(f['collection'], f['field']) for f in snap['fields']}
have_r = {(r['collection'], r['field']) for r in snap['relations']}

PG = {
    'integer': ('integer', None),
    'bigInteger': ('bigint', None),
    'string': ('character varying', 255),
    'text': ('text', None),
    'boolean': ('boolean', None),
    'timestamp': ('timestamp with time zone', None),
    'date': ('date', None),
    'json': ('json', None),
}


def collection(name, icon, note, sort_field=None):
    return {
        'collection': name,
        'meta': {
            'accountability': 'all', 'archive_app_filter': True, 'archive_field': None, 'archive_value': None,
            'collapse': 'open', 'collection': name, 'color': None, 'display_template': None, 'group': None,
            'hidden': False, 'icon': icon, 'item_duplication_fields': None, 'note': note, 'preview_url': None,
            'singleton': False, 'sort': None, 'sort_field': sort_field, 'translations': None,
            'unarchive_value': None, 'versioning': False,
        },
        'schema': {'name': name},
    }


counters = {}


def field(coll, name, ftype, *, interface='input', required=False, note=None, options=None, special=None,
          hidden=False, readonly=False, width='full', unique=False, indexed=False, default=None,
          nullable=None, display=None, display_options=None, pk=False, fk=None):
    counters[coll] = counters.get(coll, 0) + 1
    dt, maxlen = PG[ftype]
    if nullable is None:
        nullable = not (required or pk)
    return {
        'collection': coll, 'field': name, 'type': ftype,
        'meta': {
            'collection': coll, 'conditions': None, 'display': display, 'display_options': display_options,
            'field': name, 'group': None, 'hidden': hidden, 'interface': interface, 'note': note,
            'options': options, 'readonly': readonly, 'required': required, 'searchable': True,
            'sort': counters[coll], 'special': special, 'translations': None, 'validation': None,
            'validation_message': None, 'width': width,
        },
        'schema': {
            'name': name, 'table': coll, 'data_type': dt, 'default_value': default, 'max_length': maxlen,
            'numeric_precision': 32 if ftype == 'integer' else (64 if ftype == 'bigInteger' else None),
            'numeric_scale': 0 if ftype in ('integer', 'bigInteger') else None,
            'is_nullable': nullable, 'is_unique': unique or pk, 'is_indexed': indexed,
            'is_primary_key': pk, 'is_generated': False, 'generation_expression': None,
            'has_auto_increment': pk, 'foreign_key_table': fk, 'foreign_key_column': 'id' if fk else None,
        },
    }


def pk(coll):
    f = field(coll, 'id', 'integer', hidden=True, readonly=True, pk=True)
    f['schema']['default_value'] = f"nextval('{coll}_id_seq'::regclass)"
    return f


def dropdown(coll, name, choices, **kw):
    return field(coll, name, 'string', interface='select-dropdown',
                 options={'choices': [{'text': c.capitalize(), 'value': c} for c in choices]},
                 display='labels', **kw)


def m2o(coll, name, target, **kw):
    f = field(coll, name, 'integer', interface='select-dropdown-m2o', special=['m2o'], indexed=True, fk=target, **kw)
    rel = {
        'collection': coll, 'field': name, 'related_collection': target,
        'meta': {
            'junction_field': None, 'many_collection': coll, 'many_field': name, 'one_allowed_collections': None,
            'one_collection': target, 'one_collection_field': None, 'one_deselect_action': 'nullify',
            'one_field': None, 'sort_field': None,
        },
        'schema': {
            'table': coll, 'column': name, 'foreign_key_table': target, 'foreign_key_column': 'id',
            'constraint_name': f'{coll}_{name}_foreign', 'on_update': 'NO ACTION', 'on_delete': 'SET NULL',
        },
    }
    return f, rel


collections, fields, relations = [], [], []

# --- finance_members ---------------------------------------------------------
C = 'finance_members'
collections.append(collection(C, 'group', 'Anggota rumah tangga yang mencatat lewat Telegram (Catat Money).'))
fields += [
    pk(C),
    field(C, 'nama_lengkap', 'string', required=True),
    field(C, 'nama_panggilan', 'string', required=True, note='Nama yang dipakai di laporan (mis. Asti).'),
    field(C, 'telegram_user_id', 'bigInteger', unique=True, note='Telegram user ID pengirim; kunci untuk mengenali siapa yang mencatat.'),
]

# --- finance_categories ------------------------------------------------------
C = 'finance_categories'
collections.append(collection(C, 'category', 'Kategori transaksi. Kata kunci dipakai Hermes sebagai panduan, bukan aturan kaku.', 'sort'))
fields += [
    pk(C),
    field(C, 'nama', 'string', required=True, unique=True),
    dropdown(C, 'jenis', ['pemasukan', 'pengeluaran', 'tabungan'], required=True),
    field(C, 'kata_kunci', 'json', interface='tags', special=['cast-json'],
          note='Array JSON berisi kata kunci, mis. ["kopi","nasi"].'),
    field(C, 'aktif', 'boolean', interface='boolean', special=['cast-boolean'], default='true', nullable=False,
          note='Nonaktifkan, jangan hapus, supaya transaksi lama tetap valid.'),
    field(C, 'sort', 'integer', hidden=True),
]

# --- finance_transactions ----------------------------------------------------
C = 'finance_transactions'
collections.append(collection(C, 'receipt_long', 'Transaksi keuangan rumah tangga. Soft delete lewat dihapus_pada; jangan hapus baris.'))
fields += [pk(C)]
fields += [
    field(C, 'waktu', 'timestamp', interface='datetime', required=True, note='Saat dicatat/terjadi (disimpan UTC, tampil WIB).', display='datetime'),
    field(C, 'tanggal', 'date', interface='datetime', required=True, indexed=True, note='Tanggal WIB kejadian; dipisah dari waktu supaya agregasi harian tidak geser zona.'),
    dropdown(C, 'jenis', ['pemasukan', 'pengeluaran', 'tabungan'], required=True),
]
f, r = m2o(C, 'kategori', 'finance_categories', note='Kategori transaksi.')
fields.append(f); relations.append(r)
fields.append(field(C, 'deskripsi', 'string'))
fields.append(field(C, 'nominal', 'bigInteger', required=True, note='Rupiah, bilangan bulat positif. Tanda ditentukan oleh jenis.'))
f, r = m2o(C, 'member', 'finance_members', note='Siapa yang mencatat.')
fields.append(f); relations.append(r)
fields += [
    dropdown(C, 'sumber', ['regex', 'claude', 'hermes', 'web']),
    field(C, 'telegram_msg_id', 'string', note='Telegram message ID bila tersedia (sering kosong).'),
    field(C, 'legacy_row', 'integer', unique=True, note='Nomor baris di Google Sheet (hanya data hasil migrasi); kunci impor idempoten.'),
    field(C, 'dihapus_pada', 'timestamp', interface='datetime', note='Soft delete: terisi = dianggap terhapus (tidak masuk rekap). Jangan hapus baris.', display='datetime'),
    field(C, 'date_created', 'timestamp', interface='datetime', special=['date-created'], readonly=True, hidden=True, display='datetime'),
    field(C, 'date_updated', 'timestamp', interface='datetime', special=['date-updated'], readonly=True, hidden=True, display='datetime'),
]

# --- finance_budgets ---------------------------------------------------------
C = 'finance_budgets'
collections.append(collection(C, 'savings', 'Anggaran bulanan per pos (dari tab Budgeting 2026).'))
fields += [pk(C), field(C, 'tahun', 'integer', required=True, indexed=True)]
f, r = m2o(C, 'kategori', 'finance_categories', required=True)
fields.append(f); relations.append(r)
fields += [
    field(C, 'nama_pos', 'string', required=True, note='Mis. KPR Rumah, Internet Rumah, SPP Khafa.'),
    field(C, 'jumlah', 'bigInteger', required=True, note='Rupiah per bulan.'),
]

added = {'collections': 0, 'fields': 0, 'relations': 0}
for c in collections:
    if c['collection'] not in have_c:
        snap['collections'].append(c); added['collections'] += 1
for f in fields:
    if (f['collection'], f['field']) not in have_f:
        snap['fields'].append(f); added['fields'] += 1
for r in relations:
    if (r['collection'], r['field']) not in have_r:
        snap['relations'].append(r); added['relations'] += 1

json.dump(snap, open(dst, 'w'), indent=2)
print('added', added)
