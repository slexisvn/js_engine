export const TokenType = {
  Number: "Number",
  String: "String",
  Identifier: "Identifier",
  Keyword: "Keyword",
  Punctuator: "Punctuator",
  RegExp: "RegExp",
  TemplateLiteral: "TemplateLiteral",
  EOF: "EOF",
};

const KEYWORDS = new Set([
  "let",
  "const",
  "var",
  "function",
  "if",
  "else",
  "while",
  "for",
  "do",
  "return",
  "true",
  "false",
  "null",
  "undefined",
  "new",
  "this",
  "typeof",
  "instanceof",
  "switch",
  "case",
  "default",
  "break",
  "continue",
  "try",
  "catch",
  "finally",
  "throw",
  "class",
  "extends",
  "super",
  "in",
  "of",
  "async",
  "await",
  "yield",
  "delete",
  "void",
]);

const MULTI_CHAR_PUNCTUATORS = [
  ">>>=",
  "**=",
  "...",
  "===",
  "!==",
  ">>>",
  "<<=",
  ">>=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "??",
  "?.",
  "++",
  "--",
  "**",
  "<<",
  ">>",
  "=>",
];

const SINGLE_CHAR_PUNCTUATORS = new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
  "<",
  ">",
  "!",
  "=",
  ".",
  ",",
  ";",
  "(",
  ")",
  "{",
  "}",
  "[",
  "]",
  ":",
  "?",
  "&",
  "|",
  "^",
  "~",
]);

function makeToken(type, value, line, column) {
  return { type, value, line, column };
}

export class Lexer {
  constructor(source) {
    this.source = source;
    this.pos = 0;
    this.line = 1;
    this.column = 1;
    this.length = source.length;
    this.lastToken = null;
  }

  peek() {
    return this.pos < this.length ? this.source[this.pos] : "\0";
  }

  peekAhead(n = 1) {
    const idx = this.pos + n;
    return idx < this.length ? this.source[idx] : "\0";
  }

  advance() {
    const ch = this.source[this.pos];
    this.pos++;
    if (ch === "\n") {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  match(expected) {
    if (this.peek() === expected) {
      this.advance();
      return true;
    }
    return false;
  }

  isAtEnd() {
    return this.pos >= this.length;
  }

  skipWhitespaceAndComments() {
    while (!this.isAtEnd()) {
      const ch = this.peek();

      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        this.advance();
        continue;
      }

      if (ch === "/" && this.peekAhead() === "/") {
        this.advance();
        this.advance();
        while (!this.isAtEnd() && this.peek() !== "\n") {
          this.advance();
        }
        continue;
      }

      break;
    }
  }

  scanNumber() {
    const startLine = this.line;
    const startCol = this.column;
    let value = "";

    const first = this.advance();
    value += first;

    // Check for 0x, 0b, 0o prefixes
    if (first === "0" && !this.isAtEnd()) {
      const next = this.peek();
      if (next === "x" || next === "X") {
        value += this.advance(); // consume 'x'
        while (!this.isAtEnd() && isHexDigit(this.peek())) {
          value += this.advance();
        }
        return makeToken(TokenType.Number, value, startLine, startCol);
      }
      if (next === "b" || next === "B") {
        value += this.advance(); // consume 'b'
        while (
          !this.isAtEnd() &&
          (this.peek() === "0" || this.peek() === "1")
        ) {
          value += this.advance();
        }
        return makeToken(TokenType.Number, value, startLine, startCol);
      }
      if (next === "o" || next === "O") {
        value += this.advance(); // consume 'o'
        while (!this.isAtEnd() && this.peek() >= "0" && this.peek() <= "7") {
          value += this.advance();
        }
        return makeToken(TokenType.Number, value, startLine, startCol);
      }
    }

    // Decimal digits
    while (!this.isAtEnd() && isDigit(this.peek())) {
      value += this.advance();
    }

    // Decimal point
    if (this.peek() === "." && isDigit(this.peekAhead())) {
      value += this.advance();
      while (!this.isAtEnd() && isDigit(this.peek())) {
        value += this.advance();
      }
    }

    // Scientific notation (e.g., 1e5, 1.5e-3, 2E+10)
    if (!this.isAtEnd() && (this.peek() === "e" || this.peek() === "E")) {
      value += this.advance(); // consume 'e'/'E'
      if (!this.isAtEnd() && (this.peek() === "+" || this.peek() === "-")) {
        value += this.advance(); // consume sign
      }
      while (!this.isAtEnd() && isDigit(this.peek())) {
        value += this.advance();
      }
    }

    return makeToken(TokenType.Number, value, startLine, startCol);
  }

  scanString() {
    const startLine = this.line;
    const startCol = this.column;

    this.advance();
    let value = "";

    while (!this.isAtEnd() && this.peek() !== '"') {
      if (this.peek() === "\\") {
        this.advance();
        const esc = this.advance();
        switch (esc) {
          case "n":
            value += "\n";
            break;
          case "t":
            value += "\t";
            break;
          case "r":
            value += "\r";
            break;
          case "\\":
            value += "\\";
            break;
          case '"':
            value += '"';
            break;
          default:
            value += esc;
            break;
        }
      } else {
        value += this.advance();
      }
    }

    if (this.isAtEnd()) {
      this.error("Unterminated string literal", startLine, startCol);
    }

    this.advance();
    return makeToken(TokenType.String, value, startLine, startCol);
  }

  scanSingleQuoteString() {
    const startLine = this.line;
    const startCol = this.column;
    this.advance();
    let value = "";
    while (!this.isAtEnd() && this.peek() !== "'") {
      if (this.peek() === "\\") {
        this.advance();
        const esc = this.advance();
        switch (esc) {
          case "n":
            value += "\n";
            break;
          case "t":
            value += "\t";
            break;
          case "r":
            value += "\r";
            break;
          case "\\":
            value += "\\";
            break;
          case "'":
            value += "'";
            break;
          default:
            value += esc;
            break;
        }
      } else {
        value += this.advance();
      }
    }
    if (this.isAtEnd())
      this.error("Unterminated string literal", startLine, startCol);
    this.advance();
    return makeToken(TokenType.String, value, startLine, startCol);
  }

  scanTemplateLiteral() {
    const startLine = this.line;
    const startCol = this.column;
    this.advance();
    const parts = [];
    const expressions = [];
    let current = "";

    while (!this.isAtEnd()) {
      const ch = this.peek();
      if (ch === "`") {
        this.advance();
        parts.push(current);
        return makeToken(
          TokenType.TemplateLiteral,
          { parts, expressions },
          startLine,
          startCol,
        );
      }
      if (ch === "$" && this.peekAhead() === "{") {
        parts.push(current);
        current = "";
        this.advance();
        this.advance();
        let depth = 1;
        let exprSource = "";
        while (!this.isAtEnd() && depth > 0) {
          const c = this.peek();
          if (c === "{") depth++;
          else if (c === "}") {
            depth--;
            if (depth === 0) {
              this.advance();
              break;
            }
          }
          exprSource += this.advance();
        }
        expressions.push(exprSource);
        continue;
      }
      if (ch === "\\") {
        this.advance();
        const esc = this.advance();
        switch (esc) {
          case "n":
            current += "\n";
            break;
          case "t":
            current += "\t";
            break;
          case "r":
            current += "\r";
            break;
          case "\\":
            current += "\\";
            break;
          case "`":
            current += "`";
            break;
          case "$":
            current += "$";
            break;
          default:
            current += esc;
            break;
        }
        continue;
      }
      current += this.advance();
    }
    this.error("Unterminated template literal", startLine, startCol);
  }

  scanIdentifier() {
    const startLine = this.line;
    const startCol = this.column;
    let value = "";

    while (!this.isAtEnd() && isIdentChar(this.peek())) {
      value += this.advance();
    }

    const type = KEYWORDS.has(value) ? TokenType.Keyword : TokenType.Identifier;
    return makeToken(type, value, startLine, startCol);
  }

  canStartRegex() {
    if (!this.lastToken) return true;
    if (
      this.lastToken.type === TokenType.Number ||
      this.lastToken.type === TokenType.String
    )
      return false;
    if (this.lastToken.type === TokenType.Identifier) return false;
    if (this.lastToken.type === TokenType.Keyword) {
      const v = this.lastToken.value;
      if (
        v === "true" ||
        v === "false" ||
        v === "null" ||
        v === "undefined" ||
        v === "this"
      )
        return false;
      return true;
    }
    if (this.lastToken.type === TokenType.Punctuator) {
      const v = this.lastToken.value;
      if (v === ")" || v === "]") return false;
      return true;
    }
    return true;
  }

  scanRegex() {
    const startLine = this.line;
    const startCol = this.column;
    this.advance();
    let pattern = "";
    let inCharClass = false;
    while (!this.isAtEnd()) {
      const ch = this.peek();
      if (ch === "\\") {
        pattern += this.advance();
        if (!this.isAtEnd()) pattern += this.advance();
        continue;
      }
      if (inCharClass) {
        if (ch === "]") inCharClass = false;
        pattern += this.advance();
        continue;
      }
      if (ch === "[") {
        inCharClass = true;
        pattern += this.advance();
        continue;
      }
      if (ch === "/") {
        this.advance();
        break;
      }
      if (ch === "\n") {
        this.error("Unterminated regex literal", startLine, startCol);
      }
      pattern += this.advance();
    }
    let flags = "";
    while (!this.isAtEnd() && isIdentChar(this.peek())) {
      flags += this.advance();
    }
    return makeToken(TokenType.RegExp, { pattern, flags }, startLine, startCol);
  }

  scanPunctuator() {
    const startLine = this.line;
    const startCol = this.column;

    for (const punct of MULTI_CHAR_PUNCTUATORS) {
      if (this.source.startsWith(punct, this.pos)) {
        for (let i = 0; i < punct.length; i++) {
          this.advance();
        }
        return makeToken(TokenType.Punctuator, punct, startLine, startCol);
      }
    }

    const ch = this.peek();
    if (SINGLE_CHAR_PUNCTUATORS.has(ch)) {
      this.advance();
      return makeToken(TokenType.Punctuator, ch, startLine, startCol);
    }

    this.error(`Unexpected character '${ch}'`, startLine, startCol);
  }

  nextToken() {
    this.skipWhitespaceAndComments();

    if (this.isAtEnd()) {
      return makeToken(TokenType.EOF, "", this.line, this.column);
    }

    const ch = this.peek();
    let token;

    if (isDigit(ch)) {
      token = this.scanNumber();
    } else if (ch === '"') {
      token = this.scanString();
    } else if (ch === "'") {
      token = this.scanSingleQuoteString();
    } else if (ch === "`") {
      token = this.scanTemplateLiteral();
    } else if (isIdentStart(ch)) {
      token = this.scanIdentifier();
    } else if (ch === "/" && this.canStartRegex()) {
      token = this.scanRegex();
    } else {
      token = this.scanPunctuator();
    }

    this.lastToken = token;
    return token;
  }

  tokenize() {
    const tokens = [];
    while (true) {
      const token = this.nextToken();
      tokens.push(token);
      if (token.type === TokenType.EOF) break;
    }
    return tokens;
  }

  error(message, line, column) {
    throw new SyntaxError(
      `[Lexer] ${message} at ${line ?? this.line}:${column ?? this.column}`,
    );
  }
}

function isDigit(ch) {
  return ch >= "0" && ch <= "9";
}

function isHexDigit(ch) {
  return (
    (ch >= "0" && ch <= "9") ||
    (ch >= "a" && ch <= "f") ||
    (ch >= "A" && ch <= "F")
  );
}

function isIdentStart(ch) {
  return (
    (ch >= "a" && ch <= "z") ||
    (ch >= "A" && ch <= "Z") ||
    ch === "_" ||
    ch === "$"
  );
}

function isIdentChar(ch) {
  return isIdentStart(ch) || isDigit(ch);
}
