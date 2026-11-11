# COMPILER DESIGN — BONANG

Dokumen desain compiler. Menjelaskan pipeline, struktur data, algoritma
penting, dan batasannya.

---

## 1. Pipeline

```
source text
    │
    ▼
┌──────────────┐   token stream  { type, value, start, end, line, column }
│    Lexer     │
└──────┬───────┘
       │
       ▼
┌──────────────┐   AST  (compiler/ast/nodes.js)
│    Parser    │   Pratt / precedence climbing + backtracking
└──────┬───────┘
       │
       ▼
┌──────────────┐   JavaScript source text
│   Codegen    │   scope tracking, name mangling
└──────┬───────┘
       │
       ▼
   { code, ast, diagnostics }
```

Setiap tahap murni: lexer tidak tahu tentang parser, parser tidak tahu
tentang codegen. Ini membuat setiap tahap bisa diuji terpisah — ada
`tests/unit/lexer.test.js`, `tests/unit/parser.test.js`, dan
`tests/unit/codegen.test.js`.

---

## 2. Lexer (`compiler/lexer/`)

### 2.1 Tokenizer

Menghasilkan token dari sumber karakter. Tipe token: `keyword`,
`identifier`, `number`, `string`, `template`, `operator`, `punctuator`,
`eof`.

Operator dipisah dari panjang ke pendek (lihat
`docs/LANGUAGE_SPECIFICATION.md` §2.5) agar `===` tidak terpecah jadi `==`
+ `=`.

### 2.2 Escape

Escape dalam string: `\\ \' \" \n \r \t \b \f \v \0 \xNN \uNNNN`. Escape
yang tidak dikenal dipertahankan apa adanya (tanpa backslash) agar data
tidak hilang diam-diam.

### 2.3 Template literal

Template literal dipecah jadi bagian `quasi` (teks) dan `quasiExpression`
(source ekspresi). Parser kemudian meng-parse source ekspresi secara
rekursif. Ini yang membuat `` `Halo ${nama}` `` benar-benar menyisipkan
nilai, bukan menjadi string biasa (BNG-008).

---

## 3. Parser (`compiler/parser/parser.js`)

### 3.1 Strategi

- **Precedence climbing** untuk operator biner, logical, ternary, dan
  assignment.
- **Prefix parsing** untuk unary, primary, member, call, new, arrow.

### 3.2 Tabel presedensi

| Level | Operator | Asosiatif |
| --- | --- | --- |
| 1 | `??` | kiri |
| 2 | `\|\|` | kiri |
| 3 | `&&` | kiri |
| 4–6 | `\|`, `^`, `&` | kiri |
| 7 | `==`, `!=`, `===`, `!==` | kiri |
| 8 | `<`, `>`, `<=`, `>=`, `instanceof`, `in` | kiri |
| 9 | `<<`, `>>`, `>>>` | kiri |
| 10 | `+`, `-` | kiri |
| 11 | `*`, `/`, `%` | kiri |
| 12 | `**` | kanan |
| 13 | unary (`!`, `-`, `+`, `~`, `typeof`, `void`, `delete`) | prefix |
| 14 | call, member, optional chain, `new` | — |
| 15 | assignment | kanan |
| 16 | ternary `? :` | kanan |

### 3.3 Backtracking

Satu-satunya ambiguitas grammar adalah `(` di awal ekspresi. `tryParseArrowParams()`
mencoba mem-parse daftar parameter secara spekulatif:

1. Simpan `this.index`.
2. Parse daftar parameter — kegagalan ditoleransi (ditangkap).
3. Bila token berikutnya adalah `=>`, kembalikan hasil parse dan **reset**
   `this.index` supaya caller mem-parse ulang sebagai arrow.
4. Bila bukan, reset `this.index` dan kembalikan `null`.

Ini menyelesaikan BNG-005 (grouping tertukar dengan arrow).

### 3.4 Error

Error parse memuat `file:baris:kolom` dan cuplikan baris terkait. Ini
diverifikasi `tests/unit/parser.test.js` — kasus "error kompilasi
menyertakan posisi".

---

## 4. AST (`compiler/ast/nodes.js`)

37 node class, semuanya mewarisi `Node` yang membawa `type` dan `loc`.

| Kategori | Node |
| --- | --- |
| Program | `Program` |
| Deklarasi | `VarDeclaration`, `FunctionDeclaration`, `ClassDeclaration`, `InterfaceDeclaration`, `EnumDeclaration`, `TypeAlias`, `NamespaceDeclaration` |
| Statement | `BlockStatement`, `ExpressionStatement`, `IfStatement`, `WhileStatement`, `ForStatement`, `ForInStatement`, `ReturnStatement`, `BreakStatement`, `ContinueStatement`, `SwitchStatement`, `TryStatement`, `CatchClause`, `ThrowStatement` |
| Modul | `ImportDeclaration`, `ExportDeclaration` |
| Ekspresi | `Identifier`, `Literal`, `TemplateLiteral`, `ArrayExpression`, `ObjectExpression`, `UnaryExpression`, `UpdateExpression`, `BinaryExpression`, `LogicalExpression`, `AssignmentExpression`, `ConditionalExpression`, `CallExpression`, `NewExpression`, `MemberExpression`, `ArrowFunctionExpression`, `ThisExpression`, `SuperExpression`, `AwaitExpression` |
| Lain-lain | `TypeAnnotationNode`, `SpreadElement` |

---

## 5. Codegen (`compiler/codegen/generator.js`)

### 5.1 Scope tracking

```js
class Scope {
    constructor(parent) { this.parent = parent; this.vars = new Map(); }
    declare(name) { ... }
    lookup(name) { ... }   // null bila tidak ditemukan
    pickName(name) { ... } // nama unik bila bentrok
}
```

`pickName` menambahkan suffix `_1`, `_2`, … bila nama sudah dipakai scope
tersedia atau bentrok dengan nama global JavaScript (`name`, `length`,
`top`, `event`, `location`, `default`, `class`, `function`, `history`,
`status`, `origin`, `parent`, `self`, `closed`).

Akibatnya `let name = "x"` di Bonang tidak menimpa `window.name` — dan
`let class = 1` tetap legal di Bonang.

### 5.2 Generasi statement

| Node Bonang | Output JS |
| --- | --- |
| `fn` declaration | `function nama(...) { ... }` atau `async function` |
| `class` | `class Nama { ... }` dengan method menjadi method kelas |
| `interface` | dihapus (no-op) |
| `enum` | object frozen dengan konstanta |
| `type` alias | dihapus (no-op) |
| `namespace` | IIFE yang mengekspos objek |
| `let`/`const`/`var` | `let`/`const`/`var` dengan nama hasil `pickName` |
| `import` | `require(...)` + binding |
| `export` | `Object.assign(module.exports, { ... })` |

`export` memakai `Object.assign`, bukan `module.exports = {...}`, supaya
beberapa export pada satu modul tidak saling menimpa (BNG-010).

### 5.3 Kasus khusus yang punya regression test

| Kasus | Perilaku | Bug |
| --- | --- | --- |
| Arrow dengan body object literal | `() => ({ ... })` — dibungkus kurung | BNG-016 |
| `typeof x` | `typeof x ` dengan spasi — menyatu dengan literal angka berikutnya | BNG-017 |
| `void expr()` | `void expr()` | — |
| `export fn` | valid, bukan identifier | BNG-011 |

---

## 6. Bridge modul built-in

Kode Bonang mengimpor runtime lewat specifier yang dipetakan:

```js
if (request === 'bonang' || request === 'bonang/runtime') return nodeRequire('../runtime/index.js');
if (request === 'bonang/client')   return nodeRequire('../runtime/client/client.js');
if (request === 'bonang/std')       return nodeRequire('../standard-library/index.js');
```

`nodeRequire` disimpan terpisah dari `require` modul-level karena fungsi
`require` yang dikembalikan men-shadow `require` modul-level dan akan
menyebabkan rekursi tak terbatas (BNG-013).

---

## 7. Bundler (`compiler/bundler.js`)

### 7.1 Algoritma

1. Baca entry point.
2. Ikuti import statis secara rekursif, bangun graf modul.
3. Kompilasi tiap modul → JavaScript.
4. Tulis bundle:

```js
(function () {
    var __bngModules = {};
    var __bngCache = {};
    function __bngRequire(id) { ... }
    __bngModules["<path>"] = function (module, exports, require) { <compiled code> };
    ...
    var __bngEntry = __bngRequire("<entry>");
    if (__bngEntry && typeof __bngEntry.main === "function") { ... }
})();
```

5. Salin runtime ke folder output (`dist/runtime`).

### 7.2 Modul Node built-in

Tetap `require` asli — tidak di-bundle. `node:fs` dan sejenisnya tidak
perlu ada di browser.

### 7.3 Entry point

Entry bundle memanggil `main()` bila ada, dan memasang `.catch()` pada
promise yang dikembalikan sehingga error tidak hilang (BNG-015).

### 7.4 Batasan

- Import dinamis (`import()`) belum didukung.
- Circular dependency belum ditangani (modul yang sudah di-cache mungkin
  belum selesai diinisialisasi).

---

## 8. Determinisme

Build tidak memasukkan timestamp, hash acak, atau urutan iterasi dari
`Set`/`Map` yang tidak stabil. Graf modul diurutkan berdasarkan jalur
 absolut sebelum ditulis. Konsekuensi: input sama → output byte-identik
(NFR-08).

---

## 9. Strategi Pengujian Compiler

| Suite | Cakupan |
| --- | --- |
| `tests/unit/lexer.test.js` | Token, escape, template, keyword |
| `tests/unit/parser.test.js` | Seluruh grammar, error positioning, ambiguitas `(` |
| `tests/unit/codegen.test.js` | OOP, export, scope, arrow, unary |
| `tests/regression/bugs.test.js` | BNG-010..BNG-017 terkunci |

Fixture `tests/fixtures/smoke.bng` memuat seluruh fitur inti dan dipakai
sebagai smoke test kompilasi.

---

## 10. Batasan yang Diketahui

1. Anotasi tipe tidak ditegakkan.
2. `interface` dan `implements` tidak diverifikasi.
3. Destructure pattern tidak dieksekusi runtime.
4. Named export list (`export { a }`) belum didukung.
5. `namespace` hanya blok-bodied.
6. Import dinamis dan circular dependency belum ditangani bundler.
7. Belum ada type checker.
