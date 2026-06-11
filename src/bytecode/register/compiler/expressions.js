import { NodeType } from "../../../frontend/ast/index.js";
import * as bytecode from "../ops/bytecode.js";

export const BINARY_OP_MAP = {
  "+": bytecode.ROP_ADD,
  "-": bytecode.ROP_SUB,
  "*": bytecode.ROP_MUL,
  "/": bytecode.ROP_DIV,
  "%": bytecode.ROP_MOD,
  "===": bytecode.ROP_EQ,
  "!==": bytecode.ROP_NEQ,
  "<": bytecode.ROP_LT,
  ">": bytecode.ROP_GT,
  "<=": bytecode.ROP_LTE,
  ">=": bytecode.ROP_GTE,
  "&": bytecode.ROP_BITAND,
  "|": bytecode.ROP_BITOR,
  "^": bytecode.ROP_BITXOR,
  "<<": bytecode.ROP_SHL,
  ">>": bytecode.ROP_SHR,
  ">>>": bytecode.ROP_USHR,
  "**": bytecode.ROP_POW,
  instanceof: bytecode.ROP_INSTANCEOF,
  in: bytecode.ROP_IN,
  "==": bytecode.ROP_LOOSE_EQ,
  "!=": bytecode.ROP_LOOSE_NEQ,
};

export const expressionMethods = {
  compileExpression(node) {
    switch (node.type) {
      case NodeType.Literal:
        return this.compileLiteral(node);
      case NodeType.Identifier:
        return this.compileIdentifier(node);
      case NodeType.ThisExpression:
        return this.func.emit(bytecode.ROP_LDA_THIS);
      case NodeType.BinaryExpression:
        return this.compileBinaryExpression(node);
      case NodeType.UnaryExpression:
        return this.compileUnaryExpression(node);
      case NodeType.LogicalExpression:
        return this.compileLogicalExpression(node);
      case NodeType.AssignmentExpression:
        return this.compileAssignment(node);
      case NodeType.CallExpression:
        return this.compileCallExpression(node);
      case NodeType.NewExpression:
        return this.compileNewExpression(node);
      case NodeType.MemberExpression:
        return this.compileMemberExpression(node);
      case NodeType.ObjectExpression:
        return this.compileObjectExpression(node);
      case NodeType.ArrayExpression:
        return this.compileArrayExpression(node);
      case NodeType.ConditionalExpression:
        return this.compileConditionalExpression(node);
      case NodeType.AwaitExpression:
        return this.compileAwaitExpression(node);
      case NodeType.YieldExpression:
        return this.compileYieldExpression(node);
      case NodeType.UpdateExpression:
        return this.compileUpdateExpression(node);
      case NodeType.CompoundAssignmentExpression:
        return this.compileCompoundAssignment(node);
      case NodeType.ArrowFunctionExpression:
        return this.compileArrowFunction(node);
      case NodeType.FunctionExpression:
        return this.compileFunctionExpression(node);
      case NodeType.TemplateLiteral:
        return this.compileTemplateLiteral(node);
      case NodeType.NullishCoalescingExpression:
        return this.compileNullishCoalescing(node);
      case NodeType.OptionalMemberExpression:
        return this.compileOptionalMember(node);
      case NodeType.OptionalCallExpression:
        return this.compileOptionalCall(node);
      case NodeType.SuperCallExpression:
        return this.compileSuperCall(node);
      case NodeType.SequenceExpression:
        return this.compileSequenceExpression(node);
      default:
        throw new Error(`[RegCompiler] Unknown expression type '${node.type}'`);
    }
  },

  compileSequenceExpression(node) {
    for (let i = 0; i < node.expressions.length; i++) {
      this.compileExpression(node.expressions[i]);
    }
  },

  compileLiteral(node) {
    switch (node.kind) {
      case "boolean":
        return this.func.emit(
          node.value ? bytecode.ROP_LDA_TRUE : bytecode.ROP_LDA_FALSE,
        );
      case "null":
        return this.func.emit(bytecode.ROP_LDA_NULL);
      case "undefined":
        return this.func.emit(bytecode.ROP_LDA_UNDEFINED);
      case "regex": {
        const idx = this.func.addConstant(node.value);
        return this.func.emit(bytecode.ROP_NEW_REGEX, idx);
      }
      default: {
        const idx = this.func.addConstant(node.value);
        return this.func.emit(bytecode.ROP_LDA_CONST, idx);
      }
    }
  },

  emitLoadToAcc(resolved) {
    if (resolved.type === "local") {
      this.func.emit(bytecode.ROP_LDA_REG, resolved.slot);
    } else if (resolved.type === "upvalue") {
      this.func.emit(bytecode.ROP_LDA_UPVALUE, resolved.slot);
    }
  },

  emitStoreAcc(resolved) {
    if (resolved.type === "local") {
      this.func.emit(bytecode.ROP_STAR, resolved.slot);
    } else if (resolved.type === "upvalue") {
      this.func.emit(bytecode.ROP_STA_UPVALUE, resolved.slot);
    }
  },

  compileIdentifier(node) {
    const resolved = this.scope.resolve(node.name);
    if (resolved !== null) {
      this.emitLoadToAcc(resolved);
    } else {
      const nameIdx = this.func.addConstant(node.name);
      this.func.emit(bytecode.ROP_LDA_GLOBAL, nameIdx);
    }
  },

  compileBinaryExpression(node) {
    const tmp = this.temps.alloc();
    this.compileExpression(node.left);
    this.func.emit(bytecode.ROP_STAR, tmp);

    this.compileExpression(node.right);

    const tmp2 = this.temps.alloc();
    this.func.emit(bytecode.ROP_STAR, tmp2);
    this.func.emit(bytecode.ROP_LDA_REG, tmp);

    const opcode = BINARY_OP_MAP[node.op];
    if (opcode === undefined) {
      throw new Error(`[RegCompiler] Unknown binary operator '${node.op}'`);
    }

    const fbSlot = this.func.allocFeedbackSlot();
    this.func.emit(opcode, tmp2, fbSlot);

    this.temps.free(tmp2);
    this.temps.free(tmp);
  },

  compileUnaryExpression(node) {
    this.compileExpression(node.argument);
    switch (node.op) {
      case "!": {
        const fbSlot = this.func.allocFeedbackSlot();
        this.func.emit(bytecode.ROP_NOT, fbSlot);
        break;
      }
      case "-": {
        const fbSlot = this.func.allocFeedbackSlot();
        this.func.emit(bytecode.ROP_NEG, fbSlot);
        break;
      }
      case "+": {
        this.func.emit(bytecode.ROP_NEG, this.func.allocFeedbackSlot());
        this.func.emit(bytecode.ROP_NEG, this.func.allocFeedbackSlot());
        break;
      }
      case "typeof":
        this.func.emit(bytecode.ROP_TYPEOF);
        break;
      case "~": {
        const fbSlot = this.func.allocFeedbackSlot();
        this.func.emit(bytecode.ROP_BITNOT, fbSlot);
        break;
      }
      case "void":
        this.func.emit(bytecode.ROP_VOID);
        break;
      case "delete": {
        if (node.argument.type === NodeType.MemberExpression) {
          var objReg = this.temps.alloc();
          this.compileExpression(node.argument.object);
          this.func.emit(bytecode.ROP_STAR, objReg);
          if (node.argument.computed) {
            var keyReg = this.temps.alloc();
            this.compileExpression(node.argument.property);
            this.func.emit(bytecode.ROP_STAR, keyReg);
            this.func.emit(bytecode.ROP_DELETE_PROP, objReg, 0, keyReg);
            this.temps.free(keyReg);
          } else {
            var propIdx = this.func.addConstant(node.argument.property);
            this.func.emit(bytecode.ROP_DELETE_PROP, objReg, propIdx);
          }
          this.temps.free(objReg);
          return;
        }
        this.func.emit(bytecode.ROP_LDA_TRUE);
        break;
      }
      default:
        throw new Error(`[RegCompiler] Unknown unary operator '${node.op}'`);
    }
  },

  compileLogicalExpression(node) {
    this.compileExpression(node.left);

    if (node.op === "&&") {
      const jumpToEnd = this.func.emit(bytecode.ROP_JUMP_IF_FALSE, 0);
      this.compileExpression(node.right);
      this.func.patchJump(jumpToEnd, this.func.instructions.length);
    } else if (node.op === "||") {
      const jumpToEnd = this.func.emit(bytecode.ROP_JUMP_IF_TRUE, 0);
      this.compileExpression(node.right);
      this.func.patchJump(jumpToEnd, this.func.instructions.length);
    } else {
      throw new Error(`[RegCompiler] Unknown logical operator '${node.op}'`);
    }
  },

  compileAssignment(node) {
    const target = node.target;

    if (target.type === NodeType.Identifier) {
      if (this.scope.isConst(target.name)) {
        throw new Error(`Assignment to constant variable '${target.name}'`);
      }
      this.compileExpression(node.value);

      const resolved = this.scope.resolve(target.name);
      if (resolved !== null) {
        this.emitStoreAcc(resolved);
      } else {
        const nameIdx = this.func.addConstant(target.name);
        this.func.emit(bytecode.ROP_STA_GLOBAL, nameIdx);
      }
    } else if (target.type === NodeType.MemberExpression) {
      if (typeof target.property === "string") {
        const objReg = this.temps.alloc();
        this.compileExpression(target.object);
        this.func.emit(bytecode.ROP_STAR, objReg);

        this.compileExpression(node.value);
        const propIdx = this.func.addConstant(target.property);
        const fbSlot = this.func.allocFeedbackSlot();
        this.func.emit(bytecode.ROP_STA_PROP, objReg, propIdx, fbSlot);
        this.temps.free(objReg);
      } else {
        const objReg = this.temps.alloc();
        this.compileExpression(target.object);
        this.func.emit(bytecode.ROP_STAR, objReg);

        const idxReg = this.temps.alloc();
        this.compileExpression(target.property);
        this.func.emit(bytecode.ROP_STAR, idxReg);

        this.compileExpression(node.value);
        const fbSlot = this.func.allocFeedbackSlot();
        this.func.emit(bytecode.ROP_STA_INDEX, objReg, idxReg, fbSlot);

        this.temps.free(idxReg);
        this.temps.free(objReg);
      }
    } else {
      throw new Error(
        `[RegCompiler] Invalid assignment target type '${target.type}'`,
      );
    }
  },

  _buildSpreadArgs(args) {
    this.func.emit(bytecode.ROP_NEW_ARRAY, 0, 0);
    const arrReg = this.temps.alloc();
    this.func.emit(bytecode.ROP_STAR, arrReg);
    for (const arg of args) {
      if (arg.type === NodeType.SpreadElement) {
        this.compileExpression(arg.argument);
        this.func.emit(bytecode.ROP_SPREAD_ARRAY, arrReg);
      } else {
        this.compileExpression(arg);
        this.func.emit(bytecode.ROP_ARRAY_PUSH, arrReg);
      }
    }
    return arrReg;
  },

  compileCallExpression(node) {
    const hasSpread = node.args.some(
      (a) => a && a.type === NodeType.SpreadElement,
    );

    if (hasSpread) {
      if (node.callee.type === NodeType.MemberExpression) {
        const recvReg = this.temps.alloc();
        this.compileExpression(node.callee.object);
        this.func.emit(bytecode.ROP_STAR, recvReg);
        const propIdx = this.func.addConstant(node.callee.property);
        const propFbSlot = this.func.allocFeedbackSlot();
        this.func.emit(bytecode.ROP_LDA_PROP, recvReg, propIdx, propFbSlot);
        const funcReg = this.temps.alloc();
        this.func.emit(bytecode.ROP_STAR, funcReg);
        const argsReg = this._buildSpreadArgs(node.args);
        const fbSlot = this.func.allocFeedbackSlot();
        this.func.emit(
          bytecode.ROP_CALL_SPREAD,
          funcReg,
          argsReg,
          recvReg,
          fbSlot,
        );
        this.temps.free(argsReg);
        this.temps.free(funcReg);
        this.temps.free(recvReg);
      } else {
        const funcReg = this.temps.alloc();
        this.compileExpression(node.callee);
        this.func.emit(bytecode.ROP_STAR, funcReg);
        const argsReg = this._buildSpreadArgs(node.args);
        const fbSlot = this.func.allocFeedbackSlot();
        this.func.emit(bytecode.ROP_CALL_SPREAD, funcReg, argsReg, 0, fbSlot);
        this.temps.free(argsReg);
        this.temps.free(funcReg);
      }
      return;
    }

    if (node.callee.type === NodeType.MemberExpression) {
      const recvReg = this.temps.alloc();
      this.compileExpression(node.callee.object);
      this.func.emit(bytecode.ROP_STAR, recvReg);

      if (node.callee.computed) {
        const idxReg = this.temps.alloc();
        this.compileExpression(node.callee.property);
        this.func.emit(bytecode.ROP_STAR, idxReg);
        const idxFbSlot = this.func.allocFeedbackSlot();
        this.func.emit(bytecode.ROP_LDA_INDEX, recvReg, idxReg, idxFbSlot);
        this.temps.free(idxReg);
      } else {
        const propIdx = this.func.addConstant(node.callee.property);
        const propFbSlot = this.func.allocFeedbackSlot();
        this.func.emit(bytecode.ROP_LDA_PROP, recvReg, propIdx, propFbSlot);
      }

      const methodReg = this.temps.alloc();
      this.func.emit(bytecode.ROP_STAR, methodReg);

      const firstArgReg = node.args.length > 0 ? this.temps.alloc() : 0;
      const argRegs = [];
      for (let i = 0; i < node.args.length; i++) {
        const reg = i === 0 ? firstArgReg : this.temps.alloc();
        argRegs.push(reg);
        this.compileExpression(node.args[i]);
        this.func.emit(bytecode.ROP_STAR, reg);
      }

      this.func.emit(bytecode.ROP_LDA_REG, methodReg);
      const fbSlot = this.func.allocFeedbackSlot();
      this.func.emit(
        bytecode.ROP_CALL_METHOD,
        recvReg,
        firstArgReg,
        node.args.length,
        fbSlot,
      );

      for (let i = argRegs.length - 1; i >= 0; i--) this.temps.free(argRegs[i]);
      this.temps.free(methodReg);
      this.temps.free(recvReg);
    } else {
      const funcReg = this.temps.alloc();
      this.compileExpression(node.callee);
      this.func.emit(bytecode.ROP_STAR, funcReg);

      const firstArgReg = node.args.length > 0 ? this.temps.alloc() : 0;
      const argRegs = [];
      for (let i = 0; i < node.args.length; i++) {
        const reg = i === 0 ? firstArgReg : this.temps.alloc();
        argRegs.push(reg);
        this.compileExpression(node.args[i]);
        this.func.emit(bytecode.ROP_STAR, reg);
      }

      const fbSlot = this.func.allocFeedbackSlot();
      this.func.emit(
        bytecode.ROP_CALL,
        funcReg,
        firstArgReg,
        node.args.length,
        fbSlot,
      );

      for (let i = argRegs.length - 1; i >= 0; i--) this.temps.free(argRegs[i]);
      this.temps.free(funcReg);
    }
  },

  compileNewExpression(node) {
    const funcReg = this.temps.alloc();
    this.compileExpression(node.callee);
    this.func.emit(bytecode.ROP_STAR, funcReg);

    const firstArgReg = node.args.length > 0 ? this.temps.alloc() : 0;
    const argRegs = [];
    for (let i = 0; i < node.args.length; i++) {
      const reg = i === 0 ? firstArgReg : this.temps.alloc();
      argRegs.push(reg);
      this.compileExpression(node.args[i]);
      this.func.emit(bytecode.ROP_STAR, reg);
    }

    this.func.emit(bytecode.ROP_NEW, funcReg, firstArgReg, node.args.length);

    for (let i = argRegs.length - 1; i >= 0; i--) this.temps.free(argRegs[i]);
    this.temps.free(funcReg);
  },

  compileMemberExpression(node) {
    const objReg = this.temps.alloc();
    this.compileExpression(node.object);
    this.func.emit(bytecode.ROP_STAR, objReg);

    if (typeof node.property === "string") {
      const propIdx = this.func.addConstant(node.property);
      const fbSlot = this.func.allocFeedbackSlot();
      this.func.emit(bytecode.ROP_LDA_PROP, objReg, propIdx, fbSlot);
    } else {
      const idxReg = this.temps.alloc();
      this.compileExpression(node.property);
      this.func.emit(bytecode.ROP_STAR, idxReg);
      const fbSlot = this.func.allocFeedbackSlot();
      this.func.emit(bytecode.ROP_LDA_INDEX, objReg, idxReg, fbSlot);
      this.temps.free(idxReg);
    }
    this.temps.free(objReg);
  },

  compileObjectExpression(node) {
    this.func.emit(bytecode.ROP_NEW_OBJECT);

    if (node.properties.length > 0) {
      const objReg = this.temps.alloc();
      this.func.emit(bytecode.ROP_STAR, objReg);

      for (const prop of node.properties) {
        if (prop.spread) {
          this.compileExpression(prop.argument);
          this.func.emit(bytecode.ROP_COPY_PROPS, objReg);
        } else if (prop.kind === "get" || prop.kind === "set") {
          this.compileExpression(prop.value);
          const fnReg = this.temps.alloc();
          this.func.emit(bytecode.ROP_STAR, fnReg);
          const propIdx = this.func.addConstant(prop.key);
          const getterReg = prop.kind === "get" ? fnReg : -1;
          const setterReg = prop.kind === "set" ? fnReg : -1;
          this.func.emit(
            bytecode.ROP_DEFINE_ACCESSOR,
            objReg,
            propIdx,
            getterReg,
            setterReg,
          );
          this.temps.free(fnReg);
        } else if (prop.computed) {
          const keyReg = this.temps.alloc();
          this.compileExpression(prop.key);
          this.func.emit(bytecode.ROP_STAR, keyReg);
          this.compileExpression(prop.value);
          this.func.emit(bytecode.ROP_STA_COMPUTED_PROP, objReg, keyReg);
          this.temps.free(keyReg);
        } else {
          this.compileExpression(prop.value);
          const propIdx = this.func.addConstant(prop.key);
          const fbSlot = this.func.allocFeedbackSlot();
          this.func.emit(bytecode.ROP_STA_PROP, objReg, propIdx, fbSlot);
        }
      }

      this.func.emit(bytecode.ROP_LDA_REG, objReg);
      this.temps.free(objReg);
    }
  },

  compileArrayExpression(node) {
    const hasSpread = node.elements.some(
      (e) => e && e.type === NodeType.SpreadElement,
    );

    if (!hasSpread) {
      const argRegs = [];
      const firstReg = node.elements.length > 0 ? this.temps.alloc() : 0;
      for (let i = 0; i < node.elements.length; i++) {
        const reg = i === 0 ? firstReg : this.temps.alloc();
        argRegs.push(reg);
        this.compileExpression(node.elements[i]);
        this.func.emit(bytecode.ROP_STAR, reg);
      }
      this.func.emit(bytecode.ROP_NEW_ARRAY, firstReg, node.elements.length);
      for (let i = argRegs.length - 1; i >= 0; i--) this.temps.free(argRegs[i]);
    } else {
      this.func.emit(bytecode.ROP_NEW_ARRAY, 0, 0);
      const arrReg = this.temps.alloc();
      this.func.emit(bytecode.ROP_STAR, arrReg);
      for (const elem of node.elements) {
        if (elem.type === NodeType.SpreadElement) {
          this.compileExpression(elem.argument);
          this.func.emit(bytecode.ROP_SPREAD_ARRAY, arrReg);
        } else {
          this.compileExpression(elem);
          this.func.emit(bytecode.ROP_ARRAY_PUSH, arrReg);
        }
      }
      this.func.emit(bytecode.ROP_LDA_REG, arrReg);
      this.temps.free(arrReg);
    }
  },

  compileConditionalExpression(node) {
    this.compileExpression(node.test);
    const jumpToElse = this.func.emit(bytecode.ROP_JUMP_IF_FALSE, 0);
    this.compileExpression(node.consequent);
    const jumpToEnd = this.func.emit(bytecode.ROP_JUMP, 0);
    this.func.patchJump(jumpToElse, this.func.instructions.length);
    this.compileExpression(node.alternate);
    this.func.patchJump(jumpToEnd, this.func.instructions.length);
  },

  compileAwaitExpression(node) {
    this.compileExpression(node.argument);
    this.func.emit(bytecode.ROP_AWAIT);
  },

  compileYieldExpression(node) {
    if (node.argument) {
      this.compileExpression(node.argument);
    } else {
      this.func.emit(bytecode.ROP_LDA_UNDEFINED);
    }
    this.func.emit(bytecode.ROP_YIELD);
  },

  compileTemplateLiteral(node) {
    const resultReg = this.temps.alloc();
    const idx = this.func.addConstant(node.parts[0]);
    this.func.emit(bytecode.ROP_LDA_CONST, idx);
    this.func.emit(bytecode.ROP_STAR, resultReg);

    for (let i = 0; i < node.expressions.length; i++) {
      this.compileExpression(node.expressions[i]);
      const exprReg = this.temps.alloc();
      this.func.emit(bytecode.ROP_STAR, exprReg);
      this.func.emit(bytecode.ROP_LDA_REG, resultReg);
      const fbSlot = this.func.allocFeedbackSlot();
      this.func.emit(bytecode.ROP_ADD, exprReg, fbSlot);
      this.temps.free(exprReg);

      if (node.parts[i + 1] !== "") {
        const partReg = this.temps.alloc();
        this.func.emit(bytecode.ROP_STAR, partReg);
        const partIdx = this.func.addConstant(node.parts[i + 1]);
        this.func.emit(bytecode.ROP_LDA_CONST, partIdx);
        const partExprReg = this.temps.alloc();
        this.func.emit(bytecode.ROP_STAR, partExprReg);
        this.func.emit(bytecode.ROP_LDA_REG, partReg);
        const fbSlot2 = this.func.allocFeedbackSlot();
        this.func.emit(bytecode.ROP_ADD, partExprReg, fbSlot2);
        this.temps.free(partExprReg);
        this.temps.free(partReg);
      }

      this.func.emit(bytecode.ROP_STAR, resultReg);
    }

    this.func.emit(bytecode.ROP_LDA_REG, resultReg);
    this.temps.free(resultReg);
  },

  compileNullishCoalescing(node) {
    this.compileExpression(node.left);
    const leftReg = this.temps.alloc();
    this.func.emit(bytecode.ROP_STAR, leftReg);
    this.func.emit(bytecode.ROP_IS_NULLISH);
    const jumpToRight = this.func.emit(bytecode.ROP_JUMP_IF_TRUE, 0);
    this.func.emit(bytecode.ROP_LDA_REG, leftReg);
    const jumpToEnd = this.func.emit(bytecode.ROP_JUMP, 0);
    this.func.patchJump(jumpToRight, this.func.instructions.length);
    this.compileExpression(node.right);
    this.func.patchJump(jumpToEnd, this.func.instructions.length);
    this.temps.free(leftReg);
  },

  compileOptionalMember(node) {
    this.compileExpression(node.object);
    const objReg = this.temps.alloc();
    this.func.emit(bytecode.ROP_STAR, objReg);
    this.func.emit(bytecode.ROP_IS_NULLISH);
    const jumpToUndef = this.func.emit(bytecode.ROP_JUMP_IF_TRUE, 0);
    this.func.emit(bytecode.ROP_LDA_REG, objReg);
    if (typeof node.property === "string") {
      const propIdx = this.func.addConstant(node.property);
      const fbSlot = this.func.allocFeedbackSlot();
      this.func.emit(bytecode.ROP_LDA_PROP, objReg, propIdx, fbSlot);
    } else {
      this.compileExpression(node.property);
      const idxReg = this.temps.alloc();
      this.func.emit(bytecode.ROP_STAR, idxReg);
      const fbSlot = this.func.allocFeedbackSlot();
      this.func.emit(bytecode.ROP_LDA_INDEX, objReg, idxReg, fbSlot);
      this.temps.free(idxReg);
    }
    const jumpToEnd = this.func.emit(bytecode.ROP_JUMP, 0);
    this.func.patchJump(jumpToUndef, this.func.instructions.length);
    this.func.emit(bytecode.ROP_LDA_UNDEFINED);
    this.func.patchJump(jumpToEnd, this.func.instructions.length);
    this.temps.free(objReg);
  },

  compileOptionalCall(node) {
    this.compileExpression(node.callee);
    const calleeReg = this.temps.alloc();
    this.func.emit(bytecode.ROP_STAR, calleeReg);
    this.func.emit(bytecode.ROP_IS_NULLISH);
    const jumpToUndef = this.func.emit(bytecode.ROP_JUMP_IF_TRUE, 0);

    const argRegs = [];
    const firstArgReg = node.args.length > 0 ? this.temps.alloc() : 0;
    for (let i = 0; i < node.args.length; i++) {
      const reg = i === 0 ? firstArgReg : this.temps.alloc();
      argRegs.push(reg);
      this.compileExpression(node.args[i]);
      this.func.emit(bytecode.ROP_STAR, reg);
    }
    const fbSlot = this.func.allocFeedbackSlot();
    this.func.emit(
      bytecode.ROP_CALL,
      calleeReg,
      firstArgReg,
      node.args.length,
      fbSlot,
    );
    for (let i = argRegs.length - 1; i >= 0; i--) this.temps.free(argRegs[i]);

    const jumpToEnd = this.func.emit(bytecode.ROP_JUMP, 0);
    this.func.patchJump(jumpToUndef, this.func.instructions.length);
    this.func.emit(bytecode.ROP_LDA_UNDEFINED);
    this.func.patchJump(jumpToEnd, this.func.instructions.length);
    this.temps.free(calleeReg);
  },

  compileUpdateExpression(node) {
    if (node.argument.type === NodeType.Identifier) {
      const resolved = this.scope.resolve(node.argument.name);
      if (resolved !== null) {
        this.emitLoadToAcc(resolved);
      } else {
        const nameIdx = this.func.addConstant(node.argument.name);
        this.func.emit(bytecode.ROP_LDA_GLOBAL, nameIdx);
      }

      if (!node.prefix) {
        const origReg = this.temps.alloc();
        this.func.emit(bytecode.ROP_STAR, origReg);

        const oneReg = this.temps.alloc();
        const oneIdx = this.func.addConstant(1);
        this.func.emit(bytecode.ROP_LDA_CONST, oneIdx);
        this.func.emit(bytecode.ROP_STAR, oneReg);
        this.func.emit(bytecode.ROP_LDA_REG, origReg);
        const fbSlot = this.func.allocFeedbackSlot();
        this.func.emit(
          node.op === "++" ? bytecode.ROP_ADD : bytecode.ROP_SUB,
          oneReg,
          fbSlot,
        );

        if (resolved !== null) {
          this.emitStoreAcc(resolved);
        } else {
          const nameIdx = this.func.addConstant(node.argument.name);
          this.func.emit(bytecode.ROP_STA_GLOBAL, nameIdx);
        }
        this.func.emit(bytecode.ROP_LDA_REG, origReg);
        this.temps.free(oneReg);
        this.temps.free(origReg);
      } else {
        const tmpReg = this.temps.alloc();
        this.func.emit(bytecode.ROP_STAR, tmpReg);
        const oneReg = this.temps.alloc();
        const oneIdx = this.func.addConstant(1);
        this.func.emit(bytecode.ROP_LDA_CONST, oneIdx);
        this.func.emit(bytecode.ROP_STAR, oneReg);
        this.func.emit(bytecode.ROP_LDA_REG, tmpReg);
        const fbSlot = this.func.allocFeedbackSlot();
        this.func.emit(
          node.op === "++" ? bytecode.ROP_ADD : bytecode.ROP_SUB,
          oneReg,
          fbSlot,
        );

        if (resolved !== null) {
          this.emitStoreAcc(resolved);
        } else {
          const nameIdx = this.func.addConstant(node.argument.name);
          this.func.emit(bytecode.ROP_STA_GLOBAL, nameIdx);
        }
        this.temps.free(oneReg);
        this.temps.free(tmpReg);
      }
    } else if (node.argument.type === NodeType.MemberExpression) {
      const objReg = this.temps.alloc();
      this.compileExpression(node.argument.object);
      this.func.emit(bytecode.ROP_STAR, objReg);

      if (typeof node.argument.property === "string") {
        const propIdx = this.func.addConstant(node.argument.property);
        const loadFb = this.func.allocFeedbackSlot();
        this.func.emit(bytecode.ROP_LDA_PROP, objReg, propIdx, loadFb);
      } else {
        const idxReg = this.temps.alloc();
        this.compileExpression(node.argument.property);
        this.func.emit(bytecode.ROP_STAR, idxReg);
        const loadFb = this.func.allocFeedbackSlot();
        this.func.emit(bytecode.ROP_LDA_INDEX, objReg, idxReg, loadFb);
        this.temps.free(idxReg);
      }

      const origReg = this.temps.alloc();
      this.func.emit(bytecode.ROP_STAR, origReg);

      const oneReg = this.temps.alloc();
      const oneIdx = this.func.addConstant(1);
      this.func.emit(bytecode.ROP_LDA_CONST, oneIdx);
      this.func.emit(bytecode.ROP_STAR, oneReg);
      this.func.emit(bytecode.ROP_LDA_REG, origReg);
      const fbSlot = this.func.allocFeedbackSlot();
      this.func.emit(
        node.op === "++" ? bytecode.ROP_ADD : bytecode.ROP_SUB,
        oneReg,
        fbSlot,
      );

      if (typeof node.argument.property === "string") {
        const propIdx = this.func.addConstant(node.argument.property);
        const storeFb = this.func.allocFeedbackSlot();
        this.func.emit(bytecode.ROP_STA_PROP, objReg, propIdx, storeFb);
      } else {
        const idxReg = this.temps.alloc();
        this.compileExpression(node.argument.property);
        this.func.emit(bytecode.ROP_STAR, idxReg);
        const storeFb = this.func.allocFeedbackSlot();
        this.func.emit(bytecode.ROP_STA_INDEX, objReg, idxReg, storeFb);
        this.temps.free(idxReg);
      }

      if (!node.prefix) {
        this.func.emit(bytecode.ROP_LDA_REG, origReg);
      }
      this.temps.free(oneReg);
      this.temps.free(origReg);
      this.temps.free(objReg);
    }
  },

  compileCompoundAssignment(node) {
    const opcode = BINARY_OP_MAP[node.op];
    if (opcode === undefined) {
      throw new Error(
        `[RegCompiler] Unknown compound assignment operator '${node.op}='`,
      );
    }

    if (node.target.type === NodeType.Identifier) {
      const resolved = this.scope.resolve(node.target.name);

      const rhsReg = this.temps.alloc();
      this.compileExpression(node.value);
      this.func.emit(bytecode.ROP_STAR, rhsReg);

      if (resolved !== null) {
        this.emitLoadToAcc(resolved);
      } else {
        const nameIdx = this.func.addConstant(node.target.name);
        this.func.emit(bytecode.ROP_LDA_GLOBAL, nameIdx);
      }

      const fbSlot = this.func.allocFeedbackSlot();
      this.func.emit(opcode, rhsReg, fbSlot);

      if (resolved !== null) {
        this.emitStoreAcc(resolved);
      } else {
        const nameIdx = this.func.addConstant(node.target.name);
        this.func.emit(bytecode.ROP_STA_GLOBAL, nameIdx);
      }
      this.temps.free(rhsReg);
    } else if (node.target.type === NodeType.MemberExpression) {
      const objReg = this.temps.alloc();
      this.compileExpression(node.target.object);
      this.func.emit(bytecode.ROP_STAR, objReg);

      if (typeof node.target.property === "string") {
        const propIdx = this.func.addConstant(node.target.property);
        const loadFb = this.func.allocFeedbackSlot();
        this.func.emit(bytecode.ROP_LDA_PROP, objReg, propIdx, loadFb);

        const curReg = this.temps.alloc();
        this.func.emit(bytecode.ROP_STAR, curReg);

        const rhsReg = this.temps.alloc();
        this.compileExpression(node.value);
        this.func.emit(bytecode.ROP_STAR, rhsReg);

        this.func.emit(bytecode.ROP_LDA_REG, curReg);
        const fbSlot = this.func.allocFeedbackSlot();
        this.func.emit(opcode, rhsReg, fbSlot);

        const storeFb = this.func.allocFeedbackSlot();
        this.func.emit(bytecode.ROP_STA_PROP, objReg, propIdx, storeFb);

        this.temps.free(rhsReg);
        this.temps.free(curReg);
      } else {
        const idxReg = this.temps.alloc();
        this.compileExpression(node.target.property);
        this.func.emit(bytecode.ROP_STAR, idxReg);

        const loadFb = this.func.allocFeedbackSlot();
        this.func.emit(bytecode.ROP_LDA_INDEX, objReg, idxReg, loadFb);

        const curReg = this.temps.alloc();
        this.func.emit(bytecode.ROP_STAR, curReg);

        const rhsReg = this.temps.alloc();
        this.compileExpression(node.value);
        this.func.emit(bytecode.ROP_STAR, rhsReg);

        this.func.emit(bytecode.ROP_LDA_REG, curReg);
        const fbSlot = this.func.allocFeedbackSlot();
        this.func.emit(opcode, rhsReg, fbSlot);

        const storeFb = this.func.allocFeedbackSlot();
        this.func.emit(bytecode.ROP_STA_INDEX, objReg, idxReg, storeFb);

        this.temps.free(rhsReg);
        this.temps.free(curReg);
        this.temps.free(idxReg);
      }
      this.temps.free(objReg);
    }
  },
};
