import { NodeType } from "../../../frontend/ast/index.js";
import { Scope } from "./helpers.js";
import * as bytecode from "../ops/bytecode.js";

export const statementMethods = {
  compileStatement(node) {
    switch (node.type) {
      case NodeType.EmptyStatement:
        return;
      case NodeType.FunctionDeclaration:
        if (node._hoisted) return;
        return this.compileFunctionDeclaration(node);
      case NodeType.LetDeclaration:
      case NodeType.ConstDeclaration:
      case NodeType.VarDeclaration:
        return this.compileLetDeclaration(node);
      case NodeType.IfStatement:
        return this.compileIfStatement(node);
      case NodeType.WhileStatement:
        return this.compileWhileStatement(node);
      case NodeType.ForStatement:
        return this.compileForStatement(node);
      case NodeType.ReturnStatement:
        return this.compileReturnStatement(node);
      case NodeType.BlockStatement:
        return this.compileBlock(node);
      case NodeType.ExpressionStatement:
        return this.compileExpressionStatement(node);
      case NodeType.SwitchStatement:
        return this.compileSwitchStatement(node);
      case NodeType.BreakStatement:
        return this.compileBreakStatement(node);
      case NodeType.TryStatement:
        return this.compileTryStatement(node);
      case NodeType.ThrowStatement:
        return this.compileThrowStatement(node);
      case NodeType.ClassDeclaration:
        return this.compileClassDeclaration(node);
      case NodeType.ForInStatement:
        return this.compileForInStatement(node);
      case NodeType.ForOfStatement:
        return this.compileForOfStatement(node);
      case NodeType.LazyFunctionDeclaration:
        if (node._hoisted) return;
        return this.compileLazyFunctionDeclaration(node);
      case NodeType.ObjectDestructuring:
        return this.compileObjectDestructuring(node);
      case NodeType.ArrayDestructuring:
        return this.compileArrayDestructuring(node);
      case NodeType.DoWhileStatement:
        return this.compileDoWhileStatement(node);
      case NodeType.ContinueStatement:
        return this.compileContinueStatement(node);
      case NodeType.LabeledStatement:
        return this.compileLabeledStatement(node);
      default:
        throw new Error(`[RegCompiler] Unknown statement type '${node.type}'`);
    }
  },

  compileLetDeclaration(node) {
    const isScriptVar = this.scope.isInScriptScope() && node.type === NodeType.VarDeclaration;

    if (isScriptVar) {
      if (node.init === null) return;
      this.compileExpression(node.init);
      const nameIdx = this.func.addConstant(node.name);
      this.func.emit(bytecode.ROP_STA_GLOBAL, nameIdx);
      return;
    }

    const kind =
      node.type === NodeType.ConstDeclaration
        ? "const"
        : node.type === NodeType.VarDeclaration
          ? "var"
          : "let";
    const resolved =
      kind === "var"
        ? this.scope.resolve(node.name)
        : this.scope.locals.has(node.name)
          ? this.scope.resolve(node.name)
          : null;
    const slot = resolved ? resolved.slot : this._declareLocal(node.name, kind);
    if (!resolved) {
      this.func.setLocalBindingKind(slot, kind);
    }

    if (node.type === NodeType.VarDeclaration && node.init === null) {
      return;
    }

    if (node.init !== null) {
      this.compileExpression(node.init);
    } else {
      this.func.emit(bytecode.ROP_LDA_UNDEFINED);
    }

    this.func.emit(bytecode.ROP_STAR, slot);
  },

  compileIfStatement(node) {
    this.compileExpression(node.test);
    const jumpToElse = this.func.emit(bytecode.ROP_JUMP_IF_FALSE, 0);
    this.compileStatement(node.consequent);

    if (node.alternate) {
      const jumpToEnd = this.func.emit(bytecode.ROP_JUMP, 0);
      this.func.patchJump(jumpToElse, this.func.instructions.length);
      this.compileStatement(node.alternate);
      this.func.patchJump(jumpToEnd, this.func.instructions.length);
    } else {
      this.func.patchJump(jumpToElse, this.func.instructions.length);
    }
  },

  compileWhileStatement(node) {
    const outerBreak = this._breakJumps;
    const outerContinue = this._continueJumps;
    const breakJumps = [];
    const continueJumps = [];
    this._breakJumps = breakJumps;
    this._continueJumps = continueJumps;

    const loopStart = this.func.instructions.length;
    this.compileExpression(node.test);
    const jumpToEnd = this.func.emit(bytecode.ROP_JUMP_IF_FALSE, 0);
    this.compileStatement(node.body);

    const continueTarget = this.func.instructions.length;
    this.func.emit(bytecode.ROP_JUMP, loopStart);
    const endTarget = this.func.instructions.length;
    this.func.patchJump(jumpToEnd, endTarget);
    for (const j of breakJumps) this.func.patchJump(j, endTarget);
    for (const j of continueJumps) this.func.patchJump(j, loopStart);

    this._breakJumps = outerBreak;
    this._continueJumps = outerContinue;
  },

  compileForStatement(node) {
    const outerScope = this.scope;
    this.scope = new Scope(outerScope);
    const outerBreak = this._breakJumps;
    const outerContinue = this._continueJumps;
    const breakJumps = [];
    const continueJumps = [];
    this._breakJumps = breakJumps;
    this._continueJumps = continueJumps;

    if (node.init) {
      const inits = Array.isArray(node.init) ? node.init : [node.init];
      for (const i of inits) {
        if (
          i.type === NodeType.LetDeclaration ||
          i.type === NodeType.ConstDeclaration ||
          i.type === NodeType.VarDeclaration
        ) {
          this.compileLetDeclaration(i);
        } else {
          this.compileStatement(i);
        }
      }
    }

    const loopStart = this.func.instructions.length;

    if (node.test) {
      this.compileExpression(node.test);
    } else {
      this.func.emit(bytecode.ROP_LDA_TRUE);
    }
    const jumpToEnd = this.func.emit(bytecode.ROP_JUMP_IF_FALSE, 0);

    this.compileStatement(node.body);

    const updateStart = this.func.instructions.length;
    if (node.update) {
      this.compileExpression(node.update);
    }

    this.func.emit(bytecode.ROP_JUMP, loopStart);
    const endTarget = this.func.instructions.length;
    this.func.patchJump(jumpToEnd, endTarget);
    for (const j of breakJumps) this.func.patchJump(j, endTarget);
    for (const j of continueJumps) this.func.patchJump(j, updateStart);

    this._breakJumps = outerBreak;
    this._continueJumps = outerContinue;
    this.scope = outerScope;
  },

  compileReturnStatement(node) {
    if (node.argument) {
      this.compileExpression(node.argument);
    } else {
      this.func.emit(bytecode.ROP_LDA_UNDEFINED);
    }
    if (this._finallyBlocks.length > 0) {
      var retReg = this.temps.alloc();
      this.func.emit(bytecode.ROP_STAR, retReg);
      var i = this._finallyBlocks.length - 1;
      while (i >= 0) {
        this.func.emit(bytecode.ROP_TRY_END);
        this.compileStatements(this._finallyBlocks[i].body);
        i = i - 1;
      }
      this.func.emit(bytecode.ROP_LDA_REG, retReg);
      this.temps.free(retReg);
    }
    this.func.emit(bytecode.ROP_RETURN);
  },

  compileBlock(node) {
    this.scope = new Scope(this.scope);
    this._prescanBlockScopedLocals(node.body);
    this.compileStatements(node.body);
    this.scope = this.scope.parent;
  },

  compileExpressionStatement(node) {
    this.compileExpression(node.expression);
  },

  compileSwitchStatement(node) {
    const discReg = this.temps.alloc();
    this.compileExpression(node.discriminant);
    this.func.emit(bytecode.ROP_STAR, discReg);

    const outerBreakJumps = this._breakJumps;
    const breakJumps = [];
    this._breakJumps = breakJumps;

    let defaultCase = null;

    for (const c of node.cases) {
      if (c.test === null) {
        defaultCase = c;
        continue;
      }

      this.func.emit(bytecode.ROP_LDA_REG, discReg);
      this.compileExpression(c.test);
      const tmpReg = this.temps.alloc();
      this.func.emit(bytecode.ROP_STAR, tmpReg);
      this.func.emit(bytecode.ROP_LDA_REG, discReg);
      const fbSlot = this.func.allocFeedbackSlot();
      this.func.emit(bytecode.ROP_EQ, tmpReg, fbSlot);
      this.temps.free(tmpReg);
      const skipJump = this.func.emit(bytecode.ROP_JUMP_IF_FALSE, 0);
      for (const stmt of c.consequent) {
        this.compileStatement(stmt);
      }
      breakJumps.push(this.func.emit(bytecode.ROP_JUMP, 0));
      this.func.patchJump(skipJump, this.func.instructions.length);
    }

    if (defaultCase) {
      for (const stmt of defaultCase.consequent) {
        this.compileStatement(stmt);
      }
    }

    const endTarget = this.func.instructions.length;
    for (const j of breakJumps) {
      this.func.patchJump(j, endTarget);
    }

    this.temps.free(discReg);
    this._breakJumps = outerBreakJumps;
  },

  compileBreakStatement(node) {
    if (node.label && this._labeledBreaks && this._labeledBreaks[node.label]) {
      this._labeledBreaks[node.label].push(
        this.func.emit(bytecode.ROP_JUMP, 0),
      );
    } else if (this._breakJumps) {
      this._breakJumps.push(this.func.emit(bytecode.ROP_JUMP, 0));
    }
  },

  compileTryStatement(node) {
    const hasFinally = !!node.finalizer;
    const hasCatch = !!node.handler;

    if (hasFinally) {
      this._finallyBlocks.push(node.finalizer);

      const outerTryStart = this.func.emit(bytecode.ROP_TRY_START, 0);
      const innerTryStart = this.func.emit(bytecode.ROP_TRY_START, 0);
      this.compileStatements(node.block.body);
      this.func.emit(bytecode.ROP_TRY_END);
      const jumpOverCatch = this.func.emit(bytecode.ROP_JUMP, 0);

      const catchStart = this.func.instructions.length;
      this.func.patchJump(innerTryStart, catchStart);

      if (hasCatch) {
        if (node.handler.param) {
          const resolved = this.scope.resolve(node.handler.param);
          const catchLocal = resolved
            ? resolved.slot
            : this.func.addLocal(node.handler.param);
          if (!resolved) this.scope.define(node.handler.param, catchLocal);
          this.func.emit(bytecode.ROP_STAR, catchLocal);
        }
        this.compileStatements(node.handler.body.body);
      } else {
        this.func.emit(bytecode.ROP_THROW);
      }

      const afterCatch = this.func.instructions.length;
      this.func.patchJump(jumpOverCatch, afterCatch);

      this.func.emit(bytecode.ROP_TRY_END);
      this.compileStatements(node.finalizer.body);
      const jumpPastOuter = this.func.emit(bytecode.ROP_JUMP, 0);

      const outerCatchStart = this.func.instructions.length;
      this.func.patchJump(outerTryStart, outerCatchStart);
      const exReg = this.func.allocTemp();
      this.func.emit(bytecode.ROP_STAR, exReg);
      this.compileStatements(node.finalizer.body);
      this.func.emit(bytecode.ROP_LDA_REG, exReg);
      this.func.emit(bytecode.ROP_THROW);

      const afterAll = this.func.instructions.length;
      this.func.patchJump(jumpPastOuter, afterAll);
      this._finallyBlocks.pop();
    } else {
      const tryStartIdx = this.func.emit(bytecode.ROP_TRY_START, 0);
      this.compileStatements(node.block.body);
      this.func.emit(bytecode.ROP_TRY_END);
      const jumpOverCatch = this.func.emit(bytecode.ROP_JUMP, 0);

      const catchStart = this.func.instructions.length;
      this.func.patchJump(tryStartIdx, catchStart);

      if (hasCatch) {
        if (node.handler.param) {
          const resolved = this.scope.resolve(node.handler.param);
          const catchLocal = resolved
            ? resolved.slot
            : this.func.addLocal(node.handler.param);
          if (!resolved) this.scope.define(node.handler.param, catchLocal);
          this.func.emit(bytecode.ROP_STAR, catchLocal);
        }
        this.compileStatements(node.handler.body.body);
      }

      const afterCatch = this.func.instructions.length;
      this.func.patchJump(jumpOverCatch, afterCatch);
    }
  },

  compileThrowStatement(node) {
    this.compileExpression(node.argument);
    this.func.emit(bytecode.ROP_THROW);
  },

  compileDoWhileStatement(node) {
    const outerBreak = this._breakJumps;
    const outerContinue = this._continueJumps;
    const breakJumps = [];
    const continueJumps = [];
    this._breakJumps = breakJumps;
    this._continueJumps = continueJumps;

    const loopStart = this.func.instructions.length;
    this.compileStatement(node.body);
    const continueTarget = this.func.instructions.length;
    this.compileExpression(node.test);
    this.func.emit(bytecode.ROP_JUMP_IF_TRUE, loopStart);
    const endTarget = this.func.instructions.length;
    for (const j of breakJumps) this.func.patchJump(j, endTarget);
    for (const j of continueJumps) this.func.patchJump(j, continueTarget);

    this._breakJumps = outerBreak;
    this._continueJumps = outerContinue;
  },

  compileContinueStatement(node) {
    if (
      node.label &&
      this._labeledContinues &&
      this._labeledContinues[node.label]
    ) {
      this._labeledContinues[node.label].push(
        this.func.emit(bytecode.ROP_JUMP, 0),
      );
    } else if (this._continueJumps) {
      this._continueJumps.push(this.func.emit(bytecode.ROP_JUMP, 0));
    }
  },

  compileLabeledStatement(node) {
    if (!this._labeledBreaks) this._labeledBreaks = {};
    if (!this._labeledContinues) this._labeledContinues = {};
    this._labeledBreaks[node.label] = [];
    this._labeledContinues[node.label] = [];

    this.compileStatement(node.body);

    const afterLabel = this.func.instructions.length;
    for (const jump of this._labeledBreaks[node.label]) {
      this.func.patchJump(jump, afterLabel);
    }
    delete this._labeledBreaks[node.label];
    delete this._labeledContinues[node.label];
  },
};
