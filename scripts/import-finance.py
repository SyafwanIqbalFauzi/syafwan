#!/usr/bin/env python3
"""Imports the Catat Money Google Sheet into the Directus finance_* collections.

Idempotent: categories/members are matched by name / Telegram ID, budgets by (tahun, kategori,
nama_pos), transactions by legacy_row (= sheet row number). Existing rows are never modified
or deleted; re-run it to pick up rows added to the sheet since. Finishes with a reconciliation
of row counts and totals against the sheet; exit code 1 if anything differs.

  source ~/.hermes/venvs/catat-money-keuangan/bin/activate
  DIRECTUS_URL=http://<syafwan-directus ip>:8055 python3 scripts/import-finance.py [--dry-run]
Token: ~/.hermes/credentials/catat-money-keuangan/directus-finance-token (hermes-finance user).
"""
import collections
import json
import os
import re
import sys
import urllib.error
import urllib.request

import gspread
from google.oauth2.service_account import Credentials

DRY = '--dry-run' in sys.argv
BASE = os.environ.get('DIRECTUS_URL', 'http://localhost:8055').rstrip('/')
CRED = os.path.expanduser('~/.hermes/credentials/catat-money-keuangan')
TOKEN = open(f'{CRED}/directus-finance-token').read().strip()
SHEET_ID = '10IQCxWYW1UNqbCX9ClPYsGJCQVcrVga1YSByybOWSNE'
MEMBERS = [
    {'nama_lengkap': 'Syafwan Iqbal Fauzi', 'nama_panggilan': 'Syafwan', 'telegram_user_id': 439794573},
    {'nama_lengkap': 'Riana Astiawati Yusnia', 'nama_panggilan': 'Asti', 'telegram_user_id': 900472924},
]
# Default type per category (a hint only: each transaction carries its own jenis,
# e.g. "nabung" is a pengeluaran under Investasi).
INCOME = {'Gaji', 'Freelance', 'Investasi', 'Pemasukan Lain'}
EXTRA_CATEGORIES = ['Lainnya', 'Pekerjaan']  # used by transactions, missing from the Kategori tab
TAHUN = 2026


def api(method, path, body=None):
    req = urllib.request.Request(
        BASE + path, method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return json.loads(raw)['data'] if raw else None
    except urllib.error.HTTPError as e:
        raise SystemExit(f'{method} {path} -> {e.code}: {e.read().decode()[:400]}')


def rupiah(s):
    return int(re.sub(r'[^\d]', '', s) or 0)


creds = Credentials.from_service_account_file(f'{CRED}/service-account.json', scopes=['https://www.googleapis.com/auth/spreadsheets'])
sh = gspread.authorize(creds).open_by_key(SHEET_ID)
trx = sh.worksheet('Transaksi').get_all_values()
kat = sh.worksheet('Kategori').get_all_values()[1:]
bud = sh.worksheet('Budgeting').get_all_values()
created = collections.Counter()

# --- members -----------------------------------------------------------------
have = {int(m['telegram_user_id']): m['id'] for m in api('GET', '/items/finance_members?limit=-1&fields=id,telegram_user_id')}
for m in MEMBERS:
    if m['telegram_user_id'] not in have:
        created['members'] += 1
        if not DRY:
            have[m['telegram_user_id']] = api('POST', '/items/finance_members', m)['id']
member_by_name = {m['nama_lengkap']: have.get(m['telegram_user_id']) for m in MEMBERS}

# --- categories --------------------------------------------------------------
have_cat = {c['nama']: c['id'] for c in api('GET', '/items/finance_categories?limit=-1&fields=id,nama')}
wanted = [(r[0].strip(), [k.strip() for k in r[1].split(',') if k.strip()] if len(r) > 1 else []) for r in kat if r and r[0].strip()]
wanted += [(n, []) for n in EXTRA_CATEGORIES if n not in {w[0] for w in wanted}]
for i, (nama, kw) in enumerate(wanted):
    if nama in have_cat:
        continue
    created['categories'] += 1
    if not DRY:
        have_cat[nama] = api('POST', '/items/finance_categories', {
            'nama': nama, 'jenis': 'pemasukan' if nama in INCOME else 'pengeluaran',
            'kata_kunci': kw, 'aktif': True, 'sort': i + 1})['id']

# --- budgets (Budgeting tab: income block cols A-B, expense block cols G-I) ----
budget_rows = []
for r in bud[4:]:
    r = r + [''] * (10 - len(r))
    if r[0] and r[0] != 'Total Pemasukan' and rupiah(r[1]) > 0:
        budget_rows.append((r[0], r[0], rupiah(r[1])))
    if r[6] and r[7] and r[6] != 'TOTAL PENGELUARAN' and rupiah(r[8]) > 0:
        budget_rows.append((r[6], r[7], rupiah(r[8])))
have_bud = {(b['tahun'], b['kategori'], b['nama_pos']) for b in api('GET', '/items/finance_budgets?limit=-1&fields=tahun,kategori,nama_pos')}
for k, pos, jumlah in budget_rows:
    if (TAHUN, have_cat.get(k), pos) in have_bud:
        continue
    created['budgets'] += 1
    if not DRY:
        api('POST', '/items/finance_budgets', {'tahun': TAHUN, 'kategori': have_cat[k], 'nama_pos': pos, 'jumlah': jumlah})

# --- transactions -------------------------------------------------------------
have_row = {t['legacy_row'] for t in api('GET', '/items/finance_transactions?limit=-1&fields=legacy_row&filter[legacy_row][_nnull]=true')}
batch = []
for n, r in enumerate(trx[1:], start=2):  # n = sheet row number (header is row 1)
    if n in have_row or not any(r):
        continue
    ts, tgl, jenis, k, desk, nom, user, _chat, sumber, msg = (r + [''] * 10)[:10]
    batch.append({
        'waktu': ts, 'tanggal': tgl, 'jenis': jenis, 'kategori': have_cat.get(k), 'deskripsi': desk,
        'nominal': rupiah(nom), 'member': member_by_name.get(user), 'sumber': sumber or None,
        'telegram_msg_id': msg or None, 'legacy_row': n})
missing = [b for b in batch if b['kategori'] is None and not DRY or b['member'] is None and not DRY]
if missing:
    raise SystemExit(f'unmapped kategori/member in {len(missing)} rows, e.g. {missing[0]}')
for i in range(0, len(batch), 100):
    created['transactions'] += len(batch[i:i + 100])
    if not DRY:
        api('POST', '/items/finance_transactions', batch[i:i + 100])
print('created' + (' (dry-run)' if DRY else ''), dict(created))
if DRY:
    sys.exit(0)

# --- reconciliation -----------------------------------------------------------
live = api('GET', '/items/finance_transactions?limit=-1&fields=jenis,nominal,tanggal,kategori.nama,member.nama_lengkap&filter[dihapus_pada][_null]=true')
src = [r + [''] * 10 for r in trx[1:] if any(r)]


def tally(rows):
    t = collections.Counter()
    for jenis, nom, kategori, member in rows:
        t[('jenis', jenis)] += nom
        t[('kategori', kategori)] += nom
        t[('member', member)] += nom
        t[('count', '')] += 1
    return t


a = tally((r[2], rupiah(r[5]), r[3], r[6]) for r in src)
b = tally((x['jenis'], int(x['nominal']), (x['kategori'] or {}).get('nama'), (x['member'] or {}).get('nama_lengkap')) for x in live)
bad = {k: (a.get(k, 0), b.get(k, 0)) for k in set(a) | set(b) if a.get(k, 0) != b.get(k, 0)}
print('sheet rows:', a[('count', '')], '| directus rows:', b[('count', '')])
print('pemasukan  sheet/directus:', a[('jenis', 'pemasukan')], b[('jenis', 'pemasukan')])
print('pengeluaran sheet/directus:', a[('jenis', 'pengeluaran')], b[('jenis', 'pengeluaran')])
print('MISMATCH:' if bad else 'OK: all counts and totals (jenis, kategori, member) match', bad or '')
sys.exit(1 if bad else 0)
