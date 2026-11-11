'use strict';

const A = require('../ast/nodes');

/**
 * Nama yang tidak boleh dipakai sebagai identifier JavaScript.
 * Variabel Bonang dengan nama ini akan di-rename saat codegen.
 */
const JS_RESERVED = new Set([
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
    'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally',
    'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null',
    'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof',
    'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'await', 'implements',
    'package', 'private', 'protected', 'public', 'interface', 'implements'
]);

/**
 * Scope lexical untuk codegen.
 *
 * Setiap scope memetakan nama Bonang -> nama JavaScript. Nama Bonang yang
 * aman dipakai apa adanya sehingga `this.name` pada class tetap bekerja
 * seperti yang ditulis pengguna.
 */
class Scope {
    constructor(parent) {
        this.parent = parent;
        this.names = new Map();
        // Nama yang berasal dari import: dipetakan ke (variabel modul,
        // nama ekspor) supaya nilainya dibaca secara live dari
        // `module.exports` setiap kali dipakai.
        this.imports = new Map();
    }

    declare(bonangName) {
        const jsName = this.pickName(bonangName);
        this.names.set(bonangName, jsName);
        // Deklarasi lokal menggantikan nama yang sebelumnya diimpor —
        // Bonang mengizinkan shadowing nama import.
        this.imports.delete(bonangName);
        return jsName;
    }

    /**
     * Deklarasikan nama yang berasal dari import modul lain.
     *
     * Nama lokal dicatat di `names` (agar bisa di-shadow oleh deklarasi
     * lokal — Bonang mengizinkan hal itu) dan dipetakan ke sumber
     * ekspornya di `imports`.
     */
    declareImport(localName, moduleVar, exportedName) {
        const jsName = this.pickName(localName);
        this.names.set(localName, jsName);
        this.imports.set(localName, { moduleVar, exportedName });
        return jsName;
    }

    pickName(bonangName) {
        if (!JS_RESERVED.has(bonangName) && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(bonangName)) {
            // Pastikan nama tidak bentrok dengan nama yang sudah dipakai di scope ini.
            let candidate = bonangName;
            let counter = 1;
            while (this.names.has(candidate) && this.names.get(candidate) !== bonangName) {
                candidate = `${bonangName}_${counter++}`;
            }
            return candidate;
        }
        return `_$${bonangName}`;
    }

    lookup(bonangName) {
        let scope = this;
        while (scope) {
            if (scope.names.has(bonangName)) return scope.names.get(bonangName);
            scope = scope.parent;
        }
        return null;
    }

    /**
     * Cari sumber import untuk sebuah nama, kalau ada.
     */
    lookupImport(bonangName) {
        let scope = this;
        while (scope) {
            const found = scope.imports.get(bonangName);
            if (found) return found;
            scope = scope.parent;
        }
        return null;
    }
}

/**
 * Konteks compile-time yang dikumpulkan saat codegen.
 */
class CodegenContext {
    constructor(options = {}) {
        this.target = options.target || 'server'; // server | client
        this.tempCounter = 0;
        this.imports = [];
        this.exportedNames = [];
        this.needsIterableHelper = false;
        // Dynamic import butuh helper runtime yang menyelesaikan path
        // modul relatif terhadap file yang memanggilnya.
        this.needsDynamicImportHelper = false;
        this.dynamicImports = [];
    }

    temp(prefix = 't') {
        this.tempCounter += 1;
        return `_$${prefix}${this.tempCounter}`;
    }
}

/**
 * Code generator Bonang.
 *
 * Menghasilkan JavaScript yang dieksekusi langsung oleh Node (target server)
 * atau dibungkus browser bundle (target client).
 */
class Generator {
    constructor(options = {}) {
        this.ctx = new CodegenContext(options);
        this.options = options;
        this.scope = new Scope(null);
        this.classStack = [];
    }

    error(message, node) {
        const line = node && node.line ? node.line : 0;
        const col = node && node.column ? node.column : 0;
        const err = new Error(`${message} (baris ${line}, kolom ${col})`);
        err.bonangError = true;
        throw err;
    }

    pushScope() {
        this.scope = new Scope(this.scope);
        return this.scope;
    }

    popScope() {
        this.scope = this.scope.parent;
    }

    // ===== PROGRAM =====

    generateProgram(ast) {
        const body = ast.body.map((stmt) => this.generateStatement(stmt)).join('\n');
        return body;
    }

    // ===== STATEMENTS =====

    generateStatement(node) {
        switch (node.type) {
            case 'VarDeclaration':
                return this.generateVarDeclaration(node);
            case 'FunctionDeclaration':
                return this.generateFunctionDeclaration(node);
            case 'ClassDeclaration':
                return this.generateClassDeclaration(node);
            case 'InterfaceDeclaration':
                return this.generateInterface(node);
            case 'EnumDeclaration':
                return this.generateEnum(node);
            case 'TypeAlias':
                return `// type ${node.name} = ${this.typeToString(node.typeAnnotation)}`;
            case 'NamespaceDeclaration':
                return this.generateNamespace(node);
            case 'BlockStatement':
                return this.generateBlock(node);
            case 'ExpressionStatement':
                return this.generateExpressionStatement(node);
            case 'IfStatement':
                return this.generateIf(node);
            case 'WhileStatement':
                return this.generateWhile(node);
            case 'ForStatement':
                return this.generateFor(node);
            case 'ForInStatement':
                return this.generateForIn(node);
            case 'ReturnStatement':
                return node.argument
                    ? `return ${this.generateExpression(node.argument)};`
                    : 'return;';
            case 'BreakStatement':
                return node.label ? `break ${node.label};` : 'break;';
            case 'ContinueStatement':
                return node.label ? `continue ${node.label};` : 'continue;';
            case 'SwitchStatement':
                return this.generateSwitch(node);
            case 'TryStatement':
                return this.generateTry(node);
            case 'ThrowStatement':
                return `throw ${this.generateExpression(node.argument)};`;
            case 'ImportDeclaration':
                return this.generateImport(node);
            case 'ExportDeclaration':
                return this.generateExport(node);
            default:
                this.error(`Statement belum didukung: ${node.type}`, node);
        }
    }

    generateBlock(node) {
        this.pushScope();
        const inner = node.body.map((s) => this.generateStatement(s)).join('\n');
        this.popScope();
        if (!inner.trim()) return '{}';
        return `{\n${inner}\n}`;
    }

    generateVarDeclaration(node) {
        const parts = node.declarations.map((d) => {
            const name = this.scope.declare(d.id);
            const value = d.init ? this.generateExpression(d.init) : 'undefined';
            return `${name} = ${value}`;
        });
        const keyword = node.kind === 'const' ? 'const' : 'let';
        return `${keyword} ${parts.join(', ')};`;
    }

    generateFunctionDeclaration(node) {
        const name = node.name
            ? this.scope.declare(node.name)
            : this.ctx.temp('fn');

        this.pushScope();
        const params = this.generateParamList(node.params);
        const body = this.generateBlock(node.body);
        this.popScope();

        const isAsync = node.isAsync ? 'async ' : '';
        return `${isAsync}function ${name}(${params.join(', ')}) ${body}`;
    }

    /** Deklarasikan parameter dan kembalikan daftar nama JS-nya. */
    declareParams(params) {
        const names = [];
        for (const p of params) {
            const jsName = this.scope.declare(p.id);
            names.push(p.isRest ? `...${jsName}` : jsName);
        }
        return names;
    }

    /**
     * Parameter yang punya default value harus diekspresikan sebagai JS
     * default parameter. Nilainya dievaluasi di scope fungsi.
     */
    generateParamList(params) {
        const names = [];
        for (const p of params) {
            const jsName = this.scope.declare(p.id);
            if (p.isRest) {
                names.push(`...${jsName}`);
            } else if (p.defaultValue) {
                names.push(`${jsName} = ${this.generateExpression(p.defaultValue)}`);
            } else {
                names.push(jsName);
            }
        }
        return names;
    }

    generateClassDeclaration(node) {
        const className = node.name;
        const lines = [];
        const superRef = node.superClass ? this.resolveTypeName(node.superClass) : null;

        this.pushScope();
        if (superRef) {
            lines.push(`class ${className} extends ${superRef} {`);
        } else {
            lines.push(`class ${className} {`);
        }

        // Properties menjadi field kelas sehingga `this.x` valid.
        for (const member of node.members) {
            if (member.kind !== 'property') continue;
            const init = member.value ? ` = ${this.generateExpression(member.value)}` : '';
            lines.push(`  ${member.name}${init};`);
        }

        const ctor = node.members.find((m) => m.kind === 'constructor');
        if (ctor) {
            this.pushScope();
            const params = this.generateParamList(ctor.params);
            const body = this.generateBlock(ctor.body);
            this.popScope();
            lines.push(`  constructor(${params.join(', ')}) ${body}`);
        } else if (superRef) {
            lines.push('  constructor(...args) { super(...args); }');
        }

        for (const member of node.members) {
            if (member.kind === 'method') {
                this.pushScope();
                const params = this.generateParamList(member.params);
                const body = this.generateBlock(member.body);
                this.popScope();
                const isAsync = member.modifiers && member.modifiers.includes('async') ? 'async ' : '';
                lines.push(`  ${isAsync}${member.name}(${params.join(', ')}) ${body}`);
            } else if (member.kind === 'getter') {
                this.pushScope();
                const body = this.generateBlock(member.body);
                this.popScope();
                lines.push(`  get ${member.name}() ${body}`);
            } else if (member.kind === 'setter') {
                this.pushScope();
                const params = this.generateParamList(member.params);
                const body = this.generateBlock(member.body);
                this.popScope();
                lines.push(`  set ${member.name}(${params.join(', ')}) ${body}`);
            }
        }

        lines.push('}');
        this.popScope();

        // Static method dipasang setelah deklarasi kelas.
        const staticMethods = node.members.filter(
            (m) => m.kind === 'method' && m.modifiers && m.modifiers.includes('static')
        );
        for (const member of staticMethods) {
            this.pushScope();
            const params = this.generateParamList(member.params);
            const body = this.generateBlock(member.body);
            this.popScope();
            lines.push(`${className}.${member.name} = function(${params.join(', ')}) ${body};`);
        }

        return lines.join('\n');
    }

    generateInterface(node) {
        const lines = [`// interface ${node.name}`];
        for (const member of node.members) {
            lines.push(`//   ${member.name}(${member.params.map((p) => p.id).join(', ')}): ${this.typeToString(member.returnType)}`);
        }
        return lines.join('\n');
    }

    generateEnum(node) {
        const entries = node.members.map((m) => `  ${JSON.stringify(m.name)}: ${JSON.stringify(m.value)}`);
        return `const ${node.name} = Object.freeze({\n${entries.join(',\n')}\n});`;
    }

    generateNamespace(node) {
        const names = this.collectExportedNames(node.body);
        this.pushScope();
        const body = node.body.map((s) => this.generateStatement(s)).join('\n');
        this.popScope();
        const exported = names
            .map((n) => `${n}: ${this.scope.lookup(n) || n}`)
            .join(', ');
        return `const ${node.name} = (() => {\n${body}\nreturn { ${exported} };\n})();`;
    }

    collectExportedNames(body) {
        const names = [];
        for (const stmt of body) {
            if (stmt.type === 'FunctionDeclaration' && stmt.name) names.push(stmt.name);
            if (stmt.type === 'ClassDeclaration') names.push(stmt.name);
            if (stmt.type === 'VarDeclaration') {
                for (const d of stmt.declarations) names.push(d.id);
            }
        }
        return names;
    }

    generateExpressionStatement(node) {
        return `${this.generateExpression(node.expression)};`;
    }

    generateIf(node) {
        const test = this.generateExpression(node.test);
        const consequent = this.generateStatement(node.consequent);
        if (!node.alternate) return `if (${test}) ${consequent}`;
        const alternate = this.generateStatement(node.alternate);
        return `if (${test}) ${consequent} else ${alternate}`;
    }

    generateWhile(node) {
        return `while (${this.generateExpression(node.test)}) ${this.generateStatement(node.body)}`;
    }

    generateFor(node) {
        this.pushScope();
        let init = '';
        if (node.init) {
            init = this.generateStatement(node.init).replace(/;$/, '');
        }
        const test = node.test ? this.generateExpression(node.test) : '';
        const update = node.update ? this.generateExpression(node.update) : '';
        this.popScope();
        return `for (${init}; ${test}; ${update}) ${this.generateStatement(node.body)}`;
    }

    generateForIn(node) {
        this.pushScope();
        const name = this.scope.declare(node.left);
        const right = this.generateExpression(node.right);
        this.popScope();
        const keyword = node.kind === 'const' ? 'const' : 'let';
        if (node.isOf) {
            this.ctx.needsIterableHelper = true;
            return `for (const ${name} of _$$iterable(${right})) ${this.generateStatement(node.body)}`;
        }
        return `for (const ${name} in ${right}) ${this.generateStatement(node.body)}`;
    }

    generateSwitch(node) {
        const disc = this.generateExpression(node.discriminant);
        const cases = node.cases.map((c) => {
            const test = c.test === null ? 'default' : `case ${this.generateExpression(c.test)}`;
            this.pushScope();
            const body = c.consequent.map((s) => this.generateStatement(s)).join('\n');
            this.popScope();
            return `    ${test}:\n${body}`;
        }).join('\n');
        return `switch (${disc}) {\n${cases}\n}`;
    }

    generateTry(node) {
        const block = this.generateBlock(node.block);
        let out = `try ${block}`;
        if (node.handler) {
            this.pushScope();
            const param = node.handler.param ? this.scope.declare(node.handler.param.id) : '_$err';
            const body = this.generateBlock(node.handler.body);
            this.popScope();
            out += ` catch (${param}) ${body}`;
        }
        if (node.finalizer) {
            out += ` finally ${this.generateBlock(node.finalizer)}`;
        }
        return out;
    }

    /**
     * Import statement.
     *
     * **Live binding**
     * ---------------
     * `const { a } = require(...)` menangkap nilai a **saat import
     * dijalankan**. Pada siklus modul, saat modul A diimpor oleh B, A
     * belum selesai dievaluasi sehingga `a` masih `undefined` — nilainya
     * tidak pernah ikut terbawa.
     *
     * Karena itu nama yang diimpor dipetakan ke accessor yang membaca
     * `module.exports` **setiap kali dipakai**:
     *
     * ```js
     * const __bngMod_0 = require("./b.bng");
     * // `a` -> __bngMod_0.a
     * ```
     *
     * Ini memberi semantics live binding yang sama dengan ES module,
     * dan membuat siklus modul bisa dipakai: nilai diambil saat
     * runtime, bukan saat import.
     *
     * Import namespace (`import * as ns`) tetap memakai objek modul
     * langsung — objek tersebut hidup dan berubah isinya.
     */
    generateImport(node) {
        const path = node.source;
        const isNamespace = node.specifiers.some((s) => s.imported === '*');
        this.ctx.imports.push({ path, specifiers: node.specifiers, namespace: isNamespace });

        if (isNamespace) {
            const local = node.specifiers[0].local;
            return `const ${local} = require(${JSON.stringify(path)});`;
        }
        if (node.specifiers.length === 0) {
            return `require(${JSON.stringify(path)});`;
        }

        // Modul disimpan dalam variabel agar nama yang diimpor bisa
        // dibaca secara live dari `module.exports`.
        const modVar = this.ctx.temp('mod');
        const lines = [`const ${modVar} = require(${JSON.stringify(path)});`];

        for (const spec of node.specifiers) {
            // Nama lokal dideklarasikan di scope modul supaya `generateIdentifier`
            // bisa memetakannya ke akses properti modul.
            this.scope.declareImport(spec.local, modVar, spec.imported);
        }

        return lines.join('\n');
    }

    generateExport(node) {
        const decl = node.declaration;

        // `export { a, b as c }` — ekspor nama yang sudah dideklarasikan.
        if (!decl) {
            const pairs = node.specifiers.map((s) => {
                // Nama yang berasal dari import diekspor dari modul asalnya
                // (`mod.nama`), bukan dari binding lokal yang nilainya
                // mungkin belum terisi saat siklus modul terjadi.
                const imported = this.scope.lookupImport(s.local);
                const jsName = imported
                    ? this.importedAccess(imported)
                    : (this.scope.lookup(s.local) || s.local);
                this.ctx.exportedNames.push(s.exported);
                return `${s.exported}: ${jsName}`;
            });
            return `Object.assign(module.exports, { ${pairs.join(', ')} });`;
        }

        const exportName = (name) => {
            this.ctx.exportedNames.push(name);
            return name;
        };

        if (decl.type === 'FunctionDeclaration' && decl.name) {
            const jsName = exportName(this.scope.declare(decl.name));
            return `${this.generateFunctionDeclaration(decl)}\nmodule.exports.${decl.name} = ${jsName};`;
        }
        if (decl.type === 'ClassDeclaration') {
            const jsName = exportName(decl.name);
            return `${this.generateClassDeclaration(decl)}\nmodule.exports.${decl.name} = ${jsName};`;
        }
        if (decl.type === 'VarDeclaration') {
            const pairs = decl.declarations.map((d) => {
                const jsName = this.scope.declare(d.id);
                exportName(d.id);
                return `${d.id}: ${jsName}`;
            });
            // Object.assign dipakai (bukan `module.exports = {...}`) supaya
            // beberapa deklarasi export dalam satu modul tidak saling
            // menimpa.
            return `${this.generateVarDeclaration(decl)}\nObject.assign(module.exports, { ${pairs.join(', ')} });`;
        }
        if (decl.type === 'EnumDeclaration') {
            exportName(decl.name);
            return `${this.generateEnum(decl)}\nmodule.exports.${decl.name} = ${decl.name};`;
        }
        return this.generateStatement(decl);
    }

    // ===== EXPRESSIONS =====

    generateExpression(node) {
        switch (node.type) {
            case 'Identifier':
                return this.generateIdentifier(node);
            case 'Literal':
                // `undefined` adalah literal tersendiri — jangan disamakan
                // dengan `null`, karena keduanya berbeda secara semantik.
                if (node.value === undefined) return 'undefined';
                return JSON.stringify(node.value);
            case 'TemplateLiteral':
                return this.generateTemplateLiteral(node);
            case 'ArrayExpression':
                return `[${node.elements.map((e) => this.generateExpression(e)).join(', ')}]`;
            case 'ObjectExpression':
                return this.generateObject(node);
            case 'UnaryExpression':
                return this.generateUnary(node);
            case 'UpdateExpression':
                return this.generateUpdate(node);
            case 'BinaryExpression':
                return `(${this.generateExpression(node.left)} ${node.operator} ${this.generateExpression(node.right)})`;
            case 'LogicalExpression':
                return `(${this.generateExpression(node.left)} ${node.operator} ${this.generateExpression(node.right)})`;
            case 'AssignmentExpression':
                return this.generateAssignment(node);
            case 'ConditionalExpression':
                return `(${this.generateExpression(node.test)} ? ${this.generateExpression(node.consequent)} : ${this.generateExpression(node.alternate)})`;
            case 'CallExpression':
                return this.generateCall(node);
            case 'NewExpression':
                return `new ${this.generateExpression(node.callee)}(${node.args.map((a) => this.generateExpression(a)).join(', ')})`;
            case 'ImportExpression':
                return this.generateImportExpression(node);
            case 'MemberExpression':
                return this.generateMember(node);
            case 'ArrowFunctionExpression':
                return this.generateArrow(node);
            case 'FunctionDeclaration':
                return this.generateFunctionExpression(node);
            case 'ThisExpression':
                return 'this';
            case 'SuperExpression':
                return 'super';
            case 'AwaitExpression':
                return `await ${this.generateExpression(node.argument)}`;
            case 'SpreadElement':
                return `...${this.generateExpression(node.argument)}`;
            default:
                this.error(`Ekspresi belum didukung: ${node.type}`, node);
        }
    }

    /**
     * Identifier yang terikat pada scope Bonang dipetakan ke nama JS-nya.
     * Identifier yang tidak terikat dianggap global (mis. `console`, `Math`).
     *
     * Nama yang berasal dari import accessing `module.exports` setiap kali
     * dipakai (live binding) — lihat `generateImport`.
     */
    /**
     * Ekspresi `import("...")` — pemuatan modul saat runtime.
     *
     * Path harus statis (literal string) agar bundler bisa memuat modul
     * tersebut di dalam bundel. Path yang tidak literal ditolak: nilainya
     * tidak bisa diketahui saat build, jadi hasilnya tidak deterministik.
     */
    generateImportExpression(node) {
        const source = node.source;
        if (!source || source.type !== 'Literal' || typeof source.value !== 'string') {
            this.error(
                'import() hanya menerima string literal (path modul harus diketahui saat build)',
                node
            );
        }
        const path = source.value;
        this.ctx.dynamicImports.push(path);
        this.ctx.needsDynamicImportHelper = true;
        return `_$$dynamicImport(${JSON.stringify(path)})`;
    }

    generateIdentifier(node) {
        const imported = this.scope.lookupImport(node.name);
        if (imported) {
            return this.importedAccess(imported);
        }
        const mapped = this.scope.lookup(node.name);
        return mapped !== null ? mapped : node.name;
    }

    /**
     * Akses properti pada variabel modul untuk nama hasil import.
     *
     * Nama ekspor yang bukan identifier JS valid ditulis sebagai
     * `mod["nama"]`.
     */
    importedAccess(imported) {
        const exported = imported.exportedName;
        const prop = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(exported)
            ? `.${exported}`
            : `[${JSON.stringify(exported)}]`;
        return `${imported.moduleVar}${prop}`;
    }

    generateTemplateLiteral(node) {
        let out = '`';
        for (let i = 0; i < node.quasis.length; i++) {
            out += this.escapeTemplate(node.quasis[i]);
            if (i < node.expressions.length) {
                out += `\${${this.generateExpression(node.expressions[i])}}`;
            }
        }
        out += '`';
        return out;
    }

    escapeTemplate(text) {
        return text.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    }

    generateObject(node) {
        const entries = node.properties.map((p) => {
            if (p.spread) {
                return `...${this.generateExpression(p.value)}`;
            }
            const key = p.computed
                ? `[${this.generateExpression(p.key)}]`
                : this.propertyKey(p.key);
            return `${key}: ${this.generateExpression(p.value)}`;
        });
        return `{ ${entries.join(', ')} }`;
    }

    propertyKey(key) {
        if (key.type === 'Literal') {
            return typeof key.value === 'string' ? JSON.stringify(key.value) : String(key.value);
        }
        if (key.type === 'Identifier') {
            return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key.name) ? key.name : JSON.stringify(key.name);
        }
        return JSON.stringify(String(key.value));
    }

    generateUnary(node) {
        const op = node.operator;
        // Operator unary berbasis kata kunci butuh spasi setelahnya, kalau tidak
        // `typeof x` akan menjadi `typeofx` dan merusak sintaks JavaScript.
        if (op === 'typeof' || op === 'void' || op === 'delete') {
            if (node.argument.type === 'Identifier') {
                // `generateIdentifier` dipakai (bukan `scope.lookup`) supaya
                // nama yang berasal dari import tetap dibaca dari modulnya.
                return `${op} ${this.generateIdentifier(node.argument)}`;
            }
            return `${op} ${this.generateExpression(node.argument)}`;
        }
        return `${op}${this.generateExpression(node.argument)}`;
    }

    generateUpdate(node) {
        const arg = this.generateExpression(node.argument);
        return node.prefix ? `${node.operator}${arg}` : `${arg}${node.operator}`;
    }

    generateAssignment(node) {
        const left = this.generateExpression(node.left);
        const right = this.generateExpression(node.right);
        if (node.operator === '=') return `${left} = ${right}`;
        return `${left} ${node.operator} ${right}`;
    }

    generateCall(node) {
        const callee = this.generateExpression(node.callee);
        const args = node.args.map((a) => this.generateExpression(a)).join(', ');
        if (node.isOptional) {
            const tmp = this.ctx.temp('opt');
            return `(${tmp} = ${callee}) == null ? undefined : ${tmp}(${args})`;
        }
        return `${callee}(${args})`;
    }

    generateMember(node) {
        const obj = this.generateExpression(node.object);
        if (node.computed) {
            const prop = this.generateExpression(node.property);
            if (node.optional) {
                const tmp = this.ctx.temp('opt');
                return `(${tmp} = ${obj}) == null ? undefined : ${tmp}[${prop}]`;
            }
            return `${obj}[${prop}]`;
        }
        // Nama properti yang merupakan keyword terlarang JavaScript harus
        // ditulis dengan notasi kurung siku agar sintaksnya valid.
        const accessor = JS_RESERVED.has(node.property.name)
            ? `[${JSON.stringify(node.property.name)}]`
            : `.${node.property.name}`;
        if (node.optional) {
            const tmp = this.ctx.temp('opt');
            return `(${tmp} = ${obj}) == null ? undefined : ${tmp}${accessor}`;
        }
        return `${obj}${accessor}`;
    }

    generateArrow(node) {
        this.pushScope();
        const params = this.generateParamList(node.params);
        let body;
        if (node.isExpression) {
            body = this.generateExpression(node.body);
            // Body berupa object literal harus dibungkus kurung. Tanpa itu
            // JavaScript akan memperlakukannya sebagai block statement
            // (`() => { a: 1 }`) dan sintaksnya jadi tidak valid.
            if (node.body.type === 'ObjectExpression') {
                body = `(${body})`;
            }
        } else {
            body = this.generateBlock(node.body);
        }
        this.popScope();
        const isAsync = node.isAsync ? 'async ' : '';
        return `${isAsync}(${params.join(', ')}) => ${body}`;
    }

    generateFunctionExpression(node) {
        this.pushScope();
        const params = this.generateParamList(node.params);
        const body = this.generateBlock(node.body);
        this.popScope();
        const isAsync = node.isAsync ? 'async ' : '';
        return `${isAsync}function(${params.join(', ')}) ${body}`;
    }

    // ===== TYPE HELPERS =====

    resolveTypeName(typeNode) {
        if (!typeNode) return null;
        if (typeNode.kind === 'named') return typeNode.name;
        return null;
    }

    typeToString(annotation) {
        if (!annotation) return 'any';
        const t = annotation.node || annotation;
        switch (t.kind) {
            case 'primitive': return t.name;
            case 'named': return t.name;
            case 'array': return `${this.typeToString({ node: t.element })}[]`;
            case 'generic': return `${t.name}<${t.args.map((a) => this.typeToString({ node: a })).join(', ')}>`;
            case 'union': return t.options.map((o) => this.typeToString({ node: o })).join(' | ');
            case 'null': return 'null';
            default: return 'any';
        }
    }
}

/**
 * Helper runtime yang disisipkan bila diperlukan.
 */
const RUNTIME_HELPERS = {
    iterable: `function _$$iterable(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return Array.from(value);
  if (typeof value[Symbol.iterator] === 'function') return Array.from(value);
  if (typeof value === 'object') return Object.keys(value).map((k) => value[k]);
  return [];
}`,
    /**
     * Dynamic import.
     *
     * Modul dimuat lalu dibungkus dalam Promise. Path relatif diselesaikan
     * oleh `require` Bonang milik modul pemanggil, sehingga
     * `import("./x.bng")` berperilaku sama dengan `require("./x.bng")`.
     *
     * Di bundel, panggilan ini sudah ditulis ulang saat build menjadi
     * `Promise.resolve(__bngRequire("id"))` — helper ini hanya dipakai
     * ketika program dijalankan langsung dari sumber.
     */
    dynamicImport: `function _$$dynamicImport(specifier) {
  try {
    if (typeof require !== 'function') {
      return Promise.reject(new Error(
        'Dynamic import tidak didukung di lingkungan ini: ' + specifier
      ));
    }
    return Promise.resolve(require(specifier));
  } catch (err) {
    return Promise.reject(err);
  }
}`
};

/**
 * Compile AST Bonang menjadi kode JavaScript.
 */
function generate(ast, options = {}) {
    const gen = new Generator(options);
    const code = gen.generateProgram(ast);
    const helpers = [];
    if (gen.ctx.needsIterableHelper) {
        helpers.push(RUNTIME_HELPERS.iterable);
    }
    if (gen.ctx.needsDynamicImportHelper) {
        helpers.push(RUNTIME_HELPERS.dynamicImport);
    }
    return {
        code,
        helpers,
        imports: gen.ctx.imports,
        exportedNames: gen.ctx.exportedNames,
        dynamicImports: gen.ctx.dynamicImports
    };
}

module.exports = { Generator, generate, Scope, CodegenContext, RUNTIME_HELPERS };
