'use strict';

const { parse } = require('../compiler/parser/parser');

/**
 * Linter Bonang.
 *
 * Analisis statis ringan: menemukan pola yang bermasalah tanpa perlu
 * type checker penuh. Aturan dibuat modular agar mudah ditambah.
 */
class Linter {
    constructor(options = {}) {
        this.rules = [
            unusedVariableRule,
            emptyCatchRule,
            consoleUsageRule,
            evalUsageRule,
            longFunctionRule,
            todoCommentRule,
            shadowingRule,
            missingReturnRule,
            duplicateKeyRule
        ];
    }

    /**
     * Periksa satu file. Kembalikan daftar masalah.
     */
    lint(source, file = '<input>') {
        const issues = [];

        let ast;
        try {
            ast = parse(source, file);
        } catch (err) {
            return [{
                file, line: err.line || 0, column: err.column || 0,
                severity: 'error', rule: 'parse-error', message: err.message
            }];
        }

        for (const rule of this.rules) {
            const found = rule(ast, source);
            for (const issue of found) {
                issues.push({ file, ...issue });
            }
        }

        return issues;
    }
}

/**
 * Aturan: variabel yang dideklarasikan tapi tidak pernah dibaca.
 */
function unusedVariableRule(ast) {
    const issues = [];
    const declared = new Map();
    const used = new Set();
    const exported = new Set();

    walk(ast, (node) => {
        // Nama yang diekspor dipakai di luar modul — tidak boleh dilaporkan
        // sebagai variabel tak terpakai.
        if (node.type === 'ExportDeclaration' && node.declaration) {
            const decl = node.declaration;
            if (decl.type === 'VarDeclaration') {
                for (const d of decl.declarations) exported.add(d.id);
            } else if (decl.name) {
                exported.add(decl.name);
            }
        }
        if (node.type === 'VarDeclaration') {
            for (const decl of node.declarations) {
                declared.set(decl.id, node);
            }
        }
        if (node.type === 'Identifier') {
            used.add(node.name);
        }
    });

    for (const [name, node] of declared) {
        if (exported.has(name)) continue;
        if (!used.has(name)) {
            issues.push({
                line: node.line, column: node.column,
                severity: 'warning', rule: 'no-unused-variable',
                message: `Variabel '${name}' dideklarasikan tapi tidak pernah digunakan`
            });
        }
    }

    return issues;
}

/**
 * Aturan: blok catch kosong — kesalahan akan hilang tanpa jejak.
 */
function emptyCatchRule(ast) {
    const issues = [];
    walk(ast, (node) => {
        if (node.type === 'TryStatement' && node.handler) {
            const body = node.handler.body.body;
            if (body.length === 0) {
                issues.push({
                    line: node.line, column: node.column,
                    severity: 'warning', rule: 'no-empty-catch',
                    message: 'Blok catch kosong — error akan hilang tanpa jejak'
                });
            }
        }
    });
    return issues;
}

/**
 * Aturan: penggunaan console di kode produksi.
 */
function consoleUsageRule(ast) {
    const issues = [];
    walk(ast, (node) => {
        if (node.type === 'CallExpression' &&
            node.callee.type === 'MemberExpression' &&
            !node.callee.computed &&
            node.callee.object.type === 'Identifier' &&
            node.callee.object.name === 'console') {
            issues.push({
                line: node.line, column: node.column,
                severity: 'info', rule: 'no-console',
                message: 'Penggunaan console — pertimbangkan logger Bonang'
            });
        }
    });
    return issues;
}

/**
 * Aturan: penggunaan eval.
 */
function evalUsageRule(ast) {
    const issues = [];
    walk(ast, (node) => {
        if (node.type === 'CallExpression' &&
            node.callee.type === 'Identifier' &&
            node.callee.name === 'eval') {
            issues.push({
                line: node.line, column: node.column,
                severity: 'error', rule: 'no-eval',
                message: 'Penggunaan eval tidak aman'
            });
        }
    });
    return issues;
}

/**
 * Aturan: fungsi yang sangat panjang.
 */
function longFunctionRule(ast) {
    const issues = [];
    const check = (node, name) => {
        if (node.type !== 'FunctionDeclaration' && node.type !== 'ArrowFunctionExpression') return;
        const body = node.body.type === 'BlockStatement' ? node.body.body : [node.body];
        if (body.length > 80) {
            issues.push({
                line: node.line, column: node.column,
                severity: 'info', rule: 'max-function-length',
                message: `Fungsi '${name || 'anonim'}' memiliki ${body.length} statement — pertimbangkan dipecah`
            });
        }
    };
    walk(ast, (node) => {
        check(node, node.name);
    });
    return issues;
}

/**
 * Aturan: komentar TODO/FIXME.
 */
function todoCommentRule(ast, source) {
    const issues = [];
    const lines = source.split('\n');
    lines.forEach((line, index) => {
        if (/\b(TODO|FIXME|HACK|XXX)\b/.test(line)) {
            issues.push({
                line: index + 1, column: 1,
                severity: 'info', rule: 'no-todo',
                message: 'Ada penanda TODO/FIXME yang perlu diselesaikan'
            });
        }
    });
    return issues;
}

/**
 * Aturan: variabel bayangan (shadowing) dari scope luar.
 */
function shadowingRule(ast) {
    const issues = [];
    const scopes = [];

    const visitScope = (body, parentNames) => {
        const names = new Set(parentNames);
        for (const stmt of body) {
            if (stmt.type === 'VarDeclaration') {
                for (const decl of stmt.declarations) {
                    if (parentNames.has(decl.id)) {
                        issues.push({
                            line: stmt.line, column: stmt.column,
                            severity: 'warning', rule: 'no-shadowing',
                            message: `Variabel '${decl.id}' bayangan dari scope luar`
                        });
                    }
                    names.add(decl.id);
                }
            }
        }
        return names;
    };

    walk(ast, (node) => {
        if (node.type === 'BlockStatement') {
            const parentNames = new Set();
            for (const s of scopes) for (const n of s) parentNames.add(n);
            const childNames = visitScope(node.body, parentNames);
            scopes.push(childNames);
        }
    });

    return issues;
}

/**
 * Aturan: fungsi dengan tipe return non-void tetapi tidak selalu return.
 */
function missingReturnRule(ast) {
    const issues = [];
    walk(ast, (node) => {
        if (node.type !== 'FunctionDeclaration') return;
        if (!node.returnType) return;
        const typeName = node.returnType.node && node.returnType.node.name;
        if (typeName === 'void' || typeName === 'any') return;

        const body = node.body.body;
        const hasReturn = body.some((s) => s.type === 'ReturnStatement');
        const hasThrow = body.some((s) => s.type === 'ThrowStatement');
        if (!hasReturn && !hasThrow) {
            issues.push({
                line: node.line, column: node.column,
                severity: 'warning', rule: 'consistent-return',
                message: `Fungsi '${node.name}' bertipe '${typeName}' tetapi tidak memiliki return`
            });
        }
    });
    return issues;
}

/**
 * Aturan: kunci duplikat pada object literal.
 */
function duplicateKeyRule(ast) {
    const issues = [];
    walk(ast, (node) => {
        if (node.type !== 'ObjectExpression') return;
        const seen = new Set();
        for (const prop of node.properties) {
            if (prop.computed || !prop.key || prop.key.type !== 'Identifier') continue;
            if (seen.has(prop.key.name)) {
                issues.push({
                    line: node.line, column: node.column,
                    severity: 'warning', rule: 'no-duplicate-keys',
                    message: `Kunci '${prop.key.name}' duplikat pada object literal`
                });
            }
            seen.add(prop.key.name);
        }
    });
    return issues;
}

/**
 * Telusuri seluruh node AST.
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

module.exports = { Linter, walk };
