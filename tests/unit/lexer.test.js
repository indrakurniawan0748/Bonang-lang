'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { tokenize, CompilerError } = require('../../compiler/lexer/lexer');

test('lexer: token dasar untuk deklarasi variabel', () => {
    const tokens = tokenize('let x = 10;', 'test.bng');
    assert.equal(tokens[0].type, 'keyword');
    assert.equal(tokens[0].value, 'let');
    assert.equal(tokens[1].type, 'identifier');
    assert.equal(tokens[1].value, 'x');
    assert.equal(tokens[2].type, 'operator');
    assert.equal(tokens[2].value, '=');
    assert.equal(tokens[3].type, 'number');
    assert.equal(tokens[3].value, 10);
    assert.equal(tokens.at(-1).type, 'eof');
});

test('lexer: operator majemuk tidak terpecah', () => {
    const tokens = tokenize('a === b', 'test.bng');
    const ops = tokens.filter((t) => t.type === 'operator').map((t) => t.value);
    assert.deepEqual(ops, ['===']);
});

test('lexer: operator `=>` dan `?.` dikenali utuh', () => {
    const tokens = tokenize('f => g?.h', 'test.bng');
    const ops = tokens.filter((t) => t.type === 'operator').map((t) => t.value);
    assert.deepEqual(ops, ['=>', '?.']);
});

test('lexer: integer, float, hex, dan underscore', () => {
    assert.equal(tokenize('42')[0].value, 42);
    assert.equal(tokenize('3.14')[0].value, 3.14);
    assert.equal(tokenize('0xFF')[0].value, 255);
    assert.equal(tokenize('1_000_000')[0].value, 1000000);
});

test('lexer: string dengan escape sequence', () => {
    assert.equal(tokenize('"a\\nb"')[0].value, 'a\nb');
    assert.equal(tokenize('"tab\\there"')[0].value, 'tab\there');
    assert.equal(tokenize('"\\u0041"')[0].value, 'A');
    assert.equal(tokenize('"quote\\"inside"')[0].value, 'quote"inside');
});

test('lexer: string tunggal dan backslash terakhir tidak diperluas', () => {
    assert.equal(tokenize("'single'")[0].value, 'single');
});

test('lexer: template literal dipisah menjadi quasi dan expr', () => {
    const tokens = tokenize('`Hello ${name}!`', 'test.bng');
    assert.equal(tokens[0].type, 'template');
    const parts = tokens[0].value;
    assert.equal(parts.length, 3);
    assert.equal(parts[0].type, 'quasi');
    assert.equal(parts[0].value, 'Hello ');
    assert.equal(parts[1].type, 'expr');
    assert.equal(parts[1].value, 'name');
    assert.equal(parts[2].value, '!');
});

test('lexer: template literal dengan brace di dalam ekspresi', () => {
    const tokens = tokenize('`${a + b}`', 'test.bng');
    const parts = tokens[0].value;
    assert.equal(parts[1].value, 'a + b');
});

test('lexer: komentar baris dan blok diabaikan', () => {
    const tokens = tokenize('// comment\n/* block\ncomment */ x', 'test.bng');
    assert.equal(tokens[0].type, 'identifier');
    assert.equal(tokens[0].value, 'x');
});

test('lexer: posisi baris dan kolom akurat', () => {
    const tokens = tokenize('let a = 1;\nlet b = 2;', 'test.bng');
    const b = tokens.find((t) => t.value === 'b');
    assert.equal(b.start.line, 2);
    assert.equal(b.start.column, 5);
});

test('lexer: error pada string tidak ditutup', () => {
    assert.throws(() => tokenize('"unclosed', 'test.bng'), CompilerError);
});

test('lexer: error pada karakter tidak dikenal', () => {
    assert.throws(() => tokenize('let x = #;', 'test.bng'), CompilerError);
});

test('lexer: error pada komentar blok tidak ditutup', () => {
    assert.throws(() => tokenize('/* unclosed', 'test.bng'), CompilerError);
});

test('lexer: kata kunci server/client/shared dikenali', () => {
    const tokens = tokenize('server fn handler() {}', 'test.bng');
    assert.equal(tokens[0].type, 'keyword');
    assert.equal(tokens[0].value, 'server');
});
