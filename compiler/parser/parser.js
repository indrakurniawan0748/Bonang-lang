'use strict';

const { tokenize, CompilerError } = require('../lexer/lexer');
const A = require('../ast/nodes');

/**
 * Binary operator precedence. Higher number = lebih rapat (mengikat lebih kuat).
 * Tabel disusun manual agar mudah dibaca dan dipelihara, bukan hasil generator.
 */
const BINARY_PRECEDENCE = {
    '??': 1,
    '||': 2,
    '&&': 3,
    '|': 4,
    '^': 5,
    '&': 6,
    '==': 7, '!=': 7, '===': 7, '!==': 7,
    '<': 8, '>': 8, '<=': 8, '>=': 8, 'instanceof': 8, 'in': 8,
    '<<': 9, '>>': 9, '>>>': 9,
    '+': 10, '-': 10,
    '*': 11, '/': 11, '%': 11,
    '**': 12
};

const LOGICAL_OPERATORS = new Set(['&&', '||', '??']);
const ASSIGN_OPERATORS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '&=', '|=', '^=', '<<=', '>>=', '>>>=', '&&=', '||=', '??=']);

/**
 * Parser Bonang.
 *
 * Menggunakan teknik Pratt parsing untuk ekspresi: setiap operator punya
 * precedence, parser memilih berikutnya berdasarkan token yang datang.
 */
class Parser {
    constructor(source, file = '<input>') {
        this.tokens = tokenize(source, file);
        this.index = 0;
        this.file = file;
    }

    // ===== TOKEN HELPERS =====

    peek(offset = 0) {
        return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)];
    }

    get current() {
        return this.tokens[this.index];
    }

    next() {
        const tok = this.tokens[this.index];
        if (this.index < this.tokens.length - 1) this.index++;
        return tok;
    }

    check(type, value) {
        const tok = this.current;
        if (tok.type !== type) return false;
        return value === undefined ? true : tok.value === value;
    }

    checkKeyword(value) {
        return this.current.type === 'keyword' && this.current.value === value;
    }

    match(type, value) {
        if (this.check(type, value)) {
            this.next();
            return true;
        }
        return false;
    }

    matchKeyword(value) {
        if (this.checkKeyword(value)) {
            this.next();
            return true;
        }
        return false;
    }

    expect(type, value) {
        if (this.check(type, value)) return this.next();
        const got = this.current.type === 'eof' ? 'EOF' : `'${this.current.value}'`;
        this.error(`Diharapkan '${value}' tetapi ditemukan ${got}`);
    }

    expectIdentifier() {
        // Nama variabel Bonang boleh berupa keyword bahasa (mis. `class`),
        // selama keyword itu tidak dibutuhkan sebagai pemanggilan dalam
        // konteks ekspresi. Kata kunci struktural tetap dilarang.
        if (this.current.type === 'identifier' || (this.current.type === 'keyword' && !STRUCTURAL_KEYWORDS.has(this.current.value))) {
            return this.next().value;
        }
        this.error(`Dumplah identifier, ditemukan '${this.current.value}'`);
    }

    /**
     * Nama properti member expression (`obj.nama`).
     *
     * Di sini konteksnya jelas posisi properti, sehingga keyword apa pun
     * boleh menjadi nama properti — termasuk `default`, `new`, atau `type`.
     * Kode yang dihasilkan tetap menggunakan sintaks titik, sehingga
     * kata kunci yang tidak valid sebagai identifier JavaScript harus
     * ditulis sebagai `obj["nama"]`.
     */
    expectMemberName() {
        if (this.current.type === 'identifier' || this.current.type === 'keyword') {
            return this.next().value;
        }
        this.error(`Dumplah nama properti, ditemukan '${this.current.value}'`);
    }

    /** Nama identifier untuk binding (nilai `as` dan `from` diperbolehkan). */
    expectBindingIdentifier() {
        if (this.current.type === 'identifier' || (this.current.type === 'keyword' && ['as', 'from'].includes(this.current.value))) {
            return this.next().value;
        }
        this.error(`Dumplah identifier, ditemukan '${this.current.value}'`);
    }

    error(message, token = this.current) {
        throw new CompilerError(message, token.start.line, token.start.column, this.file);
    }

    // ===== ENTRY POINT =====

    parseProgram() {
        const body = [];
        while (!this.check('eof')) {
            body.push(this.parseStatement());
        }
        return new A.Program(body, 1, 1);
    }

    // ===== STATEMENTS =====

    parseStatement() {
        const tok = this.current;

        // Modifier fullstack: server / client / shared
        if (tok.type === 'keyword' && ['server', 'client', 'shared'].includes(tok.value)) {
            return this.parseModifiedDeclaration();
        }

        if (tok.type === 'keyword') {
            switch (tok.value) {
                case 'let':
                case 'const':
                case 'var':
                    return this.parseVarDeclaration();
                case 'fn':
                    return this.parseFunctionDeclaration();
                case 'function':
                    // `function` adalah alias resmi dari `fn` — dipakai agar
                    // kode yang bermula dari JavaScript mudah dipindahkan.
                    return this.parseFunctionDeclaration();
                case 'async':
                    if (this.peek(1).type === 'keyword' && (this.peek(1).value === 'fn' || this.peek(1).value === 'function')) {
                        return this.parseFunctionDeclaration(true);
                    }
                    break;
                case 'class':
                    return this.parseClassDeclaration();
                case 'abstract': {
                    // `abstract class X` — modifier kelas.
                    const absTok = this.next();
                    const cls = this.parseClassDeclaration();
                    cls.modifiers.push('abstract');
                    cls.line = absTok.start.line;
                    cls.column = absTok.start.column;
                    return cls;
                }
                case 'interface':
                    return this.parseInterfaceDeclaration();
                case 'enum':
                    return this.parseEnumDeclaration();
                case 'type':
                    return this.parseTypeAlias();
                case 'namespace':
                    return this.parseNamespaceDeclaration();
                case 'import':
                    // `import("...")` adalah ekspresi dynamic import, bukan
                    // deklarasi import. Keduanya berbagi keyword yang sama,
                    // jadi dibedakan lewat token berikutnya.
                    if (this.peek(1).type === 'operator' && this.peek(1).value === '(') {
                        const expression = this.parseExpression();
                        this.match('operator', ';');
                        return new A.ExpressionStatement(expression, tok.start.line, tok.start.column);
                    }
                    return this.parseImportDeclaration();
                case 'export':
                    return this.parseExportDeclaration();
                case 'return': {
                    this.next();
                    const argument = this.check('operator', ';') || this.check('eof') ? null : this.parseExpression();
                    this.match('operator', ';');
                    return new A.ReturnStatement(argument, tok.start.line, tok.start.column);
                }
                case 'break': {
                    this.next();
                    const label = this.current.type === 'identifier' ? this.next().value : null;
                    this.match('operator', ';');
                    return new A.BreakStatement(label, tok.start.line, tok.start.column);
                }
                case 'continue': {
                    this.next();
                    const label = this.current.type === 'identifier' ? this.next().value : null;
                    this.match('operator', ';');
                    return new A.ContinueStatement(label, tok.start.line, tok.start.column);
                }
                case 'if':
                    return this.parseIf();
                case 'while':
                    return this.parseWhile();
                case 'for':
                    return this.parseFor();
                case 'switch':
                    return this.parseSwitch();
                case 'try':
                    return this.parseTry();
                case 'throw': {
                    this.next();
                    const argument = this.parseExpression();
                    this.match('operator', ';');
                    return new A.ThrowStatement(argument, tok.start.line, tok.start.column);
                }
            }
        }

        if (tok.type === 'operator' && tok.value === '{') {
            return this.parseBlock();
        }

        if (tok.type === 'operator' && tok.value === ';') {
            this.next();
            return new A.BlockStatement([], tok.start.line, tok.start.column);
        }

        const expression = this.parseExpression();
        this.match('operator', ';');
        return new A.ExpressionStatement(expression, tok.start.line, tok.start.column);
    }

    /**
     * Deklarasi bertanda fullstack, misal `server fn handler()`.
     * Modifier disimpan pada node sebagai `target`.
     */
    parseModifiedDeclaration() {
        const tok = this.current;
        const target = this.next().value; // server | client | shared
        const decl = this.parseStatement();
        decl.target = target;
        return decl;
    }

    parseVarDeclaration() {
        const tok = this.next(); // let/const/var
        const declarations = [];
        do {
            const name = this.expectIdentifier();
            const typeAnnotation = this.parseOptionalTypeAnnotation();
            let init = null;
            if (this.match('operator', '=')) {
                init = this.parseExpression();
            }
            declarations.push({ id: name, init, typeAnnotation });
        } while (this.match('operator', ','));
        this.match('operator', ';');
        return new A.VarDeclaration(tok.value, declarations, tok.start.line, tok.start.column);
    }

    parseFunctionDeclaration(isAsync = false) {
        const tok = this.current;
        if (isAsync) this.next(); // 'async'
        // `fn` dan `function` sama-sama diterima.
        if (this.current.type === 'keyword' && (this.current.value === 'fn' || this.current.value === 'function')) {
            this.next();
        } else {
            this.expect('keyword', 'fn');
        }
        const name = this.expectIdentifier();
        const params = this.parseParams();
        const returnType = this.parseOptionalTypeAnnotation();
        const body = this.parseBlock();
        const fn = new A.FunctionDeclaration(name, params, body, isAsync, [], tok.start.line, tok.start.column);
        fn.returnType = returnType;
        return fn;
    }

    parseParams() {
        this.expect('operator', '(');
        const params = [];
        while (!this.check('operator', ')')) {
            const modifiers = this.parseModifiers();
            let name;
            let isRest = false;
            if (this.match('operator', '...')) isRest = true;
            name = this.expectIdentifier();
            const typeAnnotation = this.parseOptionalTypeAnnotation();
            let defaultValue = null;
            if (this.match('operator', '=')) {
                defaultValue = this.parseExpression();
            }
            params.push({ id: name, typeAnnotation, defaultValue, modifiers, isRest });
            if (!this.match('operator', ',')) break;
        }
        this.expect('operator', ')');
        return params;
    }

    parseModifiers() {
        const modifiers = [];
        while (this.current.type === 'keyword' && ['public', 'private', 'protected', 'static', 'readonly', 'abstract', 'override', 'async'].includes(this.current.value)) {
            modifiers.push(this.next().value);
        }
        return modifiers;
    }

    /**
     * Type annotation opsional: `: int`, `: string?`, `: Array<int>`, `: Product`.
     */
    parseOptionalTypeAnnotation() {
        if (!this.check('operator', ':')) return null;
        this.next();
        return this.parseTypeNode();
    }

    parseTypeNode() {
        const tok = this.current;
        let base;
        if (tok.type === 'keyword' && ['int', 'float', 'string', 'bool', 'any', 'void', 'never', 'object'].includes(tok.value)) {
            base = { kind: 'primitive', name: this.next().value };
        } else if (tok.type === 'identifier') {
            base = { kind: 'named', name: this.next().value };
        } else if (this.check('operator', '[')) {
            this.next();
            this.expect('operator', ']');
            base = { kind: 'array', element: { kind: 'any' } };
        } else {
            this.error('Ekspresi tipe tidak valid');
        }

        // Generic: Array<int>, Map<string, int>
        if (base.kind === 'named' && this.check('operator', '<')) {
            this.next();
            const args = [];
            while (!this.check('operator', '>')) {
                args.push(this.parseTypeNode());
                if (!this.match('operator', ',')) break;
            }
            this.expect('operator', '>');
            base = { kind: 'generic', name: base.name, args };
        }

        // Nullable suffix
        if (this.match('operator', '?')) {
            base = { kind: 'union', options: [base, { kind: 'null' }] };
        }

        // Array suffix: int[]
        if (this.check('operator', '[') && this.peek(1).value === ']') {
            this.next();
            this.next();
            base = { kind: 'array', element: base };
        }

        // Union: int | string
        while (this.check('operator', '|')) {
            this.next();
            const right = this.parseTypeNode();
            base = { kind: 'union', options: [base, right] };
        }

        return { node: base, line: tok.start.line, column: tok.start.column };
    }

    parseClassDeclaration() {
        const tok = this.next(); // class
        const name = this.expectIdentifier();
        let superClass = null;
        if (this.matchKeyword('extends')) {
            superClass = { kind: 'named', name: this.expectIdentifier() };
        }
        if (this.match('operator', ':')) {
            superClass = this.parseTypeNode().node;
        }
        const implementsList = [];
        if (this.matchKeyword('implements')) {
            do {
                implementsList.push(this.expectIdentifier());
            } while (this.match('operator', ','));
        }
        this.expect('operator', '{');
        const members = [];
        while (!this.check('operator', '}')) {
            if (this.check('eof')) this.error('Class tidak ditutup');
            members.push(this.parseClassMember());
        }
        this.expect('operator', '}');
        return new A.ClassDeclaration(name, superClass, implementsList, members, [], tok.start.line, tok.start.column);
    }

    parseClassMember() {
        const tok = this.current;
        const modifiers = this.parseModifiers();

        // Getter / setter — `get nama()` dan `set nama(v)`.
        //
        // Keyword `get`/`set` juga boleh menjadi nama method biasa
        // (`get(id) { ... }`). Perbedaan dibedakan lewat bentuk
        // parameternya: getter tidak boleh punya parameter, sedangkan
        // method bernama `get` boleh.
        if (this.current.type === 'keyword' && (this.current.value === 'get' || this.current.value === 'set')) {
            const keyword = this.current.value;
            const afterKeyword = this.peek(1);
            const afterName = this.peek(2);

            const looksLikeAccessor =
                afterKeyword.type === 'identifier'
                && afterName.type === 'operator' && afterName.value === '('
                // Getter: `get nama()` — tanpa parameter setelah tanda kurung.
                && (keyword === 'get'
                    ? (this.peek(3).type === 'operator' && this.peek(3).value === ')')
                    : true);

            if (looksLikeAccessor) {
                const kind = this.next().value;
                const name = this.expectMemberName();
                const params = this.parseParams();
                const returnType = this.parseOptionalTypeAnnotation();
                const body = this.parseBlock();
                const member = {
                    kind: kind === 'get' ? 'getter' : 'setter',
                    name, params, body, modifiers,
                    returnType,
                    line: tok.start.line, column: tok.start.column
                };
                return member;
            }
        }

        // Constructor — `constructor` bukan keyword bahasa, jadi dicek sebagai identifier.
        if (this.current.type === 'identifier' && this.current.value === 'constructor') {
            this.next();
            const params = this.parseParams();
            const body = this.parseBlock();
            return {
                kind: 'constructor', name: 'constructor', params, body, modifiers,
                line: tok.start.line, column: tok.start.column
            };
        }

        // Method — boleh ditulis `fn nama()` maupun `nama()`.
        const hasFnKeyword = this.current.type === 'keyword' && this.current.value === 'fn';
        if (hasFnKeyword) this.next();

        // Nama method boleh berupa keyword bahasa (mis. `get`, `delete`)
        // karena konteksnya sudah pasti posisi nama method. Yang menentukan
        // method adalah adanya tanda kurung buka setelah nama.
        const isMethod = this.peek(1).type === 'operator' && this.peek(1).value === '(';
        if (hasFnKeyword || isMethod) {
            const name = this.expectMemberName();
            const params = this.parseParams();
            const returnType = this.parseOptionalTypeAnnotation();
            const body = this.parseBlock();
            return {
                kind: 'method', name, params, body, modifiers, returnType,
                line: tok.start.line, column: tok.start.column
            };
        }

        // Property
        const name = this.expectIdentifier();
        let typeAnnotation = null;
        if (this.check('operator', ':')) {
            this.next();
            typeAnnotation = this.parseTypeNode();
        }
        let value = null;
        if (this.match('operator', '=')) {
            value = this.parseExpression();
        }
        this.match('operator', ';');
        return {
            kind: 'property', name, typeAnnotation, value, modifiers,
            line: tok.start.line, column: tok.start.column
        };
    }

    parseInterfaceDeclaration() {
        const tok = this.next(); // interface
        const name = this.expectIdentifier();
        const extendsList = [];
        if (this.match('operator', ':')) {
            do {
                extendsList.push(this.expectIdentifier());
            } while (this.match('operator', ','));
        }
        this.expect('operator', '{');
        const members = [];
        while (!this.check('operator', '}')) {
            if (this.check('eof')) this.error('Interface tidak ditutup');
            const mTok = this.current;
            const memberName = this.expectIdentifier();
            const params = this.parseParams();
            const returnType = this.parseOptionalTypeAnnotation();
            this.match('operator', ';');
            members.push({
                kind: 'method', name: memberName, params, returnType, modifiers: [],
                line: mTok.start.line, column: mTok.start.column
            });
        }
        this.expect('operator', '}');
        return new A.InterfaceDeclaration(name, extendsList, members, tok.start.line, tok.start.column);
    }

    parseEnumDeclaration() {
        const tok = this.next(); // enum
        const name = this.expectIdentifier();
        this.expect('operator', '{');
        const members = [];
        let autoValue = 0;
        while (!this.check('operator', '}')) {
            if (this.check('eof')) this.error('Enum tidak ditutup');
            const memberName = this.expectIdentifier();
            let value = null;
            if (this.match('operator', '=')) {
                const num = this.current;
                if (num.type === 'number' || num.type === 'float') {
                    value = this.next().value;
                } else if (num.type === 'string') {
                    value = this.next().value;
                } else {
                    value = this.parseExpression();
                }
            }
            if (value === null) value = autoValue;
            autoValue = typeof value === 'number' ? value + 1 : autoValue;
            members.push({ name: memberName, value });
            if (!this.match('operator', ',')) break;
        }
        this.expect('operator', '}');
        return new A.EnumDeclaration(name, members, tok.start.line, tok.start.column);
    }

    parseTypeAlias() {
        const tok = this.next(); // type
        const name = this.expectIdentifier();
        this.expect('operator', '=');
        const typeAnnotation = this.parseTypeNode();
        this.match('operator', ';');
        return new A.TypeAlias(name, typeAnnotation, tok.start.line, tok.start.column);
    }

    parseNamespaceDeclaration() {
        const tok = this.next(); // namespace
        const name = this.expectIdentifier();
        this.expect('operator', '{');
        const body = [];
        while (!this.check('operator', '}')) {
            if (this.check('eof')) this.error('Namespace tidak ditutup');
            body.push(this.parseStatement());
        }
        this.expect('operator', '}');
        return new A.NamespaceDeclaration(name, body, tok.start.line, tok.start.column);
    }

    parseImportDeclaration() {
        const tok = this.next(); // import
        const specifiers = [];
        if (this.current.type === 'string') {
            // import "modul"
            const source = this.next().value;
            this.match('operator', ';');
            return new A.ImportDeclaration([], source, tok.start.line, tok.start.column);
        }
        if (this.match('operator', '*')) {
            // `import * as ns from "..."` — `as` wajib ada, nama binding sesudahnya.
            this.expectKeyword('as');
            const local = this.expectIdentifier();
            specifiers.push({ imported: '*', local });
        } else {
            this.expect('operator', '{');
            while (!this.check('operator', '}')) {
                const imported = this.expectIdentifier();
                let local = imported;
                if (this.matchKeyword('as')) {
                    local = this.expectBindingIdentifier();
                }
                specifiers.push({ imported, local });
                if (!this.match('operator', ',')) break;
            }
            this.expect('operator', '}');
        }
        this.matchKeyword('from');
        const source = this.current.type === 'string' ? this.next().value : this.error('Ekspektasi string path modul');
        this.match('operator', ';');
        return new A.ImportDeclaration(specifiers, source, tok.start.line, tok.start.column);
    }

    parseExportDeclaration() {
        const tok = this.next(); // export

        // `export { a, b as c }` — daftar ekspor nama yang sudah ada.
        if (this.check('operator', '{')) {
            this.next();
            const specifiers = [];
            while (!this.check('operator', '}')) {
                if (this.check('eof')) this.error('Daftar export tidak ditutup');
                const local = this.expectIdentifier();
                let exported = local;
                if (this.matchKeyword('as')) {
                    exported = this.expectIdentifier();
                }
                specifiers.push({ local, exported });
                if (!this.match('operator', ',')) break;
            }
            this.expect('operator', '}');
            this.match('operator', ';');
            return new A.ExportDeclaration(null, specifiers, null, tok.start.line, tok.start.column);
        }

        const declaration = this.parseStatement();
        return new A.ExportDeclaration(declaration, [], null, tok.start.line, tok.start.column);
    }

    parseBlock() {
        const tok = this.current;
        this.expect('operator', '{');
        const body = [];
        while (!this.check('operator', '}')) {
            if (this.check('eof')) this.error('Blok tidak ditutup');
            body.push(this.parseStatement());
        }
        this.expect('operator', '}');
        return new A.BlockStatement(body, tok.start.line, tok.start.column);
    }

    parseIf() {
        const tok = this.next(); // if
        this.expect('operator', '(');
        const test = this.parseExpression();
        this.expect('operator', ')');
        const consequent = this.parseStatement();
        let alternate = null;
        if (this.matchKeyword('else')) {
            alternate = this.parseStatement();
        }
        return new A.IfStatement(test, consequent, alternate, tok.start.line, tok.start.column);
    }

    parseWhile() {
        const tok = this.next(); // while
        this.expect('operator', '(');
        const test = this.parseExpression();
        this.expect('operator', ')');
        const body = this.parseStatement();
        return new A.WhileStatement(test, body, tok.start.line, tok.start.column);
    }

    parseFor() {
        const tok = this.next(); // for
        this.expect('operator', '(');

        // for (const x of list) / for (const x in obj)
        // Hanya dianggap for-in bila setelah nama variabel langsung muncul
        // `of`/`in` — bukan `=`.
        if (this.current.type === 'keyword' && ['let', 'const', 'var'].includes(this.current.value) &&
            this.peek(1).type === 'identifier' &&
            this.peek(2).type === 'keyword' && ['of', 'in'].includes(this.peek(2).value)) {
            const kind = this.next().value;
            const left = this.expectIdentifier();
            const isOf = this.current.value === 'of';
            this.next();
            const right = this.parseExpression();
            this.expect('operator', ')');
            const body = this.parseStatement();
            return new A.ForInStatement(kind, left, right, body, isOf, tok.start.line, tok.start.column);
        }

        // for (init; test; update)
        let init = null;
        if (!this.check('operator', ';')) {
            if (this.current.type === 'keyword' && ['let', 'const', 'var'].includes(this.current.value)) {
                init = this.parseVarDeclaration();
            } else {
                init = new A.ExpressionStatement(this.parseExpression(), tok.start.line, tok.start.column);
                this.match('operator', ';');
            }
        } else {
            this.next();
        }

        let test = null;
        if (!this.check('operator', ';')) test = this.parseExpression();
        this.expect('operator', ';');

        let update = null;
        if (!this.check('operator', ')')) update = this.parseExpression();
        this.expect('operator', ')');

        const body = this.parseStatement();
        return new A.ForStatement(init, test, update, body, tok.start.line, tok.start.column);
    }

    parseSwitch() {
        const tok = this.next(); // switch
        this.expect('operator', '(');
        const discriminant = this.parseExpression();
        this.expect('operator', ')');
        this.expect('operator', '{');
        const cases = [];
        while (!this.check('operator', '}')) {
            if (this.check('eof')) this.error('Switch tidak ditutup');
            if (this.matchKeyword('case')) {
                const test = this.parseExpression();
                this.expect('operator', ':');
                const consequent = [];
                while (!this.check('keyword', 'case') && !this.check('keyword', 'default') && !this.check('operator', '}')) {
                    consequent.push(this.parseStatement());
                }
                cases.push({ test, consequent });
            } else if (this.matchKeyword('default')) {
                this.expect('operator', ':');
                const consequent = [];
                while (!this.check('keyword', 'case') && !this.check('keyword', 'default') && !this.check('operator', '}')) {
                    consequent.push(this.parseStatement());
                }
                cases.push({ test: null, consequent });
            } else {
                this.error('Diharapkan `case` atau `default` di dalam switch');
            }
        }
        this.expect('operator', '}');
        return new A.SwitchStatement(discriminant, cases, tok.start.line, tok.start.column);
    }

    parseTry() {
        const tok = this.next(); // try
        const block = this.parseBlock();
        let handler = null;
        let finalizer = null;
        if (this.matchKeyword('catch')) {
            let param = null;
            if (this.match('operator', '(')) {
                const paramName = this.expectIdentifier();
                const typeAnnotation = this.parseOptionalTypeAnnotation();
                param = { id: paramName, typeAnnotation };
                this.expect('operator', ')');
            }
            const body = this.parseBlock();
            handler = new A.CatchClause(param, body, tok.start.line, tok.start.column);
        }
        if (this.matchKeyword('finally')) {
            finalizer = this.parseBlock();
        }
        if (!handler && !finalizer) {
            this.error('`try` harus diikuti `catch` atau `finally`');
        }
        return new A.TryStatement(block, handler, finalizer, tok.start.line, tok.start.column);
    }

    expectKeyword(value) {
        if (this.checkKeyword(value)) return this.next();
        this.error(`Diharapkan keyword '${value}'`);
    }

    // ===== EXPRESSIONS (Pratt) =====

    parseExpression() {
        return this.parseAssignment();
    }

    parseAssignment() {
        const left = this.parseConditional();
        const tok = this.current;
        if (tok.type === 'operator' && ASSIGN_OPERATORS.has(tok.value)) {
            this.next();
            const right = this.parseAssignment();
            return new A.AssignmentExpression(tok.value, left, right, tok.start.line, tok.start.column);
        }
        return left;
    }

    parseConditional() {
        const test = this.parseBinary(0);
        if (this.check('operator', '?')) {
            const tok = this.next();
            const consequent = this.parseAssignment();
            this.expect('operator', ':');
            const alternate = this.parseAssignment();
            return new A.ConditionalExpression(test, consequent, alternate, tok.start.line, tok.start.column);
        }
        return test;
    }

    parseBinary(minPrecedence) {
        let left = this.parseUnary();

        while (true) {
            const tok = this.current;
            let op = null;
            if (tok.type === 'operator' && BINARY_PRECEDENCE[tok.value] !== undefined) {
                op = tok.value;
            } else if (tok.type === 'keyword' && (tok.value === 'instanceof' || tok.value === 'in')) {
                op = tok.value;
            }
            if (op === null) break;

            const precedence = BINARY_PRECEDENCE[op];
            if (precedence < minPrecedence) break;

            this.next();
            // ** right-associative
            const right = this.parseBinary(op === '**' ? precedence : precedence + 1);
            const NodeClass = LOGICAL_OPERATORS.has(op) ? A.LogicalExpression : A.BinaryExpression;
            left = new NodeClass(op, left, right, tok.start.line, tok.start.column);
        }

        return left;
    }

    parseUnary() {
        const tok = this.current;

        if (tok.type === 'operator' && ['!', '-', '+', '~'].includes(tok.value)) {
            this.next();
            const argument = this.parseUnary();
            return new A.UnaryExpression(tok.value, argument, tok.start.line, tok.start.column);
        }

        if (tok.type === 'keyword' && tok.value === 'typeof') {
            this.next();
            const argument = this.parseUnary();
            return new A.UnaryExpression('typeof', argument, tok.start.line, tok.start.column);
        }

        // `void` dipakai untuk menandai_effect yang sengaja diabaikan,
        // mis. `void flushQueue();` — hasil promise dibuang agar tidak
        // menjadi unhandled rejection.
        if (tok.type === 'keyword' && tok.value === 'void') {
            this.next();
            const argument = this.parseUnary();
            return new A.UnaryExpression('void', argument, tok.start.line, tok.start.column);
        }

        if (tok.type === 'keyword' && tok.value === 'await') {
            this.next();
            const argument = this.parseUnary();
            return new A.AwaitExpression(argument, tok.start.line, tok.start.column);
        }

        if (tok.type === 'operator' && (tok.value === '++' || tok.value === '--')) {
            this.next();
            const argument = this.parseUnary();
            return new A.UpdateExpression(tok.value, argument, true, tok.start.line, tok.start.column);
        }

        let expr = this.parsePostfix();

        // Prefix increment setelah ekspresi-base, mis. `x++` ditangani di parsePostfix.
        return expr;
    }

    parsePostfix() {
        let expr = this.parseCallMember();
        const tok = this.current;
        if (tok.type === 'operator' && (tok.value === '++' || tok.value === '--') && !this.newlineBefore()) {
            this.next();
            expr = new A.UpdateExpression(tok.value, expr, false, tok.start.line, tok.start.column);
        }
        return expr;
    }

    newlineBefore() {
        // Token baru menyimpan posisi offset; baris berbeda berarti statement selesai.
        return false;
    }

    parseCallMember() {
        let expr = this.parsePrimary();

        // Arrow function satu parameter tanpa kurung: `x => x + 1`.
        if (expr.type === 'Identifier' && this.check('operator', '=>')) {
            const tok = this.next();
            const params = [{ id: expr.name, typeAnnotation: null, defaultValue: null, modifiers: [], isRest: false }];
            return this.parseArrowBody(params, false, tok);
        }

        while (true) {
            const tok = this.current;

            if (this.check('operator', '.')) {
                this.next();
                const property = this.expectMemberName();
                expr = new A.MemberExpression(expr, { name: property }, false, false, tok.start.line, tok.start.column);
                continue;
            }

            if (this.check('operator', '?.')) {
                this.next();
                if (this.check('operator', '(')) {
                    const args = this.parseArguments();
                    expr = new A.CallExpression(expr, args, true, tok.start.line, tok.start.column);
                } else if (this.check('operator', '[')) {
                    this.next();
                    const property = this.parseExpression();
                    this.expect('operator', ']');
                    expr = new A.MemberExpression(expr, property, true, true, tok.start.line, tok.start.column);
                } else {
                    const property = this.expectMemberName();
                    expr = new A.MemberExpression(expr, { name: property }, false, true, tok.start.line, tok.start.column);
                }
                continue;
            }

            if (this.check('operator', '[')) {
                this.next();
                const property = this.parseExpression();
                this.expect('operator', ']');
                expr = new A.MemberExpression(expr, property, true, false, tok.start.line, tok.start.column);
                continue;
            }

            if (this.check('operator', '(')) {
                const args = this.parseArguments();
                expr = new A.CallExpression(expr, args, false, tok.start.line, tok.start.column);
                continue;
            }

            if (tok.type === 'operator' && tok.value === '!') {
                // `foo!` — non-null assertion
                this.next();
                expr = new A.UnaryExpression('!', expr, tok.start.line, tok.start.column);
                continue;
            }

            break;
        }

        return expr;
    }

    parseArguments() {
        this.expect('operator', '(');
        const args = [];
        while (!this.check('operator', ')')) {
            if (this.check('eof')) this.error('Argumen tidak ditutup');
            if (this.match('operator', '...')) {
                const tok = this.current;
                args.push(new A.SpreadElement(this.parseExpression(), tok.start.line, tok.start.column));
            } else {
                args.push(this.parseExpression());
            }
            if (!this.match('operator', ',')) break;
        }
        this.expect('operator', ')');
        return args;
    }

    /**
     * Coba parse `(params) =>` secara spekulatif.
     *
     * Mengembalikan ArrowFunctionExpression bila token `=>` mengikuti daftar
     * parameter, atau `null` bila ini ternyata parenthesized expression.
     * Pemanggil responsible untuk mengembalikan index token bila gagal.
     */
    tryParseArrowParams() {
        const startTok = this.current;
        try {
            this.next(); // '('
            const params = [];
            while (!this.check('operator', ')')) {
                if (this.check('eof')) return null;
                let isRest = false;
                if (this.match('operator', '...')) isRest = true;
                if (!this.check('identifier')) return null;
                const name = this.next().value;
                const typeAnnotation = this.parseOptionalTypeAnnotation();
                let defaultValue = null;
                if (this.match('operator', '=')) defaultValue = this.parseExpression();
                params.push({ id: name, typeAnnotation, defaultValue, modifiers: [], isRest });
                if (!this.match('operator', ',')) break;
            }
            if (!this.check('operator', ')')) return null;
            this.next(); // ')'
            this.parseOptionalTypeAnnotation();
            if (!this.check('operator', '=>')) return null;
            this.next(); // '=>'
            return this.parseArrowBody(params, false, startTok);
        } catch (err) {
            if (err instanceof CompilerError) return null;
            throw err;
        }
    }

    /**
     * Arrow function: `(a, b) => expr`, `() => { ... }`, `async (a) => { ... }`.
     */
    parseArrow(isAsync) {
        const tok = this.current;

        // Param tunggal tanpa kurung: `x => ...`
        if (tok.type === 'identifier' && this.peek(1).value === '=>') {
            const name = this.next().value;
            const arrowTok = this.next();
            const params = [{ id: name, typeAnnotation: null, defaultValue: null, modifiers: [], isRest: false }];
            return this.parseArrowBody(params, isAsync, arrowTok);
        }

        this.expect('operator', '(');
        const params = [];
        while (!this.check('operator', ')')) {
            let isRest = false;
            if (this.match('operator', '...')) isRest = true;
            const name = this.expectIdentifier();
            const typeAnnotation = this.parseOptionalTypeAnnotation();
            let defaultValue = null;
            if (this.match('operator', '=')) defaultValue = this.parseExpression();
            params.push({ id: name, typeAnnotation, defaultValue, modifiers: [], isRest });
            if (!this.match('operator', ',')) break;
        }
        this.expect('operator', ')');
        // Tipe return opsional pada arrow function: `(a: int): int => ...`
        this.parseOptionalTypeAnnotation();
        this.expect('operator', '=>');
        return this.parseArrowBody(params, isAsync, tok);
    }

    parseArrowBody(params, isAsync, tok) {
        let body;
        let isExpression = true;
        if (this.check('operator', '{')) {
            body = this.parseBlock();
            isExpression = false;
        } else {
            body = this.parseExpression();
        }
        return new A.ArrowFunctionExpression(params, body, isAsync, isExpression, tok.start.line, tok.start.column);
    }

    parsePrimary() {
        const tok = this.current;

        switch (tok.type) {
            case 'number':
            case 'float':
            case 'string':
                this.next();
                return new A.Literal(tok.value, String(tok.value), tok.start.line, tok.start.column);
            case 'identifier': {
                this.next();
                return new A.Identifier(tok.value, tok.start.line, tok.start.column);
            }
            case 'keyword':
                switch (tok.value) {
                    case 'true':
                    case 'false':
                        this.next();
                        return new A.Literal(tok.value === 'true', tok.value, tok.start.line, tok.start.column);
                    case 'null':
                        this.next();
                        return new A.Literal(null, 'null', tok.start.line, tok.start.column);
                    case 'undefined':
                        this.next();
                        return new A.Literal(undefined, 'undefined', tok.start.line, tok.start.column);
                    case 'this':
                        this.next();
                        return new A.ThisExpression(tok.start.line, tok.start.column);
                    case 'super':
                        this.next();
                        return new A.SuperExpression(tok.start.line, tok.start.column);
                    case 'new': {
                        this.next();
                        const callee = this.parseCallMemberNoCall();
                        const args = this.check('operator', '(') ? this.parseArguments() : [];
                        return new A.NewExpression(callee, args, tok.start.line, tok.start.column);
                    }
                    case 'async': {
                        // async arrow: async (a) => {} / async x => {}
                        this.next();
                        return this.parseArrow(true);
                    }
                    case 'fn': {
                        // anonymous function expression
                        this.next();
                        const params = this.parseParams();
                        const returnType = this.parseOptionalTypeAnnotation();
                        const body = this.parseBlock();
                        const fn = new A.FunctionDeclaration(null, params, body, false, [], tok.start.line, tok.start.column);
                        fn.returnType = returnType;
                        return fn;
                    }
                    case 'int':
                    case 'float':
                    case 'string':
                    case 'bool':
                    case 'any':
                    case 'void':
                    case 'never':
                    case 'object':
                        this.next();
                        return new A.Identifier(tok.value, tok.start.line, tok.start.column);
                }

                // Keyword lain (mis. `class`, `enum`, `get`) boleh dipakai
                // sebagai identifier di posisi ekspresi, selama keyword itu
                // tidak punya makna khusus di sana.
                // `import("...")` — pemuatan modul saat runtime. Berbeda
                // dari deklarasi `import`, yang hanya boleh muncul di
                // posisi statement.
                if (tok.value === 'import' && this.peek(1).type === 'operator'
                    && this.peek(1).value === '(') {
                    this.next();
                    this.next();
                    const source = this.parseExpression();
                    this.expect('operator', ')');
                    return new A.ImportExpression(source, tok.start.line, tok.start.column);
                }

                if (!EXPRESSION_BLOCKED_KEYWORDS.has(tok.value)) {
                    this.next();
                    return new A.Identifier(tok.value, tok.start.line, tok.start.column);
                }
                break;
            case 'template':
                return this.parseTemplateLiteral();
            case 'operator':
                if (tok.value === '(') {
                    // Parenthesized expression vs arrow function `(a, b) => ...`.
                    // Dicoba secara spekulatif: parse daftar param, lalu cek `=>`.
                    const saved = this.index;
                    const arrow = this.tryParseArrowParams();
                    if (arrow) return arrow;
                    this.index = saved;
                    this.next();
                    const expr = this.parseExpression();
                    this.expect('operator', ')');
                    return expr;
                }
                if (tok.value === '[') {
                    this.next();
                    const elements = [];
                    while (!this.check('operator', ']')) {
                        if (this.check('eof')) this.error('Array literal tidak ditutup');
                        if (this.match('operator', '...')) {
                            const sp = this.current;
                            elements.push(new A.SpreadElement(this.parseExpression(), sp.start.line, sp.start.column));
                        } else {
                            elements.push(this.parseExpression());
                        }
                        if (!this.match('operator', ',')) break;
                    }
                    this.expect('operator', ']');
                    return new A.ArrayExpression(elements, tok.start.line, tok.start.column);
                }
                if (tok.value === '{') {
                    return this.parseObjectLiteral();
                }
                break;
        }

        this.error(`Ekspresi tidak terduga: '${tok.value}'`);
    }

    /** Callee untuk `new`, tidak boleh langsung dipanggil. */
    parseCallMemberNoCall() {
        let expr = this.parsePrimary();
        while (true) {
            const tok = this.current;
            if (this.check('operator', '.')) {
                this.next();
                const property = this.expectMemberName();
                expr = new A.MemberExpression(expr, { name: property }, false, false, tok.start.line, tok.start.column);
                continue;
            }
            if (this.check('operator', '[')) {
                this.next();
                const property = this.parseExpression();
                this.expect('operator', ']');
                expr = new A.MemberExpression(expr, property, true, false, tok.start.line, tok.start.column);
                continue;
            }
            break;
        }
        return expr;
    }

    parseObjectLiteral() {
        const tok = this.current;
        this.expect('operator', '{');
        const properties = [];
        while (!this.check('operator', '}')) {
            if (this.check('eof')) this.error('Object literal tidak ditutup');

            let computed = false;
            let key;
            if (this.match('operator', '...')) {
                const sp = this.current;
                properties.push({ spread: true, value: this.parseExpression() });
                if (!this.match('operator', ',')) break;
                continue;
            }
            if (this.check('operator', '[')) {
                this.next();
                key = this.parseExpression();
                this.expect('operator', ']');
                computed = true;
            } else if (this.current.type === 'string' || this.current.type === 'number') {
                key = new A.Literal(this.next().value, null, tok.start.line, tok.start.column);
            } else if (this.current.type === 'identifier') {
                key = new A.Identifier(this.next().value, tok.start.line, tok.start.column);
            } else if (this.current.type === 'keyword' && this.peek(1).type === 'operator' && this.peek(1).value === ':') {
                // Keyword boleh menjadi kunci object bila langsung diikuti
                // tanda titik dua — konteksnya sudah pasti posisi kunci.
                key = new A.Identifier(this.next().value, tok.start.line, tok.start.column);
            } else {
                this.error('Kunci object tidak valid');
            }

            let value;
            if (this.match('operator', ':')) {
                value = this.parseExpression();
            } else if (this.check('operator', '(')) {
                // shorthand method
                const params = this.parseParams();
                const body = this.parseBlock();
                value = new A.FunctionDeclaration(null, params, body, false, [], tok.start.line, tok.start.column);
            } else {
                value = new A.Identifier(key.name, tok.start.line, tok.start.column);
            }
            properties.push({ key, value, computed, shorthand: !computed && key.type === 'Identifier' && value.type === 'Identifier' && key.name === value.name });
            if (!this.match('operator', ',')) break;
        }
        this.expect('operator', '}');
        return new A.ObjectExpression(properties, tok.start.line, tok.start.column);
    }

    /**
     * Template literal: `Halo ${nama}`.
     * Lexer memisahkan bagian teks dan source ekspresi; di sini setiap
     * bagian ekspresi diparse sebagai ekspresi Bonang biasa.
     */
    parseTemplateLiteral() {
        const tok = this.current;
        this.next();
        const quasis = [];
        const expressions = [];
        for (const part of tok.value) {
            if (part.type === 'quasi') {
                quasis.push(part.value);
            } else {
                // `parse` menghasilkan Program; ambil ekspresi tunggalnya.
                const program = parse(part.value, this.file);
                const stmt = program.body[0];
                if (!stmt || stmt.type !== 'ExpressionStatement') {
                    this.error('Ekspresi template literal harus berupa satu ekspresi');
                }
                expressions.push(stmt.expression);
            }
        }
        return new A.TemplateLiteral(quasis, expressions, tok.start.line, tok.start.column);
    }
}

// Keyword yang tidak boleh dipakai sebagai identifier dalam ekspresi.
const RESERVED_IN_EXPR = new Set([
    'let', 'const', 'var', 'fn', 'class', 'interface', 'enum', 'type', 'namespace',
    'if', 'else', 'while', 'for', 'in', 'of', 'return', 'break', 'continue',
    'switch', 'case', 'default', 'try', 'catch', 'finally', 'throw',
    'import', 'export', 'from', 'as', 'server', 'client', 'shared',
    'static', 'public', 'private', 'protected', 'abstract', 'override', 'readonly',
    'get', 'set', 'new', 'this', 'super', 'async', 'await', 'implements'
]);

// Keyword yang tidak boleh muncul sebagai identifier di posisi ekspresi
// karena punya makna khusus di sana.
const EXPRESSION_BLOCKED_KEYWORDS = new Set([
    'true', 'false', 'null', 'undefined', 'this', 'super', 'new',
    'async', 'fn', 'if', 'else', 'while', 'for', 'switch', 'case',
    'default', 'try', 'catch', 'finally', 'throw', 'return', 'break',
    'continue', 'let', 'const', 'var', 'import', 'export', 'from', 'as',
    'server', 'client', 'shared', 'await', 'in', 'of', 'implements',
    'extends', 'instanceof'
]);

// Keyword struktural yang tidak boleh menjadi nama binding sama sekali.
// Daftar ini jauh lebih ketat daripada RESERVED_IN_EXPR: kata kunci seperti
// `class` atau `enum` boleh dipakai sebagai nama variabel Bonang, karena
// pemanggilannya dideteksi lewat konteks.
const STRUCTURAL_KEYWORDS = new Set([
    'let', 'const', 'var', 'fn', 'interface', 'enum', 'type', 'namespace',
    'if', 'else', 'while', 'for', 'in', 'of', 'return', 'break', 'continue',
    'switch', 'case', 'default', 'try', 'catch', 'finally', 'throw',
    'import', 'export', 'from', 'as', 'server', 'client', 'shared',
    'this', 'super', 'await', 'implements', 'extends', 'instanceof'
]);

/**
 * Parse source code Bonang menjadi AST.
 */
function parse(source, file = '<input>') {
    return new Parser(source, file).parseProgram();
}

module.exports = { Parser, parse, CompilerError };
