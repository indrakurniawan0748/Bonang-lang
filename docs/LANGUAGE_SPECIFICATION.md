# LANGUAGE SPECIFICATION — BONANG

Versi bahasa: **0.1**
Tanggal: 2026-11-11

Dokumen ini adalah rujukan normatif sintaks dan semantik BONANG. Setiap
konstruk di sini **terimplementasi** dan tercakup test; hal yang belum ada
dicatat eksplisit di `docs/KNOWN_LIMITATIONS.md`.

---

## 1. Notasi

Grammar ditulis dalam BNF-esque:

```
Program    := Statement*
Statement  := ...
```

`?` berarti opsional, `*` berarti nol atau lebih, `|` berarti alternasi.
Kata kunci ditulis huruf kecil dan **case-sensitive**.

---

## 2. Leksikal

### 2.1 Identifier

```
Identifier := [A-Za-z_$][A-Za-z0-9_$]*
```

`$` dan `_` boleh dipakai sebagai prefix. Identifier tidak boleh diawali
digit.

### 2.2 Literal angka

```
Number := Integer | Float
Integer := [0-9]+ | 0x[0-9a-fA-F]+ | 0b[01]+
Float   := [0-9]+ '.' [0-9]+ | [0-9]+ ('.' [0-9]+)? ([eE][+-]?[0-9]+)
```

Tidak ada separator digit (`1_000` ditolak).

### 2.3 Literal string

```
String := '"' chars? '"' | "'" chars? "'"
```

Escape yang didukung: `\\`, `\'`, `\"`, `\n`, `\r`, `\t`, `\b`, `\f`, `\v`,
`\0`, `\xNN`, `\uNNNN`. Interpolasi template literal memakai backtick:

```
`Halo ${nama}, total ${harga * 2}`
```

### 2.4 Keyword

Deklarasi: `let`, `const`, `var`, `fn`, `class`, `interface`, `enum`, `type`,
`namespace`, `module`, `function` (alias `fn`).

Kontrol alur: `if`, `else`, `while`, `for`, `in`, `of`, `return`, `break`,
`continue`, `switch`, `case`, `default`, `try`, `catch`, `finally`, `throw`.

Async: `async`, `await`.

OOP: `new`, `this`, `super`, `static`, `get`, `set`.

Operator khusus: `typeof`, `void`.

Modifier: `public`, `private`, `protected`, `abstract`, `override`,
`readonly`.

Relasi & modul: `implements`, `extends`, `instanceof`, `import`, `export`,
`from`, `as`, `default`.

Target: `server`, `client`, `shared`.

Literal: `true`, `false`, `null`, `undefined`.

Tipe: `int`, `float`, `string`, `bool`, `any`, `void`, `never`, `object`.

### 2.5 Operator

Dari terpanjang ke terpendek:

```
>>>= ... === !== **= <<= >>= >>> &&= ||= ??= =>
== != <= >= && || ?? ?. += -= *= /= %= &= |= ^== ** ++ --
+ - * / % = < > ! ? : . , ; ( ) [ ] { } & | ^ ~ @
```

### 2.6 Komentar

```
// satu baris
/* banyak baris */
```

---

## 3. Program dan modul

```
Program := Statement*

Statement :=
    | ImportDeclaration
    | ExportDeclaration
    | Declaration
    | Statement
```

### 3.1 Import

```
import defaultBinding from "module";
import { a, b as c } from "module";
import * as ns from "module";
import defaultBinding, { a } from "module";
```

- `from` wajib sebelum nama modul.
- `as` bersifat opsional pada setiap binding.
- Specifier boleh berupa path relatif (`./x.bng`, `../y/z.bng`) atau
  nama paket (`bonang`, `bonang/std`, `bonang/client`).
- Path relatif harus menyertakan ekstensi.

### 3.2 Export

```
export fn greet(name) { ... }
export class Foo { ... }
export const x = 1;
export default fn main() { ... }
```

Bentuk deklarasi tunggal yang didukung. Named export list
(`export { a, b as c }`) juga didukung — lihat §3.2.1.

### 3.2.1 Named Export List

```
const a = 1;
const b = 2;

export { a, b as c };
```

Modul yang mengimpor hasil ekspor tersebut:

```
import { a, c } from "./modulo.bng";
```

| Bentuk | Makna |
| --- | --- |
| `export { a }` | Ekspor `a` dengan nama `a`. |
| `export { a as c }` | Ekspor `a` dengan nama `c` di modul ini. |

Bila `a` berasal dari `import`, nilai yang diekspor adalah nilai modul
asal — bukan binding lokal yang belum terisi. Ini yang membuat
re-export bekerja pada siklus modul.

### 3.3 Namespace

```
namespace Outer {
    export fn helper() { ... }
}
```

Blok-bodied. Dotted namespace belum didukung.

---

## 4. Deklarasi variabel

```
let x = 1;             // dapat diubah
const y = 2;           // tidak dapat diubah (error saat assignment ulang)
var z = 3;             // fungsi-scoped seperti JavaScript
```

Deklarasi tanpa inisialisasi diizinkan untuk `let`/`var`; nilainya
`undefined`.

---

## 5. Fungsi

```
FunctionDeclaration :=
    ('async')? 'fn' Identifier TypeParams? '(' ParameterList? ')' (':' Type)? Block
```

### 5.1 Parameter

```
Parameter := Identifier (':' Type)? ('=' Expression)?
```

Nilai default diterapkan bila argumen `undefined` atau tidak diberikan.

### 5.2 Tipe

Anotasi tipe bersifat **dokumentasi** pada v0.1: diparse dan disimpan di AST,
tidak ditegakkan saat runtime (lihat `docs/KNOWN_LIMITATIONS.md`).

Tipe yang dikenali: `int`, `float`, `string`, `bool`, `any`, `void`,
`never`, `object`.

### 5.3 Arrow function

```
(a, b) => a + b
(a: int, b: int): int => a + b
x => x * 2
async () => { await something(); }
```

Body berbentuk object literal harus dibungkus tanda kurung —
`() => ({ a: 1 })` — seperti JavaScript.

### 5.4 Fungsi sebagai nilai

Fungsi adalah nilai. `fn` pada ekspresi membuat fungsi anonim:

```
const add = fn(a, b) { return a + b; };
```

---

## 6. Kontrol alur

### 6.1 Percabangan

```
if (cond) { ... } else if (cond2) { ... } else { ... }
```

`if` tanpa blok diperbolehkan: `if (cond) statement;`

### 6.2 Loop

```
while (cond) { ... }

for (let i = 0; i < 10; i = i + 1) { ... }

for (const item of list) { ... }
for (const key in object) { ... }
```

Bentuk `for..of` dan `for..in` dibedakan dari `for` C-style dengan memeriksa
keyword `of`/`in` pada posisi ketiga.

### 6.3 switch

```
switch (value) {
    case 1: { ... break; }
    case 2:
    case 3: { ... break; }
    default: { ... }
}
```

### 6.4 try/catch/finally

```
try { ... } catch (err) { ... } finally { ... }
```

`catch` tanpa binding dan `try` dengan `finally` saja sudah didukung.
`try` tanpa `catch` **dan** tanpa `finally` ditolak saat parse.

### 6.5 Keyword kontrol

`return`, `break`, `continue`, `throw`.

---

## 7. OOP

### 7.1 Class

```
class Name extends Base implements Iface {
    field: Type = value;
    static counter = 0;

    constructor(args) {
        super(args);
        this.field = args;
    }

    method(args): ReturnType { ... }

    get value() { ... }
    set value(v) { ... }

    private secret() { ... }
    protected internal() { ... }
    public exposed() { ... }

    abstract mustImplement();
}
```

- `extends` adalah single-inheritance.
- `implements` bersifat deklaratif (tidak diperiksa runtime pada v0.1).
- `static` untuk method dan field statis.
- `get`/`set` untuk properti accessor.
- `super` memanggil constructor atau method parent.
- `this` merujuk instance berjalan.

### 7.2 Interface

```
interface Shape {
    area(): float;
}
```

Dokumentasi saja pada v0.1 — tidak ada validasi struktural.

### 7.3 Enum

```
enum Status {
    Active = 1,
    Inactive = 2
}
```

Nilai default mulai dari 0 bila tidak ditentukan.

### 7.4 Type alias

```
type UserId = int;
```

---

## 8. Ekspresi

### 8.1 Prioritas

Dari tertinggi ke terendah:

1. Grouping `( ... )`, `new`, call, member, index
2. `typeof`, `void`, `delete`, unary `!`, `-`, `+`, `~`
3. `**`
4. `*`, `/`, `%`
5. `+`, `-`
6. `<<`, `>>`, `>>>`
7. `<`, `>`, `<=`, `>=`, `instanceof`, `in`
8. `==`, `!=`, `===`, `!==`
9. `&`
10. `^`
11. `|`
12. `&&`
13. `||`
14. `??`
15. Ternary `? :`
16. Assignment (termasuk `+=`, `-=`, `*=`, `/=`, `%=`, `&&=`, `||=`, `??=`,
    `**=`, `&=`, `|=`, `^=`, `<<=`, `>>=`, `>>>=`)

### 8.2 Bentuk khusus

- **Optional chaining**: `a?.b?.c`
- **Nullish coalescing**: `a ?? b`
- **Logical assignment**: `a ||= b`, `a &&= b`, `a ??= b`
- **Spread**: `fn(...args)`, `{ ...obj }`, `[...arr]`
- **Update**: `i++`, `++i`, `i--`, `--i`
- **Ternary**: `cond ? a : b`
- **`void`**: `void expr()` — evaluates dan membuang hasilnya (berguna untuk
  membuang promise yang ditolak tanpa menjadi unhandled rejection).

---

## 9. Async

```
async fn load(): Promise<int> {
    const value = await fetchThing();
    return value;
}
```

`await` hanya boleh muncul di dalam fungsi `async`.

---

## 10. Target: server / client / shared

```
server fn handleRequest() { ... }
client fn render() { ... }
shared const MAX = 10;
```

Modifier menentukan target build. Konvensi folder yang dipakai build:

| Folder | Target |
| --- | --- |
| `src/server/` | server (Node) |
| `src/client/` | client (browser) |
| `src/shared/` | shared (kedua target) |

---

## 11. Kontrak respons JSON

```
{ "status": "success", "data": ... }
{ "status": "error", "msg": "...", "error": "CODE", "details": {...} }
```

---

## 12. Contoh program lengkap

```
// src/server/main.bng
import { createServer } from "bonang";
import { ProductController } from "./product-controller.bng";

server fn main() {
    const app = createServer({ port: 3000 });
    const controller = new ProductController();
    controller.registerRoutes(app.router);
    await app.listen(3000);
}
```

---

## 13. Yang bukan bagian bahasa (terbatas)

- Anotasi tipe tidak ditegakkan.
- `interface` dan `implements` tidak diverifikasi.
- Generic dan tipe parameterik belum ada.
- Dotted namespace belum ada.
- Modul built-in `bonang` diekspos lewat bridge JS (lihat
  `docs/COMPILER_DESIGN.md`).

Semua hal di atas tercatat di `docs/KNOWN_LIMITATIONS.md`.
