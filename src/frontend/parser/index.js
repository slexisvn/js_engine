import {
  NodeType,
  Program,
  FunctionDeclaration,
  AsyncFunctionDeclaration,
  LazyFunctionDeclaration,
  LetDeclaration,
  ConstDeclaration,
  VarDeclaration,
  IfStatement,
  WhileStatement,
  ForStatement,
  ReturnStatement,
  EmptyStatement,
  BlockStatement,
  ExpressionStatement,
  AssignmentExpression,
  BinaryExpression,
  UnaryExpression,
  LogicalExpression,
  CallExpression,
  NewExpression,
  MemberExpression,
  ObjectExpression,
  ArrayExpression,
  ConditionalExpression,
  AwaitExpression,
  SwitchStatement,
  SwitchCase,
  BreakStatement,
  TryStatement,
  ThrowStatement,
  ClassDeclaration,
  ForInStatement,
  ForOfStatement,
  Identifier,
  Literal,
  ThisExpression,
  ObjectDestructuring,
  ArrayDestructuring,
  GeneratorFunctionDeclaration,
  YieldExpression,
  UpdateExpression,
  DoWhileStatement,
  ContinueStatement,
  CompoundAssignmentExpression,
  ArrowFunctionExpression,
  FunctionExpression,
  TemplateLiteral,
  OptionalMemberExpression,
  OptionalCallExpression,
  NullishCoalescingExpression,
  SpreadElement,
  LabeledStatement,
  SuperCallExpression,
  SequenceExpression,
} from "../ast/index.js";

import { Lexer, TokenType } from "../lexer/index.js";

const PRECEDENCE = {
  "??": 1,
  "||": 1,
  "&&": 2,
  "|": 3,
  "^": 4,
  "&": 5,
  "==": 6,
  "!=": 6,
  "===": 6,
  "!==": 6,
  "<": 7,
  ">": 7,
  "<=": 7,
  ">=": 7,
  instanceof: 7,
  in: 7,
  "<<": 8,
  ">>": 8,
  ">>>": 8,
  "+": 9,
  "-": 9,
  "*": 10,
  "/": 10,
  "%": 10,
  "**": 11,
};

const LOGICAL_OPS = new Set(["&&", "||"]);

const BINARY_OPS = new Set([
  "==",
  "!=",
  "===",
  "!==",
  "<",
  ">",
  "<=",
  ">=",
  "+",
  "-",
  "*",
  "/",
  "%",
  "&",
  "|",
  "^",
  "<<",
  ">>",
  ">>>",
  "**",
  "instanceof",
  "in",
]);

const COMPOUND_ASSIGN_OPS = new Set([
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "<<=",
  ">>=",
  ">>>=",
  "**=",
]);

export class Parser {
  constructor(tokens, options = {}) {
    this.tokens = tokens;
    this.pos = 0;
    this.lazy = options.lazy || false;
    this.source = options.source || null;
    this.depth = options.depth || 0;
  }

  current() {
    return this.tokens[this.pos];
  }

  peek(offset = 1) {
    return (
      this.tokens[this.pos + offset] ?? {
        type: TokenType.EOF,
        value: "",
        line: 0,
        column: 0,
      }
    );
  }

  advance() {
    const tok = this.tokens[this.pos];
    this.pos++;
    return tok;
  }

  check(type, value) {
    const tok = this.current();
    if (tok.type !== type) return false;
    if (value !== undefined && tok.value !== value) return false;
    return true;
  }

  match(type, value) {
    if (this.check(type, value)) {
      this.advance();
      return true;
    }
    return false;
  }

  expect(type, value) {
    if (this.check(type, value)) {
      return this.advance();
    }
    const tok = this.current();
    const expected = value !== undefined ? `'${value}'` : type;
    this.error(`Expected ${expected}, got '${tok.value}' (${tok.type})`, tok);
  }

  consumeSemicolon() {
    if (this.match(TokenType.Punctuator, ";")) return;
    if (this.check(TokenType.Punctuator, "}") || this.isAtEnd()) return;

    const prev = this.tokens[this.pos - 1];
    const curr = this.current();
    if (prev && curr && curr.line > prev.line) {
      return; // Automatic Semicolon Insertion (ASI) on newline
    }

    this.expect(TokenType.Punctuator, ";");
  }

  error(message, tok) {
    tok = tok ?? this.current();
    throw new SyntaxError(`[Parser] ${message} at ${tok.line}:${tok.column}`);
  }

  isAtEnd() {
    return this.current().type === TokenType.EOF;
  }

  parse() {
    return this.parseProgram();
  }

  parseProgram() {
    const body = [];
    while (!this.isAtEnd()) {
      const stmt = this.parseStatement();
      if (Array.isArray(stmt)) body.push(...stmt);
      else body.push(stmt);
    }
    return Program(body);
  }

  parseStatement() {
    const tok = this.current();

    if (tok.type === TokenType.Punctuator && tok.value === ";") {
      this.advance();
      return EmptyStatement();
    }

    if (tok.type === TokenType.Keyword) {
      switch (tok.value) {
        case "function":
          return this.parseFunctionDeclaration();
        case "async":
          if (
            this.peek().type === TokenType.Keyword &&
            this.peek().value === "function"
          ) {
            return this.parseFunctionDeclaration(true);
          }
          break;
        case "let":
          return this.parseLetDeclaration();
        case "const":
          return this.parseConstDeclaration();
        case "var":
          return this.parseVarDeclaration();
        case "if":
          return this.parseIfStatement();
        case "while":
          return this.parseWhileStatement();
        case "for":
          return this.parseForStatement();
        case "return":
          return this.parseReturnStatement();
        case "switch":
          return this.parseSwitchStatement();
        case "break":
          return this.parseBreakStatement();
        case "try":
          return this.parseTryStatement();
        case "throw":
          return this.parseThrowStatement();
        case "class":
          return this.parseClassDeclaration();
        case "do":
          return this.parseDoWhileStatement();
        case "continue":
          return this.parseContinueStatement();
      }
    }

    if (this.check(TokenType.Punctuator, "{")) {
      return this.parseBlock();
    }

    if (
      tok.type === TokenType.Identifier &&
      this.peek().type === TokenType.Punctuator &&
      this.peek().value === ":"
    ) {
      const label = this.advance().value;
      this.advance(); // skip ':'
      let body = this.parseStatement();
      if (Array.isArray(body)) body = BlockStatement(body);
      return LabeledStatement(label, body);
    }

    return this.parseExpressionStatement();
  }

  _parseParams() {
    this.expect(TokenType.Punctuator, "(");
    const params = [];
    if (!this.check(TokenType.Punctuator, ")")) {
      do {
        if (this.match(TokenType.Punctuator, "...")) {
          const name = this.expect(TokenType.Identifier).value;
          params.push({ name, rest: true });
          break;
        }
        const name = this.expect(TokenType.Identifier).value;
        if (this.match(TokenType.Punctuator, "=")) {
          const defaultValue = this.parseExpression();
          params.push({ name, default: defaultValue });
        } else {
          params.push(name);
        }
      } while (this.match(TokenType.Punctuator, ","));
    }
    this.expect(TokenType.Punctuator, ")");
    return params;
  }

  parseFunctionDeclaration(isAsync = false) {
    if (isAsync) this.expect(TokenType.Keyword, "async");
    this.expect(TokenType.Keyword, "function");
    const isGenerator = this.match(TokenType.Punctuator, "*");
    const nameToken = this.expect(TokenType.Identifier);
    const name = nameToken.value;

    const params = this._parseParams();

    if (this.lazy && this.depth > 0) {
      const bodyStartIdx = this.pos;
      this.expect(TokenType.Punctuator, "{");
      let braceCount = 1;
      while (braceCount > 0 && !this.isAtEnd()) {
        const tok = this.advance();
        if (tok.type === TokenType.Punctuator && tok.value === "{")
          braceCount++;
        else if (tok.type === TokenType.Punctuator && tok.value === "}")
          braceCount--;
      }
      const bodyEndIdx = this.pos;
      return LazyFunctionDeclaration(
        name,
        params,
        this.source,
        bodyStartIdx,
        bodyEndIdx,
      );
    }

    this.depth++;
    const body = this.parseBlock();
    this.depth--;
    if (isGenerator) return GeneratorFunctionDeclaration(name, params, body);
    if (isAsync) return AsyncFunctionDeclaration(name, params, body);
    return FunctionDeclaration(name, params, body);
  }

  parseLetDeclaration() {
    this.expect(TokenType.Keyword, "let");
    return this._parseDeclarationBody("let");
  }

  parseConstDeclaration() {
    this.expect(TokenType.Keyword, "const");
    return this._parseDeclarationBody("const");
  }

  parseVarDeclaration() {
    this.expect(TokenType.Keyword, "var");
    return this._parseDeclarationBody("var");
  }

  _parseDeclarationBody(kind) {
    const declarations = [];
    do {
      if (this.check(TokenType.Punctuator, "{")) {
        const pattern = this._parseObjectPattern();
        this.expect(TokenType.Punctuator, "=");
        const init = this.parseExpression();
        declarations.push(ObjectDestructuring(pattern, init, kind));
      } else if (this.check(TokenType.Punctuator, "[")) {
        const pattern = this._parseArrayPattern();
        this.expect(TokenType.Punctuator, "=");
        const init = this.parseExpression();
        declarations.push(ArrayDestructuring(pattern, init, kind));
      } else {
        const nameToken = this.expect(TokenType.Identifier);
        const name = nameToken.value;

        let init = null;
        if (this.match(TokenType.Punctuator, "=")) {
          init = this.parseExpression();
        } else if (kind === "const") {
          throw new Error(
            `SyntaxError: Missing initializer in const declaration for '${name}'`,
          );
        }

        declarations.push(
          kind === "const"
            ? ConstDeclaration(name, init)
            : kind === "var"
              ? VarDeclaration(name, init)
              : LetDeclaration(name, init),
        );
      }
    } while (this.match(TokenType.Punctuator, ","));

    this.consumeSemicolon();
    return declarations.length === 1 ? declarations[0] : declarations;
  }

  _parseObjectPattern() {
    this.expect(TokenType.Punctuator, "{");
    const pattern = [];
    while (!this.check(TokenType.Punctuator, "}")) {
      const keyToken = this.expect(TokenType.Identifier);
      const key = keyToken.value;
      let alias = key;
      if (this.match(TokenType.Punctuator, ":")) {
        const aliasToken = this.expect(TokenType.Identifier);
        alias = aliasToken.value;
      }
      pattern.push({ key, alias });
      if (!this.check(TokenType.Punctuator, "}")) {
        this.expect(TokenType.Punctuator, ",");
      }
    }
    this.expect(TokenType.Punctuator, "}");
    return pattern;
  }

  _parseArrayPattern() {
    this.expect(TokenType.Punctuator, "[");
    const pattern = [];
    while (!this.check(TokenType.Punctuator, "]")) {
      if (this.check(TokenType.Punctuator, ",")) {
        pattern.push(null);
      } else {
        const nameToken = this.expect(TokenType.Identifier);
        pattern.push(nameToken.value);
      }
      if (!this.check(TokenType.Punctuator, "]")) {
        this.expect(TokenType.Punctuator, ",");
      }
    }
    this.expect(TokenType.Punctuator, "]");
    return pattern;
  }

  parseIfStatement() {
    this.expect(TokenType.Keyword, "if");
    this.expect(TokenType.Punctuator, "(");
    const test = this.parseExpression();
    this.expect(TokenType.Punctuator, ")");

    let consequent = this.check(TokenType.Punctuator, "{")
      ? this.parseBlock()
      : this.parseStatement();
    if (Array.isArray(consequent)) consequent = BlockStatement(consequent);

    let alternate = null;

    if (this.match(TokenType.Keyword, "else")) {
      if (this.check(TokenType.Keyword, "if")) {
        alternate = this.parseIfStatement();
      } else if (this.check(TokenType.Punctuator, "{")) {
        alternate = this.parseBlock();
      } else {
        alternate = this.parseStatement();
        if (Array.isArray(alternate)) alternate = BlockStatement(alternate);
      }
    }

    return IfStatement(test, consequent, alternate);
  }

  parseWhileStatement() {
    this.expect(TokenType.Keyword, "while");
    this.expect(TokenType.Punctuator, "(");
    const test = this.parseExpression();
    this.expect(TokenType.Punctuator, ")");

    let body = this.check(TokenType.Punctuator, "{")
      ? this.parseBlock()
      : this.parseStatement();
    if (Array.isArray(body)) body = BlockStatement(body);
    return WhileStatement(test, body);
  }

  parseForStatement() {
    this.expect(TokenType.Keyword, "for");
    this.expect(TokenType.Punctuator, "(");

    const declKeyword = this.current();
    if (
      declKeyword.type === TokenType.Keyword &&
      (declKeyword.value === "let" ||
        declKeyword.value === "const" ||
        declKeyword.value === "var")
    ) {
      const savedPos = this.pos;
      const declKind = declKeyword.value;
      this.advance();
      if (this.check(TokenType.Identifier)) {
        const varName = this.current().value;
        const nextPos = this.pos + 1;
        const nextTok = this.tokens[nextPos];
        if (
          nextTok &&
          nextTok.type === TokenType.Keyword &&
          (nextTok.value === "in" || nextTok.value === "of")
        ) {
          this.advance();
          const kind = this.advance().value;
          const expr = this.parseExpression();
          this.expect(TokenType.Punctuator, ")");
          let body = this.check(TokenType.Punctuator, "{")
            ? this.parseBlock()
            : this.parseStatement();
          if (Array.isArray(body)) body = BlockStatement(body);
          if (kind === "in") {
            return ForInStatement(varName, expr, body, declKind);
          } else {
            return ForOfStatement(varName, expr, body, declKind);
          }
        }
      }

      this.pos = savedPos;
    }

    let init = null;
    if (this.check(TokenType.Keyword, "let")) {
      init = this.parseLetDeclaration();
    } else if (this.check(TokenType.Keyword, "const")) {
      init = this.parseConstDeclaration();
    } else if (this.check(TokenType.Keyword, "var")) {
      init = this.parseVarDeclaration();
    } else if (!this.check(TokenType.Punctuator, ";")) {
      init = ExpressionStatement(this.parseExpression());
      this.consumeSemicolon();
    } else {
      this.consumeSemicolon();
    }

    let test = null;
    if (!this.check(TokenType.Punctuator, ";")) {
      test = this.parseExpression();
    }
    this.consumeSemicolon();

    let update = null;
    if (!this.check(TokenType.Punctuator, ")")) {
      update = this.parseExpression();
    }
    this.expect(TokenType.Punctuator, ")");

    let body = this.check(TokenType.Punctuator, "{")
      ? this.parseBlock()
      : this.parseStatement();
    if (Array.isArray(body)) body = BlockStatement(body);
    return ForStatement(init, test, update, body);
  }

  parseReturnStatement() {
    this.expect(TokenType.Keyword, "return");

    let argument = null;
    if (
      !this.check(TokenType.Punctuator, ";") &&
      !this.check(TokenType.Punctuator, "}") &&
      !this.isAtEnd()
    ) {
      argument = this.parseExpression();
    }

    this.consumeSemicolon();
    return ReturnStatement(argument);
  }

  parseBlock() {
    this.expect(TokenType.Punctuator, "{");
    const body = [];
    while (!this.check(TokenType.Punctuator, "}") && !this.isAtEnd()) {
      const stmt = this.parseStatement();
      if (Array.isArray(stmt)) body.push(...stmt);
      else body.push(stmt);
    }
    this.expect(TokenType.Punctuator, "}");
    return BlockStatement(body);
  }

  parseExpressionStatement() {
    const expression = this.parseExpression();
    this.consumeSemicolon();
    return ExpressionStatement(expression);
  }

  parseExpression(minPrec = 0) {
    let left = this.parsePrimary();

    while (true) {
      const tok = this.current();

      if (tok.type === TokenType.Punctuator) {
        if (tok.value === "." && minPrec <= 12) {
          this.advance();
          const prop =
            this.check(TokenType.Identifier) || this.check(TokenType.Keyword)
              ? this.advance()
              : this.expect(TokenType.Identifier);
          left = MemberExpression(left, prop.value, false);
          continue;
        }

        if (tok.value === "?." && minPrec <= 12) {
          this.advance();
          if (this.check(TokenType.Punctuator, "(")) {
            this.advance();
            const args = [];
            if (!this.check(TokenType.Punctuator, ")")) {
              do {
                if (this.match(TokenType.Punctuator, "...")) {
                  args.push(SpreadElement(this.parseExpression()));
                } else {
                  args.push(this.parseExpression());
                }
              } while (this.match(TokenType.Punctuator, ","));
            }
            this.expect(TokenType.Punctuator, ")");
            left = OptionalCallExpression(left, args);
          } else if (this.check(TokenType.Punctuator, "[")) {
            this.advance();
            const index = this.parseExpression();
            this.expect(TokenType.Punctuator, "]");
            left = OptionalMemberExpression(left, index);
          } else {
            const prop =
              this.check(TokenType.Identifier) || this.check(TokenType.Keyword)
                ? this.advance()
                : this.expect(TokenType.Identifier);
            left = OptionalMemberExpression(left, prop.value);
          }
          continue;
        }

        if (tok.value === "(" && minPrec <= 12) {
          this.advance();
          const args = [];
          if (!this.check(TokenType.Punctuator, ")")) {
            do {
              if (this.match(TokenType.Punctuator, "...")) {
                args.push(SpreadElement(this.parseExpression()));
              } else {
                args.push(this.parseExpression());
              }
            } while (this.match(TokenType.Punctuator, ","));
          }
          this.expect(TokenType.Punctuator, ")");
          left = CallExpression(left, args);
          continue;
        }

        if (tok.value === "[" && minPrec <= 12) {
          this.advance();
          const index = this.parseExpression();
          this.expect(TokenType.Punctuator, "]");
          left = MemberExpression(left, index, true);
          continue;
        }

        if ((tok.value === "++" || tok.value === "--") && minPrec <= 12) {
          if (
            left.type !== NodeType.Identifier &&
            left.type !== NodeType.MemberExpression
          ) {
            this.error("Invalid update target", tok);
          }

          this.advance();
          left = UpdateExpression(tok.value, left, false);
          continue;
        }

        if (COMPOUND_ASSIGN_OPS.has(tok.value) && minPrec <= 0) {
          if (
            left.type !== NodeType.Identifier &&
            left.type !== NodeType.MemberExpression
          ) {
            this.error("Invalid assignment target", tok);
          }
          const op = tok.value.slice(0, -1);
          this.advance();
          const value = this.parseExpression(0);
          left = CompoundAssignmentExpression(op, left, value);
          continue;
        }

        if (tok.value === "=" && minPrec <= 0) {
          if (
            left.type !== NodeType.Identifier &&
            left.type !== NodeType.MemberExpression
          ) {
            this.error("Invalid assignment target", tok);
          }
          this.advance();
          const value = this.parseExpression(0);
          left = AssignmentExpression(left, value);
          continue;
        }

        if (tok.value === "?" && minPrec <= 0) {
          this.advance();
          const consequent = this.parseExpression();
          this.expect(TokenType.Punctuator, ":");
          const alternate = this.parseExpression();
          left = ConditionalExpression(left, consequent, alternate);
          continue;
        }

        const prec = PRECEDENCE[tok.value];
        if (prec !== undefined && prec > minPrec) {
          const op = tok.value;
          this.advance();
          const rightPrec = op === "**" ? prec - 1 : prec;
          const right = this.parseExpression(rightPrec);
          if (op === "??") {
            left = NullishCoalescingExpression(left, right);
          } else if (LOGICAL_OPS.has(op)) {
            left = LogicalExpression(op, left, right);
          } else {
            left = BinaryExpression(op, left, right);
          }
          continue;
        }
      }

      if (tok.type === TokenType.Keyword) {
        const prec = PRECEDENCE[tok.value];
        if (prec !== undefined && prec > minPrec) {
          const op = tok.value;
          this.advance();
          const right = this.parseExpression(prec);
          left = BinaryExpression(op, left, right);
          continue;
        }
      }

      break;
    }

    return left;
  }

  parsePrimary() {
    const tok = this.current();

    if (tok.type === TokenType.Number) {
      this.advance();
      return Literal(Number(tok.value), "number");
    }

    if (tok.type === TokenType.String) {
      this.advance();
      return Literal(tok.value, "string");
    }

    if (tok.type === TokenType.RegExp) {
      this.advance();
      return Literal(tok.value, "regex");
    }

    if (tok.type === TokenType.TemplateLiteral) {
      this.advance();
      const { parts, expressions: exprSources } = tok.value;
      const exprs = exprSources.map((src) => {
        const lexer = new Lexer(src);
        const tokens = lexer.tokenize();
        const parser = new Parser(tokens);
        return parser.parseExpression();
      });
      return TemplateLiteral(parts, exprs);
    }

    if (tok.type === TokenType.Keyword) {
      switch (tok.value) {
        case "true":
          this.advance();
          return Literal(true, "boolean");
        case "false":
          this.advance();
          return Literal(false, "boolean");
        case "null":
          this.advance();
          return Literal(null, "null");
        case "undefined":
          this.advance();
          return Literal(undefined, "undefined");
        case "this":
          this.advance();
          return ThisExpression();
        case "new":
          return this.parseNewExpression();
        case "typeof": {
          this.advance();
          const argument = this.parseExpression(11);
          return UnaryExpression("typeof", argument);
        }
        case "await": {
          this.advance();
          const argument = this.parseExpression(11);
          return AwaitExpression(argument);
        }
        case "yield": {
          this.advance();
          const delegate = this.match(TokenType.Punctuator, "*");

          let argument = null;
          if (
            !this.check(TokenType.Punctuator, ";") &&
            !this.check(TokenType.Punctuator, "}") &&
            !this.check(TokenType.Punctuator, ")") &&
            !this.check(TokenType.Punctuator, ",") &&
            !this.isAtEnd()
          ) {
            argument = this.parseExpression(0);
          }
          return YieldExpression(argument, delegate);
        }
        case "function":
          return this.parseFunctionExpression();
        case "super": {
          this.advance();
          this.expect(TokenType.Punctuator, "(");
          const args = [];
          if (!this.check(TokenType.Punctuator, ")")) {
            do {
              args.push(this.parseExpression(0));
            } while (this.match(TokenType.Punctuator, ","));
          }
          this.expect(TokenType.Punctuator, ")");
          return SuperCallExpression(args);
        }
      }
    }

    if (tok.type === TokenType.Identifier) {
      if (
        this.peek().type === TokenType.Punctuator &&
        this.peek().value === "=>"
      ) {
        return this.parseArrowFunction();
      }
      this.advance();
      return Identifier(tok.value);
    }

    if (this.check(TokenType.Punctuator, "(")) {
      if (this._isArrowFunction()) {
        return this.parseArrowFunction();
      }
      this.advance();
      const expr = this.parseExpression();
      if (this.check(TokenType.Punctuator, ",")) {
        const expressions = [expr];
        while (this.check(TokenType.Punctuator, ",")) {
          this.advance();
          expressions.push(this.parseExpression());
        }
        this.expect(TokenType.Punctuator, ")");
        return SequenceExpression(expressions);
      }
      this.expect(TokenType.Punctuator, ")");
      return expr;
    }

    if (this.check(TokenType.Punctuator, "{")) {
      return this.parseObjectExpression();
    }

    if (this.check(TokenType.Punctuator, "[")) {
      return this.parseArrayExpression();
    }

    if (this.check(TokenType.Punctuator, "!")) {
      this.advance();
      const argument = this.parseExpression(11);
      return UnaryExpression("!", argument);
    }

    if (this.check(TokenType.Punctuator, "-")) {
      this.advance();
      const argument = this.parseExpression(11);
      return UnaryExpression("-", argument);
    }

    if (this.check(TokenType.Punctuator, "+")) {
      this.advance();
      const argument = this.parseExpression(11);
      return UnaryExpression("+", argument);
    }

    if (this.check(TokenType.Punctuator, "~")) {
      this.advance();
      const argument = this.parseExpression(11);
      return UnaryExpression("~", argument);
    }

    if (
      this.check(TokenType.Punctuator, "++") ||
      this.check(TokenType.Punctuator, "--")
    ) {
      const op = this.advance().value;
      const argument = this.parseExpression(11);
      return UpdateExpression(op, argument, true);
    }

    if (tok.type === TokenType.Keyword && tok.value === "void") {
      this.advance();
      const argument = this.parseExpression(11);
      return UnaryExpression("void", argument);
    }

    if (tok.type === TokenType.Keyword && tok.value === "delete") {
      this.advance();
      const argument = this.parseExpression(11);
      return UnaryExpression("delete", argument);
    }

    this.error(`Unexpected token '${tok.value}' (${tok.type})`, tok);
  }

  parseSwitchStatement() {
    this.expect(TokenType.Keyword, "switch");
    this.expect(TokenType.Punctuator, "(");
    const discriminant = this.parseExpression();
    this.expect(TokenType.Punctuator, ")");
    this.expect(TokenType.Punctuator, "{");

    const cases = [];
    while (!this.check(TokenType.Punctuator, "}") && !this.isAtEnd()) {
      let test = null;
      if (this.match(TokenType.Keyword, "case")) {
        test = this.parseExpression();
        this.expect(TokenType.Punctuator, ":");
      } else if (this.match(TokenType.Keyword, "default")) {
        this.expect(TokenType.Punctuator, ":");
      } else {
        this.error("Expected case or default", this.current());
      }

      const consequent = [];
      while (
        !this.check(TokenType.Keyword, "case") &&
        !this.check(TokenType.Keyword, "default") &&
        !this.check(TokenType.Punctuator, "}") &&
        !this.isAtEnd()
      ) {
        consequent.push(this.parseStatement());
      }
      cases.push(SwitchCase(test, consequent));
    }

    this.expect(TokenType.Punctuator, "}");
    return SwitchStatement(discriminant, cases);
  }

  parseBreakStatement() {
    this.expect(TokenType.Keyword, "break");
    let label = null;
    if (this.check(TokenType.Identifier)) {
      label = this.advance().value;
    }
    this.consumeSemicolon();
    return { type: NodeType.BreakStatement, label };
  }

  parseDoWhileStatement() {
    this.expect(TokenType.Keyword, "do");
    const body = this.parseBlock();
    this.expect(TokenType.Keyword, "while");
    this.expect(TokenType.Punctuator, "(");
    const test = this.parseExpression();
    this.expect(TokenType.Punctuator, ")");
    this.consumeSemicolon();
    return DoWhileStatement(test, body);
  }

  parseContinueStatement() {
    this.expect(TokenType.Keyword, "continue");
    let label = null;
    if (this.check(TokenType.Identifier)) {
      label = this.advance().value;
    }
    this.consumeSemicolon();
    return { type: NodeType.ContinueStatement, label };
  }

  parseTryStatement() {
    this.expect(TokenType.Keyword, "try");
    const block = this.parseBlock();

    let handler = null;
    if (this.match(TokenType.Keyword, "catch")) {
      let param = null;
      if (this.match(TokenType.Punctuator, "(")) {
        const paramToken = this.expect(TokenType.Identifier);
        param = paramToken.value;
        this.expect(TokenType.Punctuator, ")");
      }
      const body = this.parseBlock();
      handler = { param, body };
    }

    let finalizer = null;
    if (this.match(TokenType.Keyword, "finally")) {
      finalizer = this.parseBlock();
    }

    if (!handler && !finalizer) {
      this.error("Missing catch or finally after try");
    }

    return TryStatement(block, handler, finalizer);
  }

  parseThrowStatement() {
    this.expect(TokenType.Keyword, "throw");
    const argument = this.parseExpression();
    this.consumeSemicolon();
    return ThrowStatement(argument);
  }

  parseClassDeclaration() {
    this.expect(TokenType.Keyword, "class");
    const nameToken = this.expect(TokenType.Identifier);
    const className = nameToken.value;

    let superClass = null;
    if (this.match(TokenType.Keyword, "extends")) {
      const superToken = this.expect(TokenType.Identifier);
      superClass = Identifier(superToken.value);
    }

    this.expect(TokenType.Punctuator, "{");

    let constructorNode = null;
    const methods = [];

    while (
      !this.check(TokenType.Punctuator, "}") &&
      !this.check(TokenType.EOF)
    ) {
      let accessorKind = null;
      const firstIdent = this.expect(TokenType.Identifier);
      let methodName;
      if (
        (firstIdent.value === "get" || firstIdent.value === "set") &&
        this.check(TokenType.Identifier)
      ) {
        accessorKind = firstIdent.value;
        methodName = this.expect(TokenType.Identifier);
      } else {
        methodName = firstIdent;
      }
      this.expect(TokenType.Punctuator, "(");
      const params = [];
      if (!this.check(TokenType.Punctuator, ")")) {
        do {
          const param = this.expect(TokenType.Identifier);
          params.push(param.value);
        } while (this.match(TokenType.Punctuator, ","));
      }
      this.expect(TokenType.Punctuator, ")");
      const body = this.parseBlock();

      const funcNode = FunctionDeclaration(methodName.value, params, body);

      if (methodName.value === "constructor" && !accessorKind) {
        constructorNode = funcNode;
      } else {
        methods.push({
          name: methodName.value,
          func: funcNode,
          kind: accessorKind,
        });
      }
    }

    this.expect(TokenType.Punctuator, "}");

    return ClassDeclaration(className, superClass, constructorNode, methods);
  }

  parseNewExpression() {
    this.expect(TokenType.Keyword, "new");
    let callee = this.parsePrimary();

    while (this.check(TokenType.Punctuator, ".")) {
      this.advance();
      const prop = this.expect(TokenType.Identifier);
      callee = MemberExpression(callee, prop.value, false);
    }

    const args = [];
    if (this.match(TokenType.Punctuator, "(")) {
      if (!this.check(TokenType.Punctuator, ")")) {
        do {
          if (this.match(TokenType.Punctuator, "...")) {
            args.push(SpreadElement(this.parseExpression()));
          } else {
            args.push(this.parseExpression());
          }
        } while (this.match(TokenType.Punctuator, ","));
      }
      this.expect(TokenType.Punctuator, ")");
    }

    return NewExpression(callee, args);
  }

  parseObjectExpression() {
    this.expect(TokenType.Punctuator, "{");
    const properties = [];

    while (!this.check(TokenType.Punctuator, "}") && !this.isAtEnd()) {
      if (this.match(TokenType.Punctuator, "...")) {
        const argument = this.parseExpression();
        properties.push({ spread: true, argument });
      } else {
        let key;
        let computed = false;
        if (this.match(TokenType.Punctuator, "[")) {
          key = this.parseExpression();
          this.expect(TokenType.Punctuator, "]");
          computed = true;
        } else if (this.check(TokenType.Identifier)) {
          key = this.advance().value;
        } else if (this.check(TokenType.String)) {
          key = this.advance().value;
        } else if (this.check(TokenType.Number)) {
          key = String(this.advance().value);
        } else {
          this.error("Expected property name", this.current());
        }

        let value;
        let kind;
        if (
          !computed &&
          (key === "get" || key === "set") &&
          !this.check(TokenType.Punctuator, "(") &&
          !this.check(TokenType.Punctuator, ":") &&
          !this.check(TokenType.Punctuator, ",") &&
          !this.check(TokenType.Punctuator, "}")
        ) {
          kind = key;
          if (this.check(TokenType.Punctuator, "[")) {
            this.advance();
            key = this.parseExpression();
            this.expect(TokenType.Punctuator, "]");
            computed = true;
          } else {
            key = this.advance().value;
          }
          const params = this._parseParams();
          const body = this.parseBlock();
          value = FunctionExpression(computed ? null : key, params, body);
        } else if (this.check(TokenType.Punctuator, "(")) {
          const params = this._parseParams();
          const body = this.parseBlock();
          const name = computed ? null : key;
          value = FunctionExpression(name, params, body);
        } else if (this.match(TokenType.Punctuator, ":")) {
          value = this.parseExpression();
        } else {
          value = Identifier(key);
        }
        properties.push({ key, value, computed, kind });
      }

      if (!this.check(TokenType.Punctuator, "}")) {
        this.expect(TokenType.Punctuator, ",");
      }
    }

    this.expect(TokenType.Punctuator, "}");
    return ObjectExpression(properties);
  }

  _isArrowFunction() {
    const savedPos = this.pos;
    try {
      this.advance(); // skip (
      let depth = 1;
      while (depth > 0 && !this.isAtEnd()) {
        const t = this.advance();
        if (t.type === TokenType.Punctuator && t.value === "(") depth++;
        else if (t.type === TokenType.Punctuator && t.value === ")") depth--;
      }
      return this.check(TokenType.Punctuator, "=>");
    } finally {
      this.pos = savedPos;
    }
  }

  parseArrowFunction() {
    let params;
    if (this.check(TokenType.Identifier)) {
      params = [this.advance().value];
    } else {
      params = this._parseParams();
    }
    this.expect(TokenType.Punctuator, "=>");

    if (this.check(TokenType.Punctuator, "{")) {
      const body = this.parseBlock();
      return ArrowFunctionExpression(params, body, false);
    }
    const expr = this.parseExpression();
    return ArrowFunctionExpression(params, expr, true);
  }

  parseFunctionExpression() {
    this.expect(TokenType.Keyword, "function");
    let name = null;
    if (this.check(TokenType.Identifier)) {
      name = this.advance().value;
    }
    const params = this._parseParams();
    const body = this.parseBlock();
    return FunctionExpression(name, params, body);
  }

  parseArrayExpression() {
    this.expect(TokenType.Punctuator, "[");
    const elements = [];

    while (!this.check(TokenType.Punctuator, "]") && !this.isAtEnd()) {
      if (this.match(TokenType.Punctuator, "...")) {
        elements.push(SpreadElement(this.parseExpression()));
      } else {
        elements.push(this.parseExpression());
      }
      if (!this.check(TokenType.Punctuator, "]")) {
        this.expect(TokenType.Punctuator, ",");
      }
    }

    this.expect(TokenType.Punctuator, "]");
    return ArrayExpression(elements);
  }
}

export function parse(source, options = {}) {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens, {
    ...options,
    source: options.lazy ? source : null,
  });
  return parser.parse();
}
