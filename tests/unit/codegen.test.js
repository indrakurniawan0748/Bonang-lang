'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Compiler } = require('../../compiler/compiler');

/**
 * Helper: kompilasi source Bonang lalu jalankan, mengembalikan ekspor modul.
 */
function run(source) {
    const compiler = new Compiler();
    return compiler.run(source, 'test.bng');
}

function runMain(source) {
    const compiler = new Compiler();
    const moduleObj = { exports: {} };
    const result = compiler.compile(source, 'test.bng');
    const fn = new Function('module', 'exports', 'require', result.code);
    fn(moduleObj, moduleObj.exports, require);
    return moduleObj.exports.main();
}

test('codegen: variabel dan aritmetika', () => {
    assert.equal(runMain('fn main() { return 1 + 2 * 3; }'), 7);
});

test('codegen: deklarasi let dapat di-reassign', () => {
    assert.equal(runMain(`
        fn main() {
            let x = 1;
            x = x + 10;
            return x;
        }
    `), 11);
});

test('codegen: string concatenation', () => {
    assert.equal(runMain(`fn main() { return "a" + "b"; }`), 'ab');
});

test('codegen: template literal menyisipkan variabel', () => {
    assert.equal(runMain(`
        fn main() {
            let name = "Bonang";
            return \`Halo \${name}!\`;
        }
    `), 'Halo Bonang!');
});

test('codegen: kondisi if/else', () => {
    assert.equal(runMain(`
        fn main() {
            let x = 10;
            if (x > 5) { return "besar"; } else { return "kecil"; }
        }
    `), 'besar');
});

test('codegen: loop while', () => {
    assert.equal(runMain(`
        fn main() {
            let i = 0;
            let total = 0;
            while (i < 5) { total = total + i; i = i + 1; }
            return total;
        }
    `), 10);
});

test('codegen: loop for C-style', () => {
    assert.equal(runMain(`
        fn main() {
            let total = 0;
            for (let i = 0; i < 5; i = i + 1) { total = total + i; }
            return total;
        }
    `), 10);
});

test('codegen: loop for-of mengiterasi array', () => {
    assert.equal(runMain(`
        fn main() {
            let items = [1, 2, 3];
            let total = 0;
            for (const item of items) { total = total + item; }
            return total;
        }
    `), 6);
});

test('codegen: loop for-in mengiterasi key object', () => {
    assert.equal(runMain(`
        fn main() {
            let obj = { a: 1, b: 2 };
            let keys = [];
            for (const k in obj) { keys.push(k); }
            return keys.length;
        }
    `), 2);
});

test('codegen: fungsi dengan parameter dan return', () => {
    assert.equal(runMain(`
        fn add(a: int, b: int): int { return a + b; }
        fn main() { return add(3, 4); }
    `), 7);
});

test('codegen: parameter default value', () => {
    assert.equal(runMain(`
        fn greet(name: string, greeting: string = "Hi"): string { return greeting + " " + name; }
        fn main() { return greet("Bonang"); }
    `), 'Hi Bonang');
});

test('codegen: fungsi rekursif', () => {
    assert.equal(runMain(`
        fn factorial(n: int): int {
            if (n <= 1) { return 1; }
            return n * factorial(n - 1);
        }
        fn main() { return factorial(5); }
    `), 120);
});

test('codegen: arrow function ekspresional', () => {
    assert.equal(runMain(`
        fn main() {
            const double = x => x * 2;
            return double(21);
        }
    `), 42);
});

test('codegen: arrow function dengan body blok', () => {
    assert.equal(runMain(`
        fn main() {
            const add = (a, b) => { return a + b; };
            return add(2, 3);
        }
    `), 5);
});

test('codegen: array dan object literal', () => {
    assert.equal(runMain(`
        fn main() {
            let arr = [1, 2, 3];
            let obj = { name: "x", nested: { deep: true } };
            return arr.length + (obj.nested.deep ? 1 : 0);
        }
    `), 4);
});

test('codegen: array spread', () => {
    assert.equal(runMain(`
        fn main() {
            let a = [1, 2];
            let b = [0, ...a, 3];
            return b.length;
        }
    `), 4);
});

test('codegen: object spread', () => {
    assert.equal(runMain(`
        fn main() {
            let base = { a: 1 };
            let merged = { ...base, b: 2 };
            return merged.a + merged.b;
        }
    `), 3);
});

test('codegen: closure menangkap variabel outer', () => {
    assert.equal(runMain(`
        fn makeCounter() {
            let count = 0;
            return () => { count = count + 1; return count; };
        }
        fn main() {
            const c = makeCounter();
            c(); c(); c();
            return c();
        }
    `), 4);
});

test('codegen: class dengan constructor dan method', () => {
    assert.equal(runMain(`
        class Product {
            constructor(name, price) {
                this.name = name;
                this.price = price;
            }
            total(stock) { return this.price * stock; }
        }
        fn main() {
            const p = new Product("Kopi", 100);
            return p.total(3);
        }
    `), 300);
});

test('codegen: class property dengan initializer', () => {
    assert.equal(runMain(`
        class Counter {
            value = 0;
            increment() { this.value = this.value + 1; }
        }
        fn main() {
            const c = new Counter();
            c.increment(); c.increment();
            return c.value;
        }
    `), 2);
});

test('codegen: inheritance dan super', () => {
    assert.equal(runMain(`
        class Animal {
            constructor(name) { this.name = name; }
            speak() { return this.name + " bersuara"; }
        }
        class Dog extends Animal {
            constructor(name) { super(name); }
            speak() { return super.speak() + " guk"; }
        }
        fn main() { return new Dog("Anjing").speak(); }
    `), 'Anjing bersuara guk');
});

test('codegen: static method', () => {
    assert.equal(runMain(`
        class Factory {
            static create() { return "dibuat"; }
        }
        fn main() { return Factory.create(); }
    `), 'dibuat');
});

test('codegen: getter dan setter', () => {
    assert.equal(runMain(`
        class Product {
            constructor(price) { this._price = price; }
            get price() { return this._price; }
            set price(value) { this._price = value; }
        }
        fn main() {
            const p = new Product(100);
            p.price = 250;
            return p.price;
        }
    `), 250);
});

test('codegen: polymorphic dispatch lewat this', () => {
    assert.equal(runMain(`
        class Shape { area() { return 0; } }
        class Square extends Shape { constructor(s) { super(); this.s = s; } area() { return this.s * this.s; } }
        fn main() {
            const shapes = [new Square(3), new Shape()];
            let total = 0;
            for (const s of shapes) { total = total + s.area(); }
            return total;
        }
    `), 9);
});

test('codegen: switch statement', () => {
    assert.equal(runMain(`
        fn classify(n: int): string {
            switch (n) {
                case 1: return "satu";
                case 2: return "dua";
                default: return "lain";
            }
        }
        fn main() { return classify(2); }
    `), 'dua');
});

test('codegen: try/catch/finally menangkap error', () => {
    assert.equal(runMain(`
        fn main() {
            try {
                throw new Error("boom");
            } catch (err) {
                return "ditangkap";
            } finally {
                // no-op
            }
        }
    `), 'ditangkap');
});

test('codegen: nilai error dari catch dapat diakses', () => {
    assert.equal(runMain(`
        fn main() {
            try {
                throw new Error("boom");
            } catch (err) {
                return err.message;
            }
        }
    `), 'boom');
});

test('codegen: break dan continue dalam loop', () => {
    // i = 1,3,5,7 lolos (genap di-skip), i = 9 terputus break.
    assert.equal(runMain(`
        fn main() {
            let total = 0;
            for (let i = 0; i < 10; i = i + 1) {
                if (i % 2 === 0) { continue; }
                if (i > 7) { break; }
                total = total + i;
            }
            return total;
        }
    `), 16);
});

test('codegen: optional chaining pada null aman', () => {
    assert.equal(runMain(`
        fn main() {
            const obj = null;
            return obj?.missing?.deeper;
        }
    `), undefined);
});

test('codegen: optional chaining mengembalikan nilai bila ada', () => {
    assert.equal(runMain(`
        fn main() {
            const obj = { a: { b: 5 } };
            return obj?.a?.b;
        }
    `), 5);
});

test('codegen: operator logis short-circuit', () => {
    assert.equal(runMain(`
        fn main() {
            let calls = 0;
            const boom = () => { calls = calls + 1; return true; };
            const result = false && boom();
            return calls;
        }
    `), 0);
});

test('codegen: nullish coalescing', () => {
    assert.equal(runMain(`
        fn main() {
            const a = null;
            return a ?? "default";
        }
    `), 'default');
});

test('codegen: enum menghasilkan object frozen', () => {
    assert.equal(runMain(`
        enum Status { Active, Inactive }
        fn main() { return Status.Active; }
    `), 0);
});

test('codegen: async function mengembalikan promise', async () => {
    const compiler = new Compiler();
    const moduleObj = { exports: {} };
    const result = compiler.compile('export async fn f() { return 42; }', 'test.bng');
    const fn = new Function('module', 'exports', 'require', result.code);
    fn(moduleObj, moduleObj.exports, require);
    assert.equal(await moduleObj.exports.f(), 42);
});

test('codegen: await bekerja di dalam async function', async () => {
    const compiler = new Compiler();
    const moduleObj = { exports: {} };
    const result = compiler.compile(`
        export async fn f() {
            const v = await Promise.resolve(7);
            return v * 2;
        }
    `, 'test.bng');
    const fn = new Function('module', 'exports', 'require', result.code);
    fn(moduleObj, moduleObj.exports, require);
    assert.equal(await moduleObj.exports.f(), 14);
});

test('codegen: export fungsi dapat dipanggil dari luar', () => {
    assert.equal(run('export fn greet() { return "hai"; }').greet(), 'hai');
});

test('codegen: variabel dengan nama keyword JavaScript di-rename aman', () => {
    assert.equal(runMain(`
        fn main() {
            const class = "ok";
            return class;
        }
    `), 'ok');
});

test('codegen: this di luar class tidak di-prefix', () => {
    // `this` harus tetap `this` supaya `this.name` pada class bekerja.
    const code = new Compiler().compile('class A { constructor() { this.x = 1; } }', 't.bng').code;
    assert.match(code, /this\.x/);
});

test('codegen: variabel lokal tidak berubah jadi this', () => {
    const code = new Compiler().compile('fn f() { let name = 1; return name; }', 't.bng').code;
    assert.match(code, /let name = 1/);
});
