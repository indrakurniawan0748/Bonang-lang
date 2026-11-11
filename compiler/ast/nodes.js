'use strict';

/**
 * Definisi node AST Bonang.
 *
 * Semua node adalah object biasa dengan `type` dan, jika relevan, `line`/`column`.
 * Formatter/evaluator bekerja dengan switch terhadap `type` sehingga menambah
 * tipe baru cukup menambahkan satu case.
 */

class Node {
    constructor(type, line, column) {
        this.type = type;
        this.line = line;
        this.column = column;
    }
}

// ===== PROGRAM =====

class Program extends Node {
    constructor(body, line = 1, column = 1) {
        super('Program', line, column);
        this.body = body;
    }
}

// ===== STATEMENTS =====

class VarDeclaration extends Node {
    constructor(kind, declarations, line, column) {
        super('VarDeclaration', line, column);
        this.kind = kind; // let | const | var
        this.declarations = declarations; // [{id, init, typeAnnotation}]
    }
}

class FunctionDeclaration extends Node {
    constructor(name, params, body, isAsync, modifiers, line, column) {
        super('FunctionDeclaration', line, column);
        this.name = name;
        this.params = params;
        this.body = body; // BlockStatement
        this.isAsync = isAsync;
        this.modifiers = modifiers || [];
    }
}

class ClassDeclaration extends Node {
    constructor(name, superClass, implementsList, members, modifiers, line, column) {
        super('ClassDeclaration', line, column);
        this.name = name;
        this.superClass = superClass;
        this.implements = implementsList || [];
        this.members = members;
        this.modifiers = modifiers || [];
    }
}

class InterfaceDeclaration extends Node {
    constructor(name, extendsList, members, line, column) {
        super('InterfaceDeclaration', line, column);
        this.name = name;
        this.extends = extendsList || [];
        this.members = members;
    }
}

class EnumDeclaration extends Node {
    constructor(name, members, line, column) {
        super('EnumDeclaration', line, column);
        this.name = name;
        this.members = members; // [{name, value}]
    }
}

class TypeAlias extends Node {
    constructor(name, typeAnnotation, line, column) {
        super('TypeAlias', line, column);
        this.name = name;
        this.typeAnnotation = typeAnnotation;
    }
}

class NamespaceDeclaration extends Node {
    constructor(name, body, line, column) {
        super('NamespaceDeclaration', line, column);
        this.name = name;
        this.body = body;
    }
}

class BlockStatement extends Node {
    constructor(body, line, column) {
        super('BlockStatement', line, column);
        this.body = body;
    }
}

class ExpressionStatement extends Node {
    constructor(expression, line, column) {
        super('ExpressionStatement', line, column);
        this.expression = expression;
    }
}

class IfStatement extends Node {
    constructor(test, consequent, alternate, line, column) {
        super('IfStatement', line, column);
        this.test = test;
        this.consequent = consequent;
        this.alternate = alternate;
    }
}

class WhileStatement extends Node {
    constructor(test, body, line, column) {
        super('WhileStatement', line, column);
        this.test = test;
        this.body = body;
    }
}

class ForStatement extends Node {
    constructor(init, test, update, body, line, column) {
        super('ForStatement', line, column);
        this.init = init;
        this.test = test;
        this.update = update;
        this.body = body;
    }
}

class ForInStatement extends Node {
    constructor(kind, left, right, body, isOf, line, column) {
        super('ForInStatement', line, column);
        this.kind = kind; // let | const | var
        this.left = left;
        this.right = right;
        this.body = body;
        this.isOf = isOf;
    }
}

class ReturnStatement extends Node {
    constructor(argument, line, column) {
        super('ReturnStatement', line, column);
        this.argument = argument;
    }
}

class BreakStatement extends Node {
    constructor(label, line, column) {
        super('BreakStatement', line, column);
        this.label = label;
    }
}

class ContinueStatement extends Node {
    constructor(label, line, column) {
        super('ContinueStatement', line, column);
        this.label = label;
    }
}

class SwitchStatement extends Node {
    constructor(discriminant, cases, line, column) {
        super('SwitchStatement', line, column);
        this.discriminant = discriminant;
        this.cases = cases; // [{test|null, consequent}]
    }
}

class TryStatement extends Node {
    constructor(block, handler, finalizer, line, column) {
        super('TryStatement', line, column);
        this.block = block;
        this.handler = handler; // CatchClause|null
        this.finalizer = finalizer;
    }
}

class CatchClause extends Node {
    constructor(param, body, line, column) {
        super('CatchClause', line, column);
        this.param = param; // {id, typeAnnotation} | null
        this.body = body;
    }
}

class ThrowStatement extends Node {
    constructor(argument, line, column) {
        super('ThrowStatement', line, column);
        this.argument = argument;
    }
}

// ===== MODULES =====

class ImportDeclaration extends Node {
    constructor(specifiers, source, line, column) {
        super('ImportDeclaration', line, column);
        this.specifiers = specifiers; // [{imported, local}]
        this.source = source;
    }
}

class ExportDeclaration extends Node {
    constructor(declaration, specifiers, source, line, column) {
        super('ExportDeclaration', line, column);
        this.declaration = declaration; // node | null
        this.specifiers = specifiers;   // [{local, exported}]
        this.source = source;           // re-export
    }
}

// ===== EXPRESSIONS =====

class Identifier extends Node {
    constructor(name, line, column) {
        super('Identifier', line, column);
        this.name = name;
    }
}

class Literal extends Node {
    constructor(value, raw, line, column) {
        super('Literal', line, column);
        this.value = value;
        this.raw = raw;
    }
}

class TemplateLiteral extends Node {
    constructor(quasis, expressions, line, column) {
        super('TemplateLiteral', line, column);
        this.quasis = quasis; // string[]
        this.expressions = expressions;
    }
}

class ArrayExpression extends Node {
    constructor(elements, line, column) {
        super('ArrayExpression', line, column);
        this.elements = elements;
    }
}

class ObjectExpression extends Node {
    constructor(properties, line, column) {
        super('ObjectExpression', line, column);
        this.properties = properties; // [{key, value, computed, shorthand}]
    }
}

class UnaryExpression extends Node {
    constructor(operator, argument, line, column) {
        super('UnaryExpression', line, column);
        this.operator = operator;
        this.argument = argument;
    }
}

class UpdateExpression extends Node {
    constructor(operator, argument, prefix, line, column) {
        super('UpdateExpression', line, column);
        this.operator = operator;
        this.argument = argument;
        this.prefix = prefix;
    }
}

class BinaryExpression extends Node {
    constructor(operator, left, right, line, column) {
        super('BinaryExpression', line, column);
        this.operator = operator;
        this.left = left;
        this.right = right;
    }
}

class LogicalExpression extends Node {
    constructor(operator, left, right, line, column) {
        super('LogicalExpression', line, column);
        this.operator = operator;
        this.left = left;
        this.right = right;
    }
}

class AssignmentExpression extends Node {
    constructor(operator, left, right, line, column) {
        super('AssignmentExpression', line, column);
        this.operator = operator;
        this.left = left;
        this.right = right;
    }
}

class ConditionalExpression extends Node {
    constructor(test, consequent, alternate, line, column) {
        super('ConditionalExpression', line, column);
        this.test = test;
        this.consequent = consequent;
        this.alternate = alternate;
    }
}

class CallExpression extends Node {
    constructor(callee, args, isOptional, line, column) {
        super('CallExpression', line, column);
        this.callee = callee;
        this.args = args;
        this.isOptional = isOptional;
    }
}

class NewExpression extends Node {
    constructor(callee, args, line, column) {
        super('NewExpression', line, column);
        this.callee = callee;
        this.args = args;
    }
}

class MemberExpression extends Node {
    constructor(object, property, computed, optional, line, column) {
        super('MemberExpression', line, column);
        this.object = object;
        this.property = property;
        this.computed = computed;
        this.optional = optional;
    }
}

class ArrowFunctionExpression extends Node {
    constructor(params, body, isAsync, isExpression, line, column) {
        super('ArrowFunctionExpression', line, column);
        this.params = params;
        this.body = body; // BlockStatement | expression
        this.isAsync = isAsync;
        this.isExpression = isExpression;
    }
}

class ThisExpression extends Node {
    constructor(line, column) {
        super('ThisExpression', line, column);
    }
}

class SuperExpression extends Node {
    constructor(line, column) {
        super('SuperExpression', line, column);
    }
}

class AwaitExpression extends Node {
    constructor(argument, line, column) {
        super('AwaitExpression', line, column);
        this.argument = argument;
    }
}

class TypeAnnotationNode extends Node {
    constructor(type, line, column) {
        super('TypeAnnotationNode', line, column);
        this.type = type; // string (sederhana) atau object
    }
}

class SpreadElement extends Node {
    constructor(argument, line, column) {
        super('SpreadElement', line, column);
        this.argument = argument;
    }
}

module.exports = {
    Node,
    Program,
    VarDeclaration,
    FunctionDeclaration,
    ClassDeclaration,
    InterfaceDeclaration,
    EnumDeclaration,
    TypeAlias,
    NamespaceDeclaration,
    BlockStatement,
    ExpressionStatement,
    IfStatement,
    WhileStatement,
    ForStatement,
    ForInStatement,
    ReturnStatement,
    BreakStatement,
    ContinueStatement,
    SwitchStatement,
    TryStatement,
    CatchClause,
    ThrowStatement,
    ImportDeclaration,
    ExportDeclaration,
    Identifier,
    Literal,
    TemplateLiteral,
    ArrayExpression,
    ObjectExpression,
    UnaryExpression,
    UpdateExpression,
    BinaryExpression,
    LogicalExpression,
    AssignmentExpression,
    ConditionalExpression,
    CallExpression,
    NewExpression,
    MemberExpression,
    ArrowFunctionExpression,
    ThisExpression,
    SuperExpression,
    AwaitExpression,
    TypeAnnotationNode,
    SpreadElement
};
