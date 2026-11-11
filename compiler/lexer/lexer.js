'use strict';

const { KEYWORDS, OPERATORS, Position, Token } = require('./tokenizer');

/**
 * Error sintaks terpusat supaya semua tahap compiler melaporkan pesan
 * dengan format yang sama.
 */
class CompilerError extends Error {
    constructor(message, line, column, file) {
        super(message);
        this.name = 'CompilerError';
        this.line = line;
        this.column = column;
        this.file = file;
    }

    toString() {
        const where = this.file ? `${this.file}:${this.line}:${this.column}` : `${this.line}:${this.column}`;
        return `${where}: ${this.message}`;
    }
}

const ID_START = /[A-Za-z_$]/;
const ID_PART = /[A-Za-z0-9_$]/;

/**
 * Lexer Bonang.
 *
 * Mengubah source code menjadi daftar token. Lexer bersifat tanpa state
 * global sehingga aman dipakai ulang antar file.
 */
class Lexer {
    constructor(source, file = '<input>') {
        this.source = source;
        this.file = file;
        this.pos = 0;
        this.line = 1;
        this.column = 1;
        this.tokens = [];
    }

    error(message, pos = this.pos) {
        const { line, column } = this.locate(pos);
        throw new CompilerError(message, line, column, this.file);
    }

    locate(pos) {
        // Hitung baris/kolom dari awal file. O(n) tetapi hanya dijalankan saat error.
        let line = 1;
        let col = 1;
        for (let i = 0; i < pos && i < this.source.length; i++) {
            if (this.source[i] === '\n') {
                line++;
                col = 1;
            } else {
                col++;
            }
        }
        return { line, column: col };
    }

    peek(offset = 0) {
        return this.source[this.pos + offset];
    }

    advance() {
        const ch = this.source[this.pos++];
        if (ch === '\n') {
            this.line++;
            this.column = 1;
        } else {
            this.column++;
        }
        return ch;
    }

    match(str) {
        if (this.source.startsWith(str, this.pos)) {
            for (let i = 0; i < str.length; i++) this.advance();
            return true;
        }
        return false;
    }

    push(type, value, start, end) {
        this.tokens.push(new Token(type, value, start, end, this.file));
    }

    /**
     * Tokenize seluruh file lalu kembalikan array token (tanpa EOF).
     */
    tokenize() {
        while (this.pos < this.source.length) {
            this.skipTrivia();
            if (this.pos >= this.source.length) break;

            const startPos = this.pos;
            const start = new Position(this.line, this.column, startPos);
            const ch = this.peek();

            if (ID_START.test(ch)) {
                this.readIdentifier(start);
                continue;
            }
            if (ch >= '0' && ch <= '9') {
                this.readNumber(start);
                continue;
            }
            if (ch === '"' || ch === "'") {
                this.readString(start, ch);
                continue;
            }
            if (ch === '`') {
                this.readTemplate(start);
                continue;
            }

            if (!this.readOperator(start)) {
                this.error(`Karakter tidak dikenal: '${ch}'`, startPos);
            }
        }
        this.push('eof', '', new Position(this.line, this.column, this.pos), new Position(this.line, this.column, this.pos));
        return this.tokens;
    }

    skipTrivia() {
        while (this.pos < this.source.length) {
            const ch = this.source[this.pos];
            if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
                this.advance();
            } else if (ch === '/' && this.peek(1) === '/') {
                while (this.pos < this.source.length && this.peek() !== '\n') this.advance();
            } else if (ch === '/' && this.peek(1) === '*') {
                const start = this.pos;
                this.advance();
                this.advance();
                while (this.pos < this.source.length && !(this.peek() === '*' && this.peek(1) === '/')) {
                    this.advance();
                }
                if (this.pos >= this.source.length) {
                    this.error('Komentar blok tidak ditutup', start);
                }
                this.advance();
                this.advance();
            } else {
                return;
            }
        }
    }

    readIdentifier(start) {
        let value = '';
        while (this.pos < this.source.length && ID_PART.test(this.source[this.pos])) {
            value += this.advance();
        }
        const end = new Position(this.line, this.column, this.pos);
        const type = KEYWORDS.has(value) ? 'keyword' : 'identifier';
        this.push(type, value, start, end);
    }

    readNumber(start) {
        let raw = '';
        let isFloat = false;

        if (this.peek() === '0' && (this.peek(1) === 'x' || this.peek(1) === 'X')) {
            raw += this.advance();
            raw += this.advance();
            while (this.pos < this.source.length && /[0-9a-fA-F_]/.test(this.source[this.pos])) {
                raw += this.advance();
            }
            const end = new Position(this.line, this.column, this.pos);
            this.push('number', parseInt(raw.replace(/_/g, ''), 16), start, end);
            return;
        }

        while (this.pos < this.source.length && /[0-9_]/.test(this.source[this.pos])) {
            raw += this.advance();
        }
        if (this.peek() === '.' && /[0-9]/.test(this.peek(1) || '')) {
            isFloat = true;
            raw += this.advance();
            while (this.pos < this.source.length && /[0-9_]/.test(this.source[this.pos])) {
                raw += this.advance();
            }
        }
        if (this.peek() === 'e' || this.peek() === 'E') {
            const save = this.pos;
            let exp = this.advance();
            if (this.peek() === '+' || this.peek() === '-') exp += this.advance();
            if (/[0-9]/.test(this.peek() || '')) {
                isFloat = true;
                while (this.pos < this.source.length && /[0-9_]/.test(this.source[this.pos])) {
                    exp += this.advance();
                }
                raw += exp;
            } else {
                this.pos = save;
            }
        }

        const end = new Position(this.line, this.column, this.pos);
        const value = isFloat ? parseFloat(raw.replace(/_/g, '')) : parseInt(raw.replace(/_/g, ''), 10);
        this.push(isFloat ? 'float' : 'number', value, start, end);
    }

    readString(start, quote) {
        const isTemplate = quote === '`';
        this.advance(); // buka kutip
        let value = '';

        while (true) {
            if (this.pos >= this.source.length) {
                this.error('String tidak ditutup', start.offset);
            }
            const ch = this.peek();
            if (ch === quote) {
                this.advance();
                break;
            }
            if (ch === '\\') {
                this.advance();
                const esc = this.advance();
                switch (esc) {
                    case 'n': value += '\n'; break;
                    case 't': value += '\t'; break;
                    case 'r': value += '\r'; break;
                    case '\\': value += '\\'; break;
                    case '"': value += '"'; break;
                    case "'": value += "'"; break;
                    case '`': value += '`'; break;
                    case '0': value += '\0'; break;
                    case 'u': {
                        const hex = this.source.substr(this.pos, 4);
                        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
                            this.error('Escape unicode tidak valid');
                        }
                        value += String.fromCharCode(parseInt(hex, 16));
                        for (let i = 0; i < 4; i++) this.advance();
                        break;
                    }
                    default:
                        value += esc;
                }
                continue;
            }
            if (ch === '\n' && !isTemplate) {
                this.error('String tidak boleh mengandung baris baru', start.offset);
            }
            value += this.advance();
        }

        const end = new Position(this.line, this.column, this.pos);
        this.push('string', value, start, end);
    }

    /**
     * Template literal: `teks ${ekspresi} teks`.
     *
     * Bagian ekspresi tidak di-parse di lexer. Lexer hanya memisahkan
     * bagian teks dan source ekspresi, lalu parser mem-parse source
     * ekspresi secara rekursif.
     */
    readTemplate(start) {
        this.advance(); // buka backtick
        const parts = [];
        let current = '';

        while (true) {
            if (this.pos >= this.source.length) {
                this.error('Template literal tidak ditutup', start.offset);
            }
            const ch = this.peek();

            if (ch === '`') {
                this.advance();
                break;
            }

            if (ch === '\\') {
                this.advance();
                const esc = this.advance();
                switch (esc) {
                    case 'n': current += '\n'; break;
                    case 't': current += '\t'; break;
                    case 'r': current += '\r'; break;
                    case '\\': current += '\\'; break;
                    case '`': current += '`'; break;
                    case '$': current += '$'; break;
                    default: current += esc;
                }
                continue;
            }

            if (ch === '$' && this.peek(1) === '{') {
                parts.push({ type: 'quasi', value: current });
                current = '';
                this.advance(); // $
                this.advance(); // {
                const exprStart = this.pos;
                let depth = 1;
                while (this.pos < this.source.length && depth > 0) {
                    const c = this.peek();
                    if (c === '{') { depth++; this.advance(); continue; }
                    if (c === '}') {
                        depth--;
                        if (depth === 0) break;
                        this.advance();
                        continue;
                    }
                    if (c === '"' || c === "'" || c === '`') {
                        // Lewati string literal agar brace di dalamnya tidak dihitung.
                        const quote = c;
                        this.advance();
                        while (this.pos < this.source.length && this.peek() !== quote) {
                            if (this.peek() === '\\') this.advance();
                            this.advance();
                        }
                        this.advance();
                        continue;
                    }
                    this.advance();
                }
                if (depth !== 0) {
                    this.error('Ekspresi template literal tidak ditutup', exprStart);
                }
                const exprSource = this.source.slice(exprStart, this.pos);
                this.advance(); // }
                parts.push({ type: 'expr', value: exprSource });
                continue;
            }

            current += this.advance();
        }

        parts.push({ type: 'quasi', value: current });
        const end = new Position(this.line, this.column, this.pos);
        this.push('template', parts, start, end);
    }

    readOperator(start) {
        for (const op of OPERATORS) {
            if (this.source.startsWith(op, this.pos)) {
                for (let i = 0; i < op.length; i++) this.advance();
                const end = new Position(this.line, this.column, this.pos);
                this.push('operator', op, start, end);
                return true;
            }
        }
        return false;
    }
}

/**
 * Tokenize source code dan kembalikan daftar token.
 */
function tokenize(source, file = '<input>') {
    return new Lexer(source, file).tokenize();
}

module.exports = { Lexer, tokenize, CompilerError };
