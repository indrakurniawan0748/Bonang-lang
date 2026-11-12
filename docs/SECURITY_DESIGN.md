# SECURITY DESIGN — BONANG

Dokumen desain keamanan. Menjelaskan model ancaman, kontrol yang diimplementasikan,
dan batasan yang diketahui.

---

## 1. Model Ancaman

BONANG mengasumsikan aplikasi dijalankan di lingkungan yang tidak dipercaya
untuk input — jaringan, form, header, query string, dan body semuanya
dianggap dikendalikan penyerang.

| Vektor | Kontrol |
| --- | --- |
| SQL injection | Prepared statement positional `?`; allowlist identifier & operator |
| XSS | `escapeHtml()` tersedia; `bonang audit` menandai `innerHTML`/`eval` |
| Path traversal | `safeJoin` di semua jalur file; `safeFilename` untuk nama |
| CSRF | Token HMAC stateless berbasis session id |
| Password disclosure | scrypt + salt acak; password tidak pernah disimpan |
| Timing attack | `crypto.timingSafeEqual` untuk semua perbandingan rahasia |
| Brute force / abuse | `RateLimiter` per kunci |
| Session fixation | ID sesi acak 32 byte, tidak memuat data sensitif |
| Resource exhaustion | Batas body 5 MB; batas `maxConcurrent` |
| Secret di repo | `bonang audit` mencari hardcoded secret & secret di config |
| Upload berbahaya | `validateUpload` (nama, ukuran, tipe) |

---

## 2. Password

```js
const stored = hashPassword('rahasia');
verifyPassword('rahasia', stored);   // true
```

Format: `scrypt$N$r$p$salt$hash` — semua base64.

Parameter: N=16384, r=8, p=1 (default `node:crypto`).

Sifat penting:
- Salt acak per hash → dua password sama menghasilkan hash berbeda.
- Password tidak pernah muncul di dalam hash.
- Verifikasi memakai perbandingan timing-safe.
- Hash rusak ditolak (`false`), bukan melempar exception.

Diuji di `tests/security/security.test.js`:
"hashPassword menghasilkan hash yang tidak menyimpan password", "hash dengan
salt berbeda menghasilkan nilai berbeda", "verifyPassword menerima password
benar dan menolak salah", "verifyPassword menolak hash yang rusak".

---

## 3. Perbandingan Timing-Safe

```js
timingSafeEqual(a, b)
```

Normalisasi input ke Buffer (string → UTF-8), panjang berbeda langsung
`false`, lalu `crypto.timingSafeEqual`. Semua perbandingan HMAC, token CSRF,
dan password memakai fungsi ini.

---

## 4. Token & Signature

```js
randomToken(32);                        // 64 karakter hex
uuid();                                 // UUID v4
sign(payload, secret);                  // HMAC-SHA256 hex
verifySignature(payload, signature, secret);
```

`verifySignature` selalu memakai `timingSafeEqual`, termasuk ketika
panjang signature berbeda (ditolak tanpa perbandingan byte).

---

## 5. CSRF

Token stateless berbasis HMAC:

```js
const token = createCsrfToken(sessionId, secret);
verifyCsrfToken(token, sessionId, secret);
```

Token = `HMAC(sessionId, secret)`. Verifikasi gagal bila session id atau
secret berbeda. Tidak ada state server yang perlu disimpan, tapi tradeoff:
token tidak bisa dicabut tanpa mengganti secret.

---

## 6. Sanitasi Input

| Fungsi | Kegunaan |
| --- | --- |
| `escapeHtml(input)` | Escape `& < > " ' \`` → aman untuk teks dan atribut |
| `stripControlChars(input)` | Buang karakter kontrol kecuali newline/tab |
| `sanitizeText(input, maxLength)` | Strip control chars + trim + batas panjang |
| `isEmail(value)` | Pola email konservatif |

`escapeHtml` mengembalikan string kosong untuk `null`/`undefined` dan
mempertahankan non-string apa adanya (`123` → `"123"`).

---

## 7. Keamanan Path

```js
safeFilename('foto.jpg')            // 'foto.jpg'
safeFilename('../../etc/passwd')    // 'passwd' (basename)
safeFilename('..')                  // null

safeJoin(root, 'a', 'b.txt')        // path absolut di dalam root
safeJoin(root, '..', 'x')           // null
safeJoin('/tmp/data', '../data-evil/f') // null  ← prefix confusion
```

`safeJoin` membandingkan path hasil resolve dengan
`resolvedRoot + path.sep` — bukan `startsWith(resolvedRoot)` — supaya
`/data-evil` tidak lolos dari root `/data`.

---

## 8. Upload

```js
validateUpload('foto.jpg', 1024, ['jpg'], 5 * 1024 * 1024);
```

Pemeriksaan berurutan:
1. Nama file harus string dan **tidak boleh** memuat `/` atau `\` —
   percobaan traversal ditolak, bukan "dibersihkan" diam-diam.
2. `safeFilename` harus mengembalikan nilai valid.
3. Ukuran harus ≤ batas.
4. Ekstensi harus ada di allowlist (bila allowlist diisi).

Setiap pelanggaran melempar `ValidationError`.

---

## 9. Rate Limiting

```js
const limiter = new RateLimiter({ windowMs: 60000, max: 100 });
const { allowed, remaining, resetAt } = limiter.consume(ip);
```

- Kuota per kunci (IP, user id, dll).
- Jendela bergulir: setelah `windowMs`, kuota diisi ulang.
- In-memory — tidak terdistribusi antar-instance.

---

## 10. Session

```js
const id = store.create({ userId: 7, role: 'admin' });
store.get(id);        // data atau null
store.update(id, {...});
store.destroy(id);
```

- ID sesi: token acak 32 byte (64 hex).
- TTL default dan dapat dikonfigurasi.
- Sesi kedaluwarsa dibuang otomatis saat diakses.
- ID sesi tidak memuat data sensitif (hanya token acak).

---

## 11. Error Handling

Aturan: detail internal tidak pernah sampai ke user di produksi.

- `handleError` menulis pesan + stack ke log.
- Respons yang dikirim: `{ status, msg, error, message, details? }`.
- `msg` untuk status ≥ 500 diganti pesan generik
  ("Terjadi kesalahan pada server") kecuali mode development.
- `details` hanya berisi konteks terstruktur yang memang aman
  (mis. field validasi yang gagal).

---

## 12. Audit Statis (`bonang audit`)

Delapan pemeriksaan. Empat di antaranya berbasis analisis AST, bukan pencocokan
teks, agar bisa membedakan konstanta program dari data yang berasal dari
user:

| Pemeriksaan | Yang dicari | Cara deteksi |
| --- | --- | --- |
| Hardcoded secret | Pola `password`/`secret`/`api_key` bernilai literal | Regex per baris |
| SQL injection (gabungan) | String SQL yang digabungkan operator `+` | Regex per baris |
| SQL injection (template) | Template literal berisi SQL yang menginterpolasi data user | AST: interpolasi aman hanya bila nilainya konstanta program |
| SQL mentah | `whereRaw`/`having` dengan SQL tambahan atau jumlah placeholder yang tidak cocok | AST |
| XSS | `innerHTML`, `insertAdjacentHTML`, `document.write` tanpa escaping | Regex per baris |
| Path traversal | Pembacaan/penulisan file dengan path dari input user | Regex per baris |
| Route tanpa validasi | Route mutating yang tidak memvalidasi input | AST: receiver harus router-like, validasi dicek sampai ke delegasi method/service |
| Secret di config | Nilai sensitif di `.env*`, `bonang.config.js`, `config.json` | Pemeriksaan isi berkas |

### 12.1 Konstanta vs data user

Aturan SQL template hanya menandai interpolasi yang **tidak bisa dibuktikan
aman**. Interpolasi berikut aman:

- `this.x` yang di-assign literal string di constructor atau sebagai
  properti kelas,
- konstanta modul (`const TABLE = "products"`),
- hasil `assertIdentifier(...)`,
- literal biasa.

`this.x` yang berasal dari parameter constructor **tetap** dilaporkan,
karena nilainya tidak bisa dibuktikan berasal dari program.

### 12.2 Delegasi pada pemeriksaan route

Validasi sering tidak ada di handler, melainkan di method yang dipanggil:

```js
router.post("/api/products", (ctx) => this.store(ctx));
```

Auditor menelusuri `this.store` ke body method `store`, lalu ke service
yang dipanggil darinya. Kontrol autentikasi juga dihitung sebagai
rangkaian yang aman.

### 12.3 Batasan pemeriksaan

- Receiver route dikenali dari namanya (`router`, `*router`, `app`,
  `server`, `api`). Router dengan nama lain tidak dikenali.
- `whereRaw`/`having` menerima SQL mentah — keduanya tidak bisa
  diparameterkan seluruhnya. Yang diperiksa auditor adalah bentuk yang
  tetap aman: memakai placeholder `?` dengan jumlah parameter yang
  cocok. SQL mentah yang menambah statement atau salah jumlah
  placeholder dilaporkan.
- Nama fungsi validasi dikenali dari polanya
  (`validate*`, `readBody`, `readJson`, `assertBody`, `parseId`).
  Validasi dengan nama lain bisa terlewat.

Keluaran: daftar temuan dengan file, baris, level, dan saran perbaikan.
Perintah keluar dengan status 1 bila ada temuan `critical` atau `high`.

---

## 13. Prinsip Default

1. **Deny by default** — allowlist, bukan blacklist.
2. **Fail closed** — error pada validasi menghentikan operasi.
3. **Least privilege** — database hanya butuh file database; akses file
   dibatasi root folder.
4. **No silent failure** — kesalahan validasi tidak pernah diabaikan.
5. **Explicit > implicit** — placeholder positional, bukan string
   building.

---

## 14. Batasan Keamanan yang Diketahui

| Batasan | Dampak | Mitigasi sementara |
| --- | --- | --- |
| Session store in-memory | Sesi hilang saat restart, tidak shared | Deploy single-instance; ganti dengan store persisten bila perlu |
| Rate limiter in-memory | Tidak terdistribusi | Reverse proxy rate limiting untuk multi-instance |
| Tanpa proteksi CSRF otomatis di router | Token harus dipasang manual | Helper `createCsrfToken`/`verifyCsrfToken` tersedia |
| Tanpa proteksi brute force pada login | Tidak ada login bawaan | Rate limiter + `hashPassword` tersedia untuk aplikasi |
| Tanpa Content-Security-Policy default | Bergantung pada aplikasi | Header keamanan dapat dipasang per-aplikasi |
| Tanpa signed cookie | Cookie harus dipercaya atau di-tokenize | `sign`/`verifySignature` tersedia |
| Type checking tidak ada | Kesalahan tipe lolos ke runtime | Validasi runtime pada boundary |

---

## 15. Pengujian

`tests/security/security.test.js` — 55 test menutupi seluruh bagian di atas:
password, timing-safe compare, token, HMAC, CSRF, escape, sanitasi, path,
upload, rate limiter, session.

`tests/database/database.test.js` — 32 test, termasuk injeksi SQL via
placeholder, allowlist identifier, allowlist operator, dan allowlist
JOIN (jenis JOIN serta kondisi JOIN).

`tests/database/soft-delete.test.js` — 15 test, termasuk penolakan nama
tabel/kolom berbahaya pada `SoftDeleteRepository`.

`tests/tools/auditor.test.js` — 16 test mengunci perilaku auditor:
konstanta program tidak dilaporkan sebagai injeksi, parameter constructor
tetap dilaporkan, `store.put` bukan route, route yang memvalidasi lewat
delegasi tidak dilaporkan, dan empat aturan lain tetap bekerja.
