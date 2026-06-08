import { NodeType } from "../../../frontend/ast/index.js";

export const scopeMethods = {
  _declareLocal(name, kind = "let") {
    if (this.scope.locals.has(name)) {
      return this.scope.locals.get(name);
    }
    const slot = this.func.addLocal(name);
    this.func.setLocalBindingKind(slot, kind);
    if (kind === "const") {
      this.scope.defineConst(name, slot);
    } else if (kind === "var") {
      this.scope.defineVar(name, slot);
    } else if (kind === "function") {
      this.scope.defineFunction(name, slot);
    } else {
      this.scope.define(name, slot);
    }
    return slot;
  },

  _declareLexical(name, kind) {
    return this._declareLocal(name, kind);
  },

  _prescanLocals(statements) {
    for (const stmt of statements) {
      this._prescanStatement(stmt);
    }
  },

  _prescanBlockScopedLocals(statements) {
    for (const stmt of statements) {
      if (stmt.type === NodeType.LetDeclaration) {
        this._declareLexical(stmt.name, "let");
      } else if (stmt.type === NodeType.ConstDeclaration) {
        this._declareLexical(stmt.name, "const");
      } else if (stmt.type === NodeType.ObjectDestructuring) {
        for (const { alias } of stmt.pattern) {
          this._declareLexical(alias, stmt.kind === "const" ? "const" : "let");
        }
      } else if (stmt.type === NodeType.ArrayDestructuring) {
        for (const name of stmt.pattern) {
          if (name !== null) {
            this._declareLexical(name, stmt.kind === "const" ? "const" : "let");
          }
        }
      }
    }
  },

  _prescanStatement(node) {
    switch (node.type) {
      case NodeType.EmptyStatement:
        break;
      case NodeType.LetDeclaration:
      case NodeType.ConstDeclaration: {
        this._declareLexical(
          node.name,
          node.type === NodeType.ConstDeclaration ? "const" : "let",
        );
        break;
      }
      case NodeType.VarDeclaration: {
        if (this.scope.isScript) {
          if (!this.func.hoistedVarNames) this.func.hoistedVarNames = [];
          if (!this.func.hoistedVarNames.includes(node.name)) {
            this.func.hoistedVarNames.push(node.name);
          }
        } else {
          this._declareLocal(node.name, "var");
        }
        break;
      }
      case NodeType.FunctionDeclaration:
      case NodeType.LazyFunctionDeclaration: {
        if (!this.scope.isScript) {
          this._declareLocal(node.name, "function");
        }
        break;
      }
      case NodeType.ForInStatement: {
        this._declareLocal("_keys$", "var");
        this._declareLocal("_i$", "var");
        this._declareLocal("_len$", "var");
        if (this.scope.isScript && node.kind === "var") {
          if (!this.func.hoistedVarNames) this.func.hoistedVarNames = [];
          if (!this.func.hoistedVarNames.includes(node.variable)) {
            this.func.hoistedVarNames.push(node.variable);
          }
        } else {
          this._declareLocal(
            node.variable,
            node.kind === "const" ? "const" : node.kind === "var" ? "var" : "let",
          );
        }
        break;
      }
      case NodeType.ForOfStatement: {
        this._declareLocal("_iter$", "var");
        this._declareLocal("_iterResult$", "var");
        if (this.scope.isScript && node.kind === "var") {
          if (!this.func.hoistedVarNames) this.func.hoistedVarNames = [];
          if (!this.func.hoistedVarNames.includes(node.variable)) {
            this.func.hoistedVarNames.push(node.variable);
          }
        } else {
          this._declareLocal(
            node.variable,
            node.kind === "const" ? "const" : node.kind === "var" ? "var" : "let",
          );
        }
        break;
      }
      case NodeType.ObjectDestructuring: {
        this._declareLocal("_destruct$", "var");
        for (const { alias } of node.pattern) {
          this._declareLocal(alias, node.kind === "const" ? "const" : "let");
        }
        break;
      }
      case NodeType.ArrayDestructuring: {
        this._declareLocal("_destruct$", "var");
        for (const name of node.pattern) {
          if (name === null) continue;
          this._declareLocal(name, node.kind === "const" ? "const" : "let");
        }
        break;
      }
      case NodeType.ForStatement: {
        if (
          node.init &&
          (node.init.type === NodeType.LetDeclaration ||
            node.init.type === NodeType.ConstDeclaration ||
            (node.init.type === NodeType.VarDeclaration && !this.scope.isScript))
        ) {
          this._declareLocal(
            node.init.name,
            node.init.type === NodeType.ConstDeclaration
              ? "const"
              : node.init.type === NodeType.VarDeclaration
                ? "var"
                : "let",
          );
        }
        break;
      }
      case NodeType.TryStatement: {
        if (node.handler && node.handler.param) {
          this._declareLocal(node.handler.param, "let");
        }
        break;
      }
      case NodeType.LabeledStatement:
        this._prescanStatement(node.body);
        break;
      default:
        break;
    }
  },

  _hoistVars(statements) {
    for (const stmt of statements) {
      this._hoistVarsFromNode(stmt);
    }
  },

  _hoistVarsFromNode(node) {
    if (!node) return;
    switch (node.type) {
      case NodeType.EmptyStatement:
        break;
      case NodeType.VarDeclaration: {
        if (this.scope.isScript) {
          if (!this.func.hoistedVarNames) this.func.hoistedVarNames = [];
          if (!this.func.hoistedVarNames.includes(node.name)) {
            this.func.hoistedVarNames.push(node.name);
          }
        } else if (!this.scope.locals.has(node.name)) {
          this._declareLocal(node.name, "var");
        }
        break;
      }
      case NodeType.BlockStatement:
        this._hoistVars(node.body);
        break;
      case NodeType.IfStatement:
        this._hoistVarsFromNode(node.consequent);
        if (node.alternate) this._hoistVarsFromNode(node.alternate);
        break;
      case NodeType.WhileStatement:
        this._hoistVarsFromNode(node.body);
        break;
      case NodeType.ForStatement:
        if (node.init && node.init.type === NodeType.VarDeclaration) {
          this._hoistVarsFromNode(node.init);
        }
        this._hoistVarsFromNode(node.body);
        break;
      case NodeType.ForInStatement:
      case NodeType.ForOfStatement:
        this._hoistVarsFromNode(node.body);
        break;
      case NodeType.TryStatement:
        if (node.block) this._hoistVarsFromNode(node.block);
        if (node.handler && node.handler.body)
          this._hoistVarsFromNode(node.handler.body);
        if (node.finalizer) this._hoistVarsFromNode(node.finalizer);
        break;
      case NodeType.SwitchStatement:
        for (const c of node.cases || []) {
          for (const s of c.consequent || []) {
            this._hoistVarsFromNode(s);
          }
        }
        break;
      case NodeType.LabeledStatement:
        this._hoistVarsFromNode(node.body);
        break;
      default:
        break;
    }
  },

  _emitHoistedFunctionDeclarations(statements) {
    for (const stmt of statements) {
      if (
        stmt.type === NodeType.FunctionDeclaration ||
        stmt.type === NodeType.LazyFunctionDeclaration
      ) {
        stmt._hoisted = true;
        if (stmt.type === NodeType.LazyFunctionDeclaration) {
          this.compileLazyFunctionDeclaration(stmt);
        } else {
          this.compileFunctionDeclaration(stmt);
        }
      }
    }
  },

  _prepareFunctionBody(statements) {
    this._hoistVars(statements);
    this._prescanLocals(statements);
    this._emitHoistedFunctionDeclarations(statements);
  },
};
