'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('../compiler/parser/parser');

// ===== KONSTANTA ATURAN =====

// Metode HTTP yang terdaftar pada router.
const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

// Metode yang mengubah data — hanya ini yang wajib memvalidasi input.
const MUTATING_METHODS = new Set(['post', 'put', 'patch', 'delete']);

// Kata kunci SQL yang menandakan sebuah template literal berisi SQL.
const SQL_KEYWORD_PATTERN = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i;

// Akar ekspresi yang dianggap berisi data dari request.
const REQUEST_ROOT_PATTERN = /^(ctx|req|request|context)$/i;

// Nama variabel yang secara umum menampung data mentah dari user.
const USER_VALUE_PATTERN = /^(body|input|payload|userinput|user_input|untrusted|rawbody|raw_input)$/i;

// Properti pada objek request yang berisi data user.
const REQUEST_PROPERTY_PATTERN = /^(body|query|params|headers|cookies|payload)$/i;

// Nama fungsi yang menunjukkan adanya validasi input.
const VALIDATION_CALL_PATTERN = /^(validate|validate[A-Z]\w*|readBody|readJson|assertBody|parseId|parse[A-Za-z]*Id)$/;

// Petunjuk adanya kontrol autentikasi.
const AUTH_PATTERN = /auth|requireUser|requireAuth|session|token|jwt/i;

/**
 * Auditor keamanan Bonang.
 *
 * Memindai kode proyek untuk pola yang rawan masalah:
 * - SQL string yang digabungkan (SQL injection).
 * - Aksi DOM tanpa escaping (XSS).
 * - Path file dari input user (path traversal).
 * - Hardcoded secret.
 * - Autentikasi yang tidak ada di route sensitif.
 * - Ketidakakuratan validasi input.
 *
 * Analisis dilakukan atas AST, bukan atas teks mentah, agar pemeriksaan
 * bisa membedakan konstanta program dari data yang berasal dari user.
 */
class SecurityAuditor {
    constructor(options = {}) {
        this.secretPatterns = [
            { pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]+['"]/i, message: 'Password hardcoded' },
            { pattern: /(?:api[_-]?key|apikey|secret[_-]?key)\s*[:=]\s*['"][^'"]+['"]/i, message: 'API key hardcoded' },
            { pattern: /(?:token|secret)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i, message: 'Token/secret hardcoded' },
            { pattern: /AKIA[0-9A-Z]{16}/, message: 'AWS access key hardcoded' },
            { pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, message: 'Private key hardcoded' }
        ];
    }

    /**
     * Audit seluruh proyek. Kembalikan laporan.
     */
    async audit(root) {
        const issues = [];
        const files = this.collectFiles(root);
        let filesScanned = 0;

        for (const file of files) {
            const relative = path.relative(root, file);
            const source = fs.readFileSync(file, 'utf8');
            filesScanned += 1;

            issues.push(...this.checkSecrets(source, relative));
            issues.push(...this.checkSqlConcatenation(source, relative));
            issues.push(...this.checkXss(source, relative));
            issues.push(...this.checkPathTraversal(source, relative));

            const astIssues = this.checkAst(source, relative, file);
            issues.push(...astIssues);
        }

        // Periksa file konfigurasi untuk secret yang tersimpan.
        issues.push(...this.checkConfigFiles(root));

        return { filesScanned, issues };
    }

    /**
     * Periksa file konfigurasi dan berkas `.env` untuk secret tersimpan.
     *
     * Berkas `.env` memang berisi kredensial, tetapi `.env` yang ikut
     * ter-commit ke repository adalah kebocoran — makanya berkas `.env*`
     * yang ada di dalam proyek ikut dilaporkan.
     */
    checkConfigFiles(root) {
        const issues = [];
        const candidates = ['.env', '.env.local', '.env.production', 'bonang.config.js', 'config.json'];

        for (const name of candidates) {
            const full = path.join(root, name);
            if (!fs.existsSync(full)) continue;
            let content;
            try {
                content = fs.readFileSync(full, 'utf8');
            } catch {
                continue;
            }
            if (content.trim() === '') continue;

            const relative = path.relative(root, full);
            for (const { pattern, message } of this.secretPatterns) {
                if (pattern.test(content)) {
                    issues.push({
                        file: relative, line: 1, column: 1,
                        severity: 'high', rule: 'secret-in-config',
                        message: `${message} tersimpan di berkas konfigurasi`,
                        recommendation: 'Pindahkan secret ke variabel lingkungan dan abaikan berkas .env di repository'
                    });
                    break;
                }
            }
        }

        return issues;
    }

    collectFiles(root) {
        const files = [];
        const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', 'data', '.bonang']);
        const walk = (dir) => {
            let entries;
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (!skipDirs.has(entry.name)) walk(full);
                } else if (entry.name.endsWith('.bng')) {
                    files.push(full);
                }
            }
        };
        walk(root);
        return files;
    }

    /**
     * Deteksi secret hardcoded.
     */
    checkSecrets(source, file) {
        const issues = [];
        const lines = source.split('\n');
        lines.forEach((line, index) => {
            // Abaikan baris komentar agar dokumentasi tidak dilaporkan.
            const trimmed = line.trim();
            if (trimmed.startsWith('//')) return;

            for (const { pattern, message } of this.secretPatterns) {
                if (pattern.test(line)) {
                    issues.push({
                        file, line: index + 1, column: 1,
                        severity: 'high', rule: 'no-hardcoded-secret',
                        message: `${message} terdeteksi`,
                        recommendation: 'Pindahkan ke variabel lingkungan atau file .env'
                    });
                }
            }
        });
        return issues;
    }

    /**
     * Deteksi SQL yang digabungkan dengan operator `+`.
     *
     * Kasus template literal diperiksa lewat AST (lihat `checkSqlTemplates`)
     * karena teks mentah tidak bisa membedakan konstanta dari data user.
     */
    checkSqlConcatenation(source, file) {
        const issues = [];
        const lines = source.split('\n');
        lines.forEach((line, index) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('//')) return;

            // Pola: query(...) dengan operator + di dalam string SQL.
            if (/query|execute|prepare|raw/i.test(line) &&
                /['"`][^'"`]*\b(SELECT|INSERT|UPDATE|DELETE|DROP)\b[^'"`]*['"`]\s*\+/i.test(line)) {
                issues.push({
                    file, line: index + 1, column: 1,
                    severity: 'critical', rule: 'sql-injection',
                    message: 'SQL string digabungkan dengan operator + — berisiko SQL injection',
                    recommendation: 'Gunakan placeholder `?` dan prepared statement'
                });
            }
        });
        return issues;
    }

    /**
     * Deteksi penulisan DOM tanpa escaping (XSS).
     */
    checkXss(source, file) {
        const issues = [];
        const lines = source.split('\n');
        lines.forEach((line, index) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('//')) return;

            // innerHTML/outerHTML tanpa escapeHtml.
            if (/\.(innerHTML|outerHTML)\s*=/.test(line) &&
                !/escapeHtml|escape_html|sanitize/i.test(line)) {
                issues.push({
                    file, line: index + 1, column: 1,
                    severity: 'high', rule: 'xss-inner-html',
                    message: 'Penulisan ke innerHTML tanpa escaping — rawan XSS',
                    recommendation: 'Gunakan textContent, atau escapeHtml() untuk nilai dinamis'
                });
            }
            if (/insertAdjacentHTML\s*\(/.test(line) && !/escapeHtml|sanitize/i.test(line)) {
                issues.push({
                    file, line: index + 1, column: 1,
                    severity: 'high', rule: 'xss-insert-adjacent',
                    message: 'insertAdjacentHTML tanpa escaping — prone to XSS',
                    recommendation: 'Gunakan textContent atau escapeHtml()'
                });
            }
            // document.write
            if (/document\.write\s*\(/.test(line)) {
                issues.push({
                    file, line: index + 1, column: 1,
                    severity: 'high', rule: 'xss-document-write',
                    message: 'document.write dengan data dinamis — prone to XSS',
                    recommendation: 'Gunakan DOM API modern (createElement/textContent)'
                });
            }
        });
        return issues;
    }

    /**
     * Deteksi path file yang berasal dari input user tanpa sanitasi.
     */
    checkPathTraversal(source, file) {
        const issues = [];
        const lines = source.split('\n');
        lines.forEach((line, index) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('//')) return;

            if (/(readFile|writeFile|unlink|rmdir|createReadStream)\s*\(/.test(line) &&
                /(ctx\.(params|query|body)|request\.)/.test(line) &&
                !/safeJoin|safeFilename|sanitize/i.test(line)) {
                issues.push({
                    file, line: index + 1, column: 1,
                    severity: 'high', rule: 'path-traversal',
                    message: 'Path file berasal dari input user tanpa sanitasi',
                    recommendation: 'Gunakan safeJoin(root, ...) dari modul security'
                });
            }
        });
        return issues;
    }

    /**
     * Analisis AST untuk masalah yang butuh pemahaman struktur.
     */
    checkAst(source, file, filePath) {
        const issues = [];
        let ast;
        try {
            ast = parse(source, filePath);
        } catch {
            // Error sintaks sudah dilaporkan oleh linter.
            return issues;
        }

        const info = analyzeProgram(ast);

        issues.push(...this.checkSqlTemplates(ast, file, info));
        issues.push(...this.checkRoutes(ast, file, info));

        return issues;
    }

    /**
     * Deteksi SQL yang memakai template literal dan interpolasi data yang
     * tidak dikontrol program.
     *
     * Interpolasi dianggap aman bila nilainya adalah konstanta program
     * (literal yang di-assign ke properti kelas atau variabel modul) atau
     * sudah divalidasi dengan `assertIdentifier`.
     */
    checkSqlTemplates(ast, file, info) {
        const issues = [];

        walkScoped(ast, (node, scope) => {
            if (!node || node.type !== 'TemplateLiteral') return;

            const text = node.quasis.join(' ');
            if (!SQL_KEYWORD_PATTERN.test(text)) return;

            const unsafe = node.expressions.filter(
                (expr) => !isSafeInterpolation(expr, scope, info)
            );
            if (unsafe.length === 0) return;

            issues.push({
                file, line: node.line, column: node.column,
                severity: 'critical', rule: 'sql-injection-template',
                message: 'SQL dibangun dengan template literal dan interpolasi data yang tidak dikontrol — berisiko SQL injection',
                recommendation: 'Gunakan placeholder `?` dan prepared statement'
            });
        }, info);

        return issues;
    }

    /**
     * Deteksi route yang mengubah data tapi tanpa validasi input.
     */
    checkRoutes(ast, file, info) {
        const issues = [];

        walkScoped(ast, (node, scope) => {
            if (!node || node.type !== 'CallExpression') return;
            if (!node.callee || node.callee.type !== 'MemberExpression') return;
            if (node.callee.computed) return;

            const method = node.callee.property && node.callee.property.name;
            if (!ROUTE_METHODS.has(method)) return;
            if (!MUTATING_METHODS.has(method)) return;

            // Receiver harus terlihat seperti router. Tanpa pemeriksaan ini,
            // pemanggilan `store.put(...)` pada kode IndexedDB ikut terbaca
            // sebagai pendaftaran route HTTP.
            if (!isRouterLike(node.callee.object)) return;

            const handler = node.args[node.args.length - 1];
            if (!handler) return;

            if (this.handlerValidates(handler, scope, info, new Set())) return;

            issues.push({
                file, line: node.line, column: node.column,
                severity: 'medium', rule: 'missing-input-validation',
                message: `Route ${method.toUpperCase()} tidak memvalidasi input`,
                recommendation: 'Validasi body di handler (ctx.validate) atau di service yang dipanggil'
            });
        }, info);

        return issues;
    }

    /**
     * Apakah handler (langsung maupun lewat delegasi ke method kelas)
     * memvalidasi input atau memeriksa autentikasi?
     */
    handlerValidates(handler, scope, info, seen) {
        if (!handler || seen.has(handler)) return false;

        // Wrapper body method kelas yang dipanggil lewat delegasi.
        if (handler.type === 'MethodBody') {
            if (bodyHasValidation(handler.body)) return true;
            return bodyHasAuth(handler.body);
        }

        // Handler berupa arrow function / method reference.
        if (handler.type === 'ArrowFunctionExpression') {
            if (seen.has(handler)) return false;
            seen.add(handler);

            if (bodyHasValidation(handler.body)) return true;
            if (bodyHasAuth(handler.body)) return true;

            // Delegasi: `(ctx) => this.store(ctx)` — periksa method yang
            // dipanggil, karena validasi sering ada di service/controller.
            for (const call of collectCalls(handler.body)) {
                const name = delegatedMethodName(call);
                if (!name) continue;
                const method = scope.classInfo ? scope.classInfo.methods.get(name) : null;
                if (!method) continue;
                if (this.handlerValidates({ type: 'MethodBody', body: method.body }, scope, info, seen)) {
                    return true;
                }
            }
            return false;
        }

        // Handler berupa referensi method: `router.post("/x", this.handlePost)`.
        if (handler.type === 'MemberExpression' && handler.object &&
            handler.object.type === 'ThisExpression' && handler.property) {
            const method = scope.classInfo ? scope.classInfo.methods.get(handler.property.name) : null;
            if (!method) return false;
            return this.handlerValidates({ type: 'MethodBody', body: method.body }, scope, info, seen);
        }

        // Handler berupa fungsi top-level: `router.post("/x", handlePost)`.
        if (handler.type === 'Identifier') {
            const fn = info.functions.get(handler.name);
            if (!fn) return false;
            return this.handlerValidates({ type: 'MethodBody', body: fn.body }, scope, info, seen);
        }

        return false;
    }
}

// ===== ANALISIS PROGRAM =====

/**
 * Kumpulkan informasi yang dibutuhkan pemeriksaan AST:
 * konstanta modul, konstanta kelas, method kelas, dan nama variabel yang
 * berisi data dari user.
 */
function analyzeProgram(ast) {
    const classes = new Map();
    const moduleConsts = new Map();
    const functions = new Map();

    // `export class X {}` dibungkus ExportDeclaration; unfokuskan supaya
    // kelas tetap ditemukan pada tingkat modul.
    const statements = [];
    for (const statement of ast.body) {
        if (statement.type === 'ExportDeclaration' && statement.declaration) {
            statements.push(statement.declaration);
        } else {
            statements.push(statement);
        }
    }

    for (const statement of statements) {
        if (statement.type === 'ClassDeclaration') {
            classes.set(statement.name, { methods: new Map(), consts: new Map() });
        } else if (statement.type === 'FunctionDeclaration') {
            functions.set(statement.name, statement);
        } else if (statement.type === 'VarDeclaration' && statement.kind === 'const') {
            for (const decl of statement.declarations) {
                if (decl.id && isStringLiteral(decl.init)) {
                    moduleConsts.set(decl.id, decl.init.value);
                }
            }
        }
    }

    // Isi kelas: method, properti konstan, dan assignment `this.x = "..."`.
    for (const statement of statements) {
        if (statement.type !== 'ClassDeclaration') continue;
        const info = classes.get(statement.name);
        if (!info) continue;

        for (const member of statement.members) {
            if (member.kind === 'method') info.methods.set(member.name, member);
            if (member.kind === 'property' && isStringLiteral(member.value)) {
                info.consts.set(member.name, member.value);
            }
            if (member.kind === 'constructor' && member.body) {
                for (const [name, value] of collectThisAssignments(member.body)) {
                    info.consts.set(name, value);
                }
            }
        }
    }

    const tainted = collectTaintedNames(ast);

    return { classes, moduleConsts, functions, tainted };
}

/**
 * Kumpulkan assignment `this.x = <literal string>` di dalam sebuah body.
 */
function collectThisAssignments(body) {
    const found = new Map();
    walk(body, (node) => {
        if (node.type !== 'AssignmentExpression') return;
        if (!node.left || node.left.type !== 'MemberExpression') return;
        if (!node.left.object || node.left.object.type !== 'ThisExpression') return;
        const name = node.left.property && node.left.property.name;
        if (!name) return;
        if (isStringLiteral(node.right)) found.set(name, node.right.value);
    });
    return found;
}

/**
 * Nama variabel yang nilainya berasal dari request user.
 *
 * Ditentukan dua lapis: langsung (nama parameter/objek request) dan
 * turunan (variabel yang diinisialisasi dari nilai yang sudah tercemar).
 */
function collectTaintedNames(ast) {
    const tainted = new Set();

    const scan = () => {
        let changed = false;
        walk(ast, (node) => {
            if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionDeclaration') {
                for (const param of node.params || []) {
                    if (param && param.id && USER_VALUE_PATTERN.test(param.id) && !tainted.has(param.id)) {
                        tainted.add(param.id);
                        changed = true;
                    }
                }
            }
            if (node.type === 'VarDeclaration') {
                for (const decl of node.declarations) {
                    if (!decl.id || tainted.has(decl.id)) continue;
                    if (isUserSource(decl.init, tainted)) {
                        tainted.add(decl.id);
                        changed = true;
                    }
                }
            }
        });
        return changed;
    };

    let changed = true;
    let guard = 0;
    while (changed && guard < 10) {
        changed = scan();
        guard += 1;
    }

    return tainted;
}

/**
 * Apakah ekspresi ini berisi data yang berasal dari request user?
 */
function isUserSource(node, tainted) {
    if (!node) return false;

    if (node.type === 'Identifier') {
        if (REQUEST_ROOT_PATTERN.test(node.name)) return true;
        if (USER_VALUE_PATTERN.test(node.name)) return true;
        return tainted.has(node.name);
    }

    if (node.type === 'MemberExpression') {
        const property = node.property && node.property.name;
        if (property && REQUEST_PROPERTY_PATTERN.test(property)) return true;
        const root = rootIdentifier(node.object);
        if (!root) return false;
        if (REQUEST_ROOT_PATTERN.test(root)) return true;
        return tainted.has(root);
    }

    if (node.type === 'CallExpression') {
        return isUserSource(node.callee, tainted) || (node.args || []).some((a) => isUserSource(a, tainted));
    }

    if (node.type === 'AwaitExpression' || node.type === 'ConditionalExpression' ||
        node.type === 'BinaryExpression' || node.type === 'LogicalExpression') {
        if (node.type === 'ConditionalExpression') {
            return isUserSource(node.consequent, tainted) || isUserSource(node.alternate, tainted);
        }
        if (node.type === 'AwaitExpression') return isUserSource(node.argument, tainted);
        return isUserSource(node.left, tainted) || isUserSource(node.right, tainted);
    }

    return false;
}

/**
 * Interpolasi dianggap aman bila nilainya pasti dikontrol program.
 */
function isSafeInterpolation(node, scope, info) {
    if (!node) return true;

    // `this.x` — aman bila `x` di-assign literal string di kelas ini.
    if (node.type === 'MemberExpression' && node.object &&
        node.object.type === 'ThisExpression' && node.property) {
        const name = node.property.name;
        const consts = scope.classInfo ? scope.classInfo.consts : null;
        if (consts && consts.has(name)) return true;
        return false;
    }

    // Identifier — aman bila konstanta modul atau bukan data user.
    if (node.type === 'Identifier') {
        if (info.moduleConsts.has(node.name)) return true;
        return !info.tainted.has(node.name);
    }

    // Panggilan `assertIdentifier(...)` — nama identifier sudah divalidasi.
    if (node.type === 'CallExpression') {
        const name = callName(node);
        if (name === 'assertIdentifier') return true;
        if (node.callee && node.callee.type === 'MemberExpression') {
            const root = rootIdentifier(node.callee.object);
            if (root && (REQUEST_ROOT_PATTERN.test(root) || info.tainted.has(root))) return false;
        }
        return true;
    }

    if (node.type === 'Literal') return true;

    // Bentuk lain: aman selama bukan data user.
    return !isUserSource(node, info.tainted);
}

// ===== PENJELAJAHAN AST =====

/**
 * Telusuri seluruh node AST (tanpa konteks kelas).
 */
function walk(node, visit) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
        for (const item of node) walk(item, visit);
        return;
    }
    if (typeof node.type === 'string') {
        visit(node);
    }
    for (const key of Object.keys(node)) {
        if (key === 'type' || key === 'line' || key === 'column') continue;
        walk(node[key], visit);
    }
}

/**
 * Telusuri AST sambil membawa konteks kelas yang sedang dibuka.
 *
 * `scope.classInfo` menunjuk kelas terdekat yang sedang ditelusuri —
 * dipakai untuk resolving `this.x` dan method yang didelegasikan.
 */
function walkScoped(node, visit, info) {
    const scope = { classInfo: null };

    const descend = (current) => {
        if (!current || typeof current !== 'object') return;
        if (Array.isArray(current)) {
            for (const item of current) descend(item);
            return;
        }

        const isNode = typeof current.type === 'string';
        if (isNode) visit(current, scope);

        const previous = scope.classInfo;
        if (isNode && current.type === 'ClassDeclaration') {
            scope.classInfo = info.classes.get(current.name) || null;
        }

        for (const key of Object.keys(current)) {
            if (key === 'type' || key === 'line' || key === 'column') continue;
            descend(current[key]);
        }

        scope.classInfo = previous;
    };

    descend(node);
}

/**
 * Kumpulkan seluruh CallExpression di dalam sebuah subtree.
 */
function collectCalls(node) {
    const calls = [];
    walk(node, (n) => {
        if (n.type === 'CallExpression') calls.push(n);
    });
    return calls;
}

/**
 * Nama method yang dipanggil lewat `this.nama(...)`.
 */
function delegatedMethodName(call) {
    if (!call || !call.callee || call.callee.type !== 'MemberExpression') return null;
    if (!call.callee.object || call.callee.object.type !== 'ThisExpression') return null;
    return call.callee.property && call.callee.property.name;
}

/**
 * Nama fungsi yang dipanggil: `f(...)` atau `obj.f(...)`.
 */
function callName(call) {
    if (!call || !call.callee) return null;
    if (call.callee.type === 'Identifier') return call.callee.name;
    if (call.callee.type === 'MemberExpression' && call.callee.property) {
        return call.callee.property.name;
    }
    return null;
}

/**
 * Identifier paling luar dari sebuah ekspresi: `ctx.body.name` → `ctx`.
 */
function rootIdentifier(node) {
    let current = node;
    while (current) {
        if (current.type === 'Identifier') return current.name;
        if (current.type === 'MemberExpression') {
            current = current.object;
            continue;
        }
        if (current.type === 'CallExpression') {
            current = current.callee;
            continue;
        }
        return null;
    }
    return null;
}

/**
 * Apakah receiver pemanggilan terlihat seperti router HTTP?
 */
function isRouterLike(object) {
    if (!object) return false;
    let name = null;
    if (object.type === 'Identifier') {
        name = object.name;
    } else if (object.type === 'MemberExpression' && !object.computed && object.property) {
        name = object.property.name;
    }
    if (!name) return false;

    const lower = name.toLowerCase();
    return lower === 'router' || lower.endsWith('router') ||
        lower === 'app' || lower === 'server' || lower === 'api';
}

/**
 * Apakah body memuat pemanggilan validasi input?
 */
function bodyHasValidation(body) {
    let found = false;
    walk(body, (node) => {
        if (found) return;
        if (node.type === 'CallExpression') {
            const name = callName(node);
            if (name && VALIDATION_CALL_PATTERN.test(name)) found = true;
        }
        if (node.type === 'NewExpression') {
            const name = callName(node);
            if (name && /ValidationError/i.test(name)) found = true;
        }
    });
    return found;
}

/**
 * Apakah body memuat jejak kontrol autentikasi?
 */
function bodyHasAuth(body) {
    let found = false;
    walk(body, (node) => {
        if (found) return;
        if (node.type === 'Identifier' && AUTH_PATTERN.test(node.name)) found = true;
        if (node.type === 'CallExpression') {
            const name = callName(node);
            if (name && AUTH_PATTERN.test(name)) found = true;
        }
    });
    return found;
}

/**
 * Apakah node adalah literal string?
 */
function isStringLiteral(node) {
    return !!node && node.type === 'Literal' && typeof node.value === 'string';
}

module.exports = { SecurityAuditor };
