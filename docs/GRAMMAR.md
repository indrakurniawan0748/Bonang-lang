# GRAMMAR — BONANG

Grammar formal (EBNF) untuk BONANG v0.1. Notasi:

- `::=` definisi
- `|` alternasi
- `,` rangkaian
- `[ ... ]` opsional
- `{ ... }` nol atau lebih (dalam deskripsi leksikal)
- `'...'` literal terminal

Grammar ini adalah rujukan; implementasinya ada di
`compiler/parser/parser.js` dan diverifikasi oleh `tests/unit/parser.test.js`.

---

## 1. Program

```ebnf
Program        ::= Statement* EOF

Statement     ::= ImportDeclaration
                 | ExportDeclaration
                 | Declaration
                 | ExpressionStatement
                 | IfStatement
                 | WhileStatement
                 | ForStatement
                 | ForInStatement
                 | SwitchStatement
                 | TryStatement
                 | ReturnStatement
                 | BreakStatement
                 | ContinueStatement
                 | ThrowStatement
                 | Block
                 | ';'
```

Modifier target boleh mendahului deklarasi:

```ebnf
TargetModifier ::= 'server' | 'client' | 'shared'
```

---

## 2. Deklarasi

```ebnf
Declaration   ::= TargetModifier? VarDeclaration
                 | TargetModifier? FunctionDeclaration
                 | TargetModifier? ClassDeclaration
                 | TargetModifier? InterfaceDeclaration
                 | TargetModifier? EnumDeclaration
                 | TargetModifier? TypeAlias
                 | TargetModifier? NamespaceDeclaration
```

### 2.1 Variabel

```ebnf
VarDeclaration ::= ('let' | 'const' | 'var') (Identifier | Pattern)
                   ('=' Expression)? ';'

Pattern        ::= Identifier
                 | ArrayPattern
                 | ObjectPattern

ArrayPattern   ::= '[' (Pattern (',' Pattern)* ','?)? ']'
ObjectPattern  ::= '{' (Identifier ':' Pattern (',' Identifier ':' Pattern)* ','?)? '}'
```

> Catatan implementasi: destructure pattern *tidak* dieksekusi runtime pada
> v0.1; hanya `Identifier` yang didukung penuh.

### 2.2 Fungsi

```ebnf
FunctionDeclaration ::= 'async'? 'fn' Identifier
                        '(' ParameterList? ')'
                        (':' TypeAnnotation)?
                        Block

ParameterList  ::= Parameter (',' Parameter)* ','?

Parameter      ::= Identifier (':' TypeAnnotation)? ('=' Expression)?
```

`function` diterima sebagai alias `fn`.

### 2.3 Class

```ebnf
ClassDeclaration ::= 'abstract'? 'class' Identifier
                     ('extends' Expression)?
                     ('implements' TypeList)?
                     ClassBody

ClassBody       ::= '{' ClassMember* '}'

ClassMember     ::= AccessModifier? 'static'? 'abstract'? 'override'? 'readonly'?
                     ClassMethod
                   | AccessModifier? 'static'? 'readonly'? PropertyDeclaration

ClassMethod     ::= 'get'? 'set'? Identifier '(' ParameterList? ')'
                     (':' TypeAnnotation)? Block

PropertyDeclaration ::= Identifier (':' TypeAnnotation)? ('=' Expression)? ';'

AccessModifier  ::= 'public' | 'private' | 'protected'

TypeList        ::= TypeAnnotation (',' TypeAnnotation)*
```

Method juga boleh ditulis tanpa keyword `fn` (notasi `nama()`).

### 2.4 Interface

```ebnf
InterfaceDeclaration ::= 'interface' Identifier TypeList? ClassBody
```

### 2.5 Enum

```ebnf
EnumDeclaration ::= 'enum' Identifier '{' EnumMember* '}'

EnumMember      ::= Identifier ('=' Expression)? ','?
```

### 2.6 Type alias

```ebnf
TypeAlias ::= 'type' Identifier '=' TypeAnnotation ';'
```

### 2.7 Namespace

```ebnf
NamespaceDeclaration ::= 'namespace' Identifier '{' Statement* '}'
```

---

## 3. Modul

```ebnf
ImportDeclaration ::= 'import' ImportClause 'from' StringLiteral ';'

ImportClause     ::= 'default'? ImportSpecifier
                     (',' ImportSpecifier)?
                   | '*' 'as' Identifier
                   | '{' NamedImports? '}'

NamedImports     ::= Identifier ('as' Identifier)? (',' Identifier ('as' Identifier)?)* ','?

ImportSpecifier  ::= Identifier 'as'? Identifier

ExportDeclaration ::= 'export' 'default'? ExportTarget ';'

ExportTarget     ::= FunctionDeclaration
                   | ClassDeclaration
                   | InterfaceDeclaration
                   | EnumDeclaration
                   | TypeAlias
                   | VarDeclaration
```

---

## 4. Statement

```ebnf
ExpressionStatement ::= Expression ';'

IfStatement      ::= 'if' '(' Expression ')' Statement
                      ('else' 'if' '(' Expression ')' Statement)*
                      ('else' Statement)?

WhileStatement   ::= 'while' '(' Expression ')' Statement

ForStatement     ::= 'for' '(' ForInit? ';' Expression? ';' Expression? ')' Statement

ForInit          ::= 'let' | 'const' | 'var' Identifier ('=' Expression)?

ForInStatement   ::= 'for' ('let' | 'const' | 'var') Identifier
                      ('of' | 'in') Expression ')' Statement

SwitchStatement  ::= 'switch' '(' Expression ')' '{' SwitchCase* '}'
SwitchCase       ::= 'case' Expression ':' Statement*
                   | 'default' ':' Statement*

TryStatement     ::= 'try' Block CatchClause? FinallyClause?

CatchClause      ::= 'catch' ('(' Identifier ')')? Block

FinallyClause    ::= 'finally' Block

ReturnStatement  ::= 'return' Expression? ';'
BreakStatement   ::= 'break' ';'
ContinueStatement ::= 'continue' ';'
ThrowStatement   ::= 'throw' Expression ';'

Block            ::= '{' Statement* '}'
```

---

## 5. Ekspresi

```ebnf
Expression       ::= AssignmentExpression

AssignmentExpression ::= ConditionalExpression
                        | LeftHandSide AssignmentOperator Expression

AssignmentOperator ::= '=' | '+=' | '-=' | '*=' | '/=' | '%='
                       | '**=' | '&&=' | '||=' | '??='
                       | '&=' | '|=' | '^=' | '<<=' | '>>=' | '>>>='

ConditionalExpression ::= NullishExpression ('?' Expression ':' Expression)?

NullishExpression ::= LogicalOrExpression ('??' LogicalOrExpression)*

LogicalOrExpression  ::= LogicalAndExpression ('||' LogicalAndExpression)*
LogicalAndExpression ::= BitwiseOrExpression ('&&' BitwiseAndExpression)*

BitwiseOrExpression   ::= BitwiseXorExpression ('|' BitwiseXorExpression)*
BitwiseXorExpression  ::= BitwiseAndExpression ('^' BitwiseAndExpression)*
BitwiseAndExpression  ::= EqualityExpression ('&' EqualityExpression)*

EqualityExpression ::= RelationalExpression
                       (('==' | '!=' | '===' | '!==') RelationalExpression)*

RelationalExpression ::= ShiftExpression
                        (('<' | '>' | '<=' | '>=' | 'instanceof' | 'in')
                         ShiftExpression)*

ShiftExpression  ::= AdditiveExpression
                     (('<<' | '>>' | '>>>') AdditiveExpression)*

AdditiveExpression ::= MultiplicativeExpression
                       (('+' | '-') MultiplicativeExpression)*

MultiplicativeExpression ::= ExponentiationExpression
                            (('*' | '/' | '%') ExponentiationExpression)*

ExponentiationExpression ::= UnaryExpression ('**' UnaryExpression)*

UnaryExpression  ::= ('!' | '-' | '+' | '~' | 'typeof' | 'void' | 'delete')
                     UnaryExpression
                   | UpdateExpression

UpdateExpression ::= LeftHandSide ('++' | '--')?
                   | ('++' | '--') LeftHandSide

LeftHandSide     ::= CallExpression
                   | OptionalExpression

OptionalExpression ::= MemberExpression OptionalChain*

OptionalChain    ::= '?.' Identifier
                   | '?.' '[' Expression ']'
                   | '?.' '(' ArgumentList ')'

PostfixExpression ::= LeftHandSide

PrimaryExpression ::= 'this'
                    | 'super'
                    | Literal
                    | Identifier
                    | '(' Expression ')'
                    | '[' ArrayLiteral? ']'
                    | '{' ObjectLiteral? '}'
                    | FunctionExpression
                    | ArrowFunction
                    | 'new' NewExpression

NewExpression   ::= PrimaryExpression ('(' ArgumentList? ')')?

CallExpression  ::= PrimaryExpression Arguments?

Arguments       ::= '(' ArgumentList? ')'
ArgumentList    ::= Argument (',' Argument)* ','?
Argument        ::= Expression | SpreadElement
SpreadElement   ::= '...' Expression

FunctionExpression ::= 'async'? 'fn' '(' ParameterList? ')'
                      (':' TypeAnnotation)? Block

ArrowFunction   ::= 'async'? ArrowParams '=>' ArrowBody

ArrowParams     ::= Identifier
                  | '(' ParameterList? ')'

ArrowBody       ::= Expression
                  | Block
```

### 5.1 Literal

```ebnf
Literal         ::= NumberLiteral
                 | StringLiteral
                 | TemplateLiteral
                 | BooleanLiteral
                 | NullLiteral
                 | UndefinedLiteral

BooleanLiteral  ::= 'true' | 'false'
NullLiteral     ::= 'null'
UndefinedLiteral ::= 'undefined'

ArrayLiteral    ::= ElementList?
ElementList     ::= Element (',' Element)* ','?
Element         ::= AssignmentExpression | SpreadElement

ObjectLiteral   ::= PropertyList?
PropertyList    ::= Property (',' Property)* ','?
Property        ::= PropertyName (':' AssignmentExpression)?
                  | SpreadElement

PropertyName    ::= Identifier | StringLiteral | NumberLiteral | '[' Expression ']'
```

### 5.2 Template literal

```ebnf
TemplateLiteral ::= '`' TemplatePart* '`'
TemplatePart    ::= TemplateChars | '${' Expression '}'
```

Bagian `${...}` di-parse sebagai ekspresi penuh dan disisipkan ke string
JavaScript yang dihasilkan.

---

## 6. Tipe (anotasi)

```ebnf
TypeAnnotation ::= BasicType
                 | ArrayType
                 | ObjectType
                 | UnionType
                 | NullableType
                 | FunctionType
                 | QualifiedType

BasicType      ::= 'int' | 'float' | 'string' | 'bool' | 'any' | 'void'
                 | 'never' | 'object'
ArrayType      ::= BasicType '[' ']'
ObjectType     ::= '{' Identifier (':' TypeAnnotation)? '}'
UnionType      ::= TypeAnnotation ('|' TypeAnnotation)+
NullableType   ::= TypeAnnotation '?'
FunctionType   ::= '(' TypeList? ')' '=>' TypeAnnotation
QualifiedType  ::= Identifier ('.' Identifier)*
```

> Anotasi tipe diparse dan disimpan di AST, tetapi **tidak ditegakkan**
> runtime pada v0.1.

---

## 7. Presedensi Parser (Implementasi)

Parser memakai *precedence climbing*. Tabel presedensi di
`compiler/parser/parser.js` (daftar `PRECEDENCE`) berdasar:

| Operator | Presedensi |
| --- | --- |
| `??` | 1 |
| `\|\|` | 2 |
| `&&` | 3 |
| `\|` | 4 |
| `^` | 5 |
| `&` | 6 |
| `==` `!=` `===` `!==` | 7 |
| `<` `>` `<=` `>=` `instanceof` `in` | 8 |
| `<<` `>>` `>>>` | 9 |
| `+` `-` | 10 |
| `*` `/` `%` | 11 |
| `**` | 12 |
| unary | 13 |
| call/member/new | 14 |
| assignment | 15 (right-assoc) |
| ternary | 16 (right-assoc) |

---

## 8. Disambiguasi `(`: Grouping vs Arrow

Grammar ambigu pada `(`. Parser memakai parse spekulatif:

```ebnf
TryParseArrowParams ::=
    save := parser.index
    attempt := parseParameterList()          -- toleran terhadap kegagalan
    if nextToken is '=>' then
        parser.index := save
        return attempt
    else
        parser.index := save
        return null
```

Pemanggil memakai hasilnya untuk memilih jalur parse. Backtracking ini
menghasilkan BNG-005 dan kini terkunci oleh
`tests/regression/bugs.test.js`.

---

## 9. Aturan Validasi

Parser menolak:

- `try` tanpa `catch` **dan** tanpa `finally`.
- Statement yang dimulai token tak terduga (error memuat file:baris:kolom).
- `await` di luar fungsi async.
- Import tanpa `from`.
- Import dengan specifier path relatif tanpa ekstensi.
- Named placeholder tunggal yang dipakai berulang (tidak ada di level
  bahasa; placeholder positional ada di level SQL).
