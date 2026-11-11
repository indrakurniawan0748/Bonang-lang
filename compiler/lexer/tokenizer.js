'use strict';

/**
 * Definisi token untuk bahasa Bonang.
 *
 * Token type sengaja dipisah dari nilai literal agar lexer bisa diuji
 * tanpa harus paham bentuk AST.
 */

const KEYWORDS = new Set([
    // deklarasi
    'let', 'const', 'var', 'fn', 'class', 'interface', 'enum', 'type',
    'namespace', 'module',
    // `function` adalah alias resmi dari `fn`
    'function',
    // kontrol alur
    'if', 'else', 'while', 'for', 'in', 'of', 'return', 'break', 'continue',
    'switch', 'case', 'default', 'try', 'catch', 'finally', 'throw',
    // async
    'async', 'await',
    // OOP
    'new', 'this', 'super', 'static', 'get', 'set',
    // operator unary khusus
    'typeof',
    'public', 'private', 'protected', 'abstract', 'override', 'readonly',
    'implements',
    'extends', 'instanceof',
    // modul
    'import', 'export', 'from', 'as', 'default',
    // domain / fullstack
    'server', 'client', 'shared',
    // literal
    'true', 'false', 'null', 'undefined',
    // tipe dasar
    'int', 'float', 'string', 'bool', 'any', 'void', 'never', 'object'
]);

// Urutan operator wajib dari yang terpanjang agar `===` tidak terpecah jadi `==` + `=`.
const OPERATORS = [
    '>>>=',
    '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
    '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '+=', '-=', '*=',
    '/=', '%=', '&=', '|=', '^=', '**', '++', '--', '<<', '>>',
    '+', '-', '*', '/', '%', '=', '<', '>', '!', '?', ':', '.', ',', ';',
    '(', ')', '[', ']', '{', '}', '&', '|', '^', '~', '@'
];

const PUNCTUATORS = new Set([
    '(', ')', '[', ']', '{', '}', ',', ';', ':', '.', '?', '@'
]);

/** Lokasi token dalam source file, 1-indexed baris & kolom. */
class Position {
    constructor(line, column, offset) {
        this.line = line;
        this.column = column;
        this.offset = offset;
    }

    toString() {
        return `${this.line}:${this.column}`;
    }
}

class Token {
    /**
     * @param {string} type
     * @param {string} value
     * @param {Position} start
     * @param {Position} end
     * @param {string|null} file
     */
    constructor(type, value, start, end, file) {
        this.type = type;
        this.value = value;
        this.start = start;
        this.end = end;
        this.file = file;
    }

    toString() {
        return `Token(${this.type}, ${JSON.stringify(this.value)}, ${this.start})`;
    }
}

module.exports = { KEYWORDS, OPERATORS, PUNCTUATORS, Position, Token };
