'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse, CompilerError } = require('../../compiler/parser/parser');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'smoke.bng');

function parseOne(src) {
    return parse(src, 'test.bng');
}

test('parser: program kosong menghasilkan AST kosong', () => {
    const ast = parseOne('');
    assert.equal(ast.type, 'Program');
    assert.equal(ast.body.length, 0);
});

test('parser: deklarasi variabel dengan inisialisasi', () => {
    const ast = parseOne('let x = 10; const y = "a"; var z;');
    assert.equal(ast.body.length, 3);
    assert.equal(ast.body[0].type, 'VarDeclaration');
    assert.equal(ast.body[0].kind, 'let');
    assert.equal(ast.body[0].declarations[0].id, 'x');
    assert.equal(ast.body[0].declarations[0].init.value, 10);
    assert.equal(ast.body[1].kind, 'const');
    assert.equal(ast.body[2].declarations[0].init, null);
});

test('parser: deklarasi variabel ganda dipisah koma', () => {
    const ast = parseOne('let a = 1, b = 2;');
    assert.equal(ast.body[0].declarations.length, 2);
    assert.equal(ast.body[0].declarations[1].id, 'b');
});

test('parser: operator aritmetika mengikuti precedence', () => {
    const ast = parseOne('let x = 1 + 2 * 3;');
    const expr = ast.body[0].declarations[0].init;
    assert.equal(expr.type, 'BinaryExpression');
    assert.equal(expr.operator, '+');
    assert.equal(expr.right.type, 'BinaryExpression');
    assert.equal(expr.right.operator, '*');
});

test('parser: operator pangkat bersifat right-associative', () => {
    const ast = parseOne('let x = 2 ** 3 ** 2;');
    const expr = ast.body[0].declarations[0].init;
    assert.equal(expr.operator, '**');
    assert.equal(expr.right.operator, '**');
});

test('parser: ekspresi logis menghasilkan LogicalExpression', () => {
    const ast = parseOne('if (a && b || c) { x(); }');
    const test_ = ast.body[0].test;
    assert.equal(test_.type, 'LogicalExpression');
    assert.equal(test_.operator, '||');
    assert.equal(test_.left.operator, '&&');
});

test('parser: conditional expression', () => {
    const ast = parseOne('let x = a ? b : c;');
    const expr = ast.body[0].declarations[0].init;
    assert.equal(expr.type, 'ConditionalExpression');
    assert.equal(expr.consequent.type, 'Identifier');
});

test('parser: grouping expression dipertahankan', () => {
    const ast = parseOne('let x = (a + b) * c;');
    const expr = ast.body[0].declarations[0].init;
    assert.equal(expr.operator, '*');
    assert.equal(expr.left.type, 'BinaryExpression');
});

test('parser: arrow function tanpa kurung', () => {
    const ast = parseOne('const f = x => x * 2;');
    const expr = ast.body[0].declarations[0].init;
    assert.equal(expr.type, 'ArrowFunctionExpression');
    assert.equal(expr.params.length, 1);
    assert.equal(expr.params[0].id, 'x');
    assert.equal(expr.isExpression, true);
});

test('parser: arrow function dengan kurung dan body blok', () => {
    const ast = parseOne('const f = (a, b) => { return a + b; };');
    const expr = ast.body[0].declarations[0].init;
    assert.equal(expr.type, 'ArrowFunctionExpression');
    assert.equal(expr.params.length, 2);
    assert.equal(expr.isExpression, false);
    assert.equal(expr.body.type, 'BlockStatement');
});

test('parser: arrow function dengan parameter bertipe', () => {
    const ast = parseOne('const f = (a: int, b: int): int => a + b;');
    const expr = ast.body[0].declarations[0].init;
    assert.equal(expr.type, 'ArrowFunctionExpression');
    assert.equal(expr.params[0].typeAnnotation.node.kind, 'primitive');
});

test('parser: async arrow function', () => {
    const ast = parseOne('const f = async (x) => { await x; };');
    const expr = ast.body[0].declarations[0].init;
    assert.equal(expr.type, 'ArrowFunctionExpression');
    assert.equal(expr.isAsync, true);
});

test('parser: fungsi dengan parameter, default, dan tipe return', () => {
    const ast = parseOne('fn greet(name: string, g: string = "Hi"): string { return g; }');
    const fn = ast.body[0];
    assert.equal(fn.type, 'FunctionDeclaration');
    assert.equal(fn.name, 'greet');
    assert.equal(fn.params.length, 2);
    assert.equal(fn.params[0].typeAnnotation.node.name, 'string');
    assert.ok(fn.params[1].defaultValue);
    assert.equal(fn.returnType.node.name, 'string');
});

test('parser: async function', () => {
    const ast = parseOne('async fn load(): int[] { return []; }');
    assert.equal(ast.body[0].type, 'FunctionDeclaration');
    assert.equal(ast.body[0].isAsync, true);
});

test('parser: class dengan inheritance dan implements', () => {
    const ast = parseOne('class P extends B implements I, J { }');
    const cls = ast.body[0];
    assert.equal(cls.name, 'P');
    assert.equal(cls.superClass.name, 'B');
    assert.deepEqual(cls.implements, ['I', 'J']);
});

test('parser: class abstrak ditandai modifier', () => {
    const ast = parseOne('abstract class A { }');
    assert.ok(ast.body[0].modifiers.includes('abstract'));
});

test('parser: member class — property, method, constructor, getter, setter', () => {
    const ast = parseOne(`
        class A {
            public name: string;
            private price: float = 0.0;
            constructor(n: string) { this.name = n; }
            area(): float { return 1.0; }
            get label(): string { return this.name; }
            set label(v: string) { this.name = v; }
            static make(): A { return new A("x"); }
        }
    `);
    const members = ast.body[0].members;
    const kinds = members.map((m) => m.kind);
    assert.ok(kinds.includes('property'));
    assert.ok(kinds.includes('constructor'));
    assert.ok(kinds.includes('method'));
    assert.ok(kinds.includes('getter'));
    assert.ok(kinds.includes('setter'));

    const getter = members.find((m) => m.kind === 'getter');
    assert.equal(getter.name, 'label');
    const setter = members.find((m) => m.kind === 'setter');
    assert.equal(setter.name, 'label');
});

test('parser: method class dengan keyword `fn`', () => {
    const ast = parseOne('class A { fn hello(): string { return "x"; } }');
    const m = ast.body[0].members[0];
    assert.equal(m.kind, 'method');
    assert.equal(m.name, 'hello');
});

test('parser: interface dengan method', () => {
    const ast = parseOne('interface S { area(): float; }');
    assert.equal(ast.body[0].type, 'InterfaceDeclaration');
    assert.equal(ast.body[0].members[0].name, 'area');
});

test('parser: enum dengan nilai otomatis dan eksplisit', () => {
    const ast = parseOne('enum E { A, B = 5, C }');
    const members = ast.body[0].members;
    assert.equal(members[0].value, 0);
    assert.equal(members[1].value, 5);
    assert.equal(members[2].value, 6);
});

test('parser: import dengan alias', () => {
    const ast = parseOne('import { a, b as c } from "./m.bng";');
    const imp = ast.body[0];
    assert.equal(imp.source, './m.bng');
    assert.equal(imp.specifiers.length, 2);
    assert.equal(imp.specifiers[1].local, 'c');
});

test('parser: import namespace', () => {
    const ast = parseOne('import * as ns from "./m.bng";');
    assert.equal(ast.body[0].specifiers[0].local, 'ns');
});

test('parser: export membungkus deklarasi', () => {
    const ast = parseOne('export fn f() { }');
    assert.equal(ast.body[0].type, 'ExportDeclaration');
    assert.equal(ast.body[0].declaration.type, 'FunctionDeclaration');
});

test('parser: if/else', () => {
    const ast = parseOne('if (a) { x(); } else { y(); }');
    const stmt = ast.body[0];
    assert.equal(stmt.type, 'IfStatement');
    assert.ok(stmt.consequent);
    assert.ok(stmt.alternate);
});

test('parser: while loop', () => {
    const ast = parseOne('while (a) { x(); }');
    assert.equal(ast.body[0].type, 'WhileStatement');
});

test('parser: for C-style', () => {
    const ast = parseOne('for (let i = 0; i < 10; i = i + 1) { x(); }');
    const stmt = ast.body[0];
    assert.equal(stmt.type, 'ForStatement');
    assert.ok(stmt.init);
    assert.ok(stmt.test);
    assert.ok(stmt.update);
});

test('parser: for-of dan for-in', () => {
    const forOf = parseOne('for (const x of list) { x(); }');
    assert.equal(forOf.body[0].type, 'ForInStatement');
    assert.equal(forOf.body[0].isOf, true);

    const forIn = parseOne('for (const k in obj) { k(); }');
    assert.equal(forIn.body[0].type, 'ForInStatement');
    assert.equal(forIn.body[0].isOf, false);
});

test('parser: switch dengan case dan default', () => {
    const ast = parseOne('switch (x) { case 1: a(); break; default: b(); }');
    const stmt = ast.body[0];
    assert.equal(stmt.type, 'SwitchStatement');
    assert.equal(stmt.cases.length, 2);
    assert.equal(stmt.cases[1].test, null);
});

test('parser: try/catch/finally', () => {
    const ast = parseOne('try { a(); } catch (e) { b(e); } finally { c(); }');
    const stmt = ast.body[0];
    assert.equal(stmt.type, 'TryStatement');
    assert.equal(stmt.handler.param.id, 'e');
    assert.ok(stmt.finalizer);
});

test('parser: try tanpa catch tetap valid bila ada finally', () => {
    const ast = parseOne('try { a(); } finally { c(); }');
    assert.equal(ast.body[0].handler, null);
});

test('parser: try tanpa catch dan finally ditolak', () => {
    assert.throws(() => parseOne('try { a(); }'), CompilerError);
});

test('parser: throw, break, continue, return', () => {
    const ast = parseOne('fn f() { throw new Error("x"); }');
    assert.equal(ast.body[0].body.body[0].type, 'ThrowStatement');

    const brk = parseOne('while (a) { break; continue; }');
    assert.equal(brk.body[0].body.body[0].type, 'BreakStatement');
    assert.equal(brk.body[0].body.body[1].type, 'ContinueStatement');

    const ret = parseOne('fn f() { return 1; }');
    assert.equal(ret.body[0].body.body[0].type, 'ReturnStatement');
});

test('parser: new expression', () => {
    const ast = parseOne('let p = new Product("a", 1);');
    const expr = ast.body[0].declarations[0].init;
    assert.equal(expr.type, 'NewExpression');
    assert.equal(expr.args.length, 2);
});

test('parser: member expression dan optional chaining', () => {
    const ast = parseOne('let a = obj.prop; let b = obj?.prop; let c = arr[0];');
    assert.equal(ast.body[0].declarations[0].init.type, 'MemberExpression');
    assert.equal(ast.body[1].declarations[0].init.optional, true);
    assert.equal(ast.body[2].declarations[0].init.computed, true);
});

test('parser: array literal dengan spread', () => {
    const ast = parseOne('let a = [1, 2, ...rest];');
    const el = ast.body[0].declarations[0].init.elements;
    assert.equal(el.length, 3);
    assert.equal(el[2].type, 'SpreadElement');
});

test('parser: object literal dengan shorthand dan nested', () => {
    const ast = parseOne('let o = { a: 1, b, c: { d: 2 } };');
    const props = ast.body[0].declarations[0].init.properties;
    assert.equal(props.length, 3);
    assert.equal(props[1].shorthand, true);
    assert.equal(props[2].value.type, 'ObjectExpression');
});

test('parser: template literal menghasilkan ekspresi tersisip', () => {
    const ast = parseOne('let s = `Hi ${name} and ${age}`;');
    const tmpl = ast.body[0].declarations[0].init;
    assert.equal(tmpl.type, 'TemplateLiteral');
    assert.equal(tmpl.expressions.length, 2);
    assert.equal(tmpl.quasis.length, 3);
});

test('parser: modifier server/client/shared', () => {
    const ast = parseOne('server fn handler() { }');
    assert.equal(ast.body[0].target, 'server');

    const cli = parseOne('client component App() { }');
    assert.equal(cli.body[0].target, 'client');
});

test('parser: await expression', () => {
    const ast = parseOne('async fn f() { let x = await g(); }');
    const expr = ast.body[0].body.body[0].declarations[0].init;
    assert.equal(expr.type, 'AwaitExpression');
});

test('parser: unary dan update expression', () => {
    const ast = parseOne('let a = -x; let b = !y; let c = z++; let d = ++w;');
    assert.equal(ast.body[0].declarations[0].init.type, 'UnaryExpression');
    assert.equal(ast.body[1].declarations[0].init.type, 'UnaryExpression');
    assert.equal(ast.body[2].declarations[0].init.type, 'UpdateExpression');
    assert.equal(ast.body[2].declarations[0].init.prefix, false);
    assert.equal(ast.body[3].declarations[0].init.prefix, true);
});

test('parser: assignment expression majemuk', () => {
    const ast = parseOne('x += 1; x ??= 2;');
    assert.equal(ast.body[0].expression.operator, '+=');
    assert.equal(ast.body[1].expression.operator, '??=');
});

test('parser: fixture smoke memuat seluruh fitur inti', () => {
    const source = fs.readFileSync(FIXTURE, 'utf8');
    const ast = parse(source, 'smoke.bng');
    const types = ast.body.map((s) => s.type);
    assert.ok(types.includes('ImportDeclaration'));
    assert.ok(types.includes('VarDeclaration'));
    assert.ok(types.includes('FunctionDeclaration'));
    assert.ok(types.includes('InterfaceDeclaration'));
    assert.ok(types.includes('ClassDeclaration'));
    assert.ok(types.includes('EnumDeclaration'));
    assert.ok(types.includes('TypeAlias'));
});

test('parser: error kompilasi menyertakan posisi file:baris:kolom', () => {
    try {
        parse('let = ;', 'bad.bng');
        assert.fail('harus melempar error');
    } catch (err) {
        assert.ok(err instanceof CompilerError);
        assert.equal(err.file, 'bad.bng');
        assert.ok(err.line > 0);
        assert.ok(err.column > 0);
    }
});
