import { NodeType } from "../../../frontend/ast/index.js";
import { Scope } from "./helpers.js";
import { TempAllocator } from "./temp-allocator.js";
import * as bytecode from "../ops/bytecode.js";

export const functionMethods = {
  _compileParams(params, innerFunc, innerScope) {
    for (const param of params) {
      if (typeof param === "string") {
        const slot = innerFunc.addLocal(param);
        innerScope.define(param, slot);
      } else if (param.rest) {
        const slot = innerFunc.addLocal(param.name);
        innerScope.define(param.name, slot);
        const normalCount = params.filter(
          (p) => typeof p === "string" || (p && !p.rest),
        ).length;
        innerFunc.emit(bytecode.ROP_REST_ARGS, normalCount);
        innerFunc.emit(bytecode.ROP_STAR, slot);
      } else if (param.default) {
        const slot = innerFunc.addLocal(param.name);
        innerScope.define(param.name, slot);
        innerFunc.emit(bytecode.ROP_LDA_REG, slot);
        innerFunc.emit(bytecode.ROP_IS_NULLISH);
        const jumpPastDefault = innerFunc.emit(bytecode.ROP_JUMP_IF_FALSE, 0);
        this.compileExpression(param.default);
        innerFunc.emit(bytecode.ROP_STAR, slot);
        innerFunc.patchJump(jumpPastDefault, innerFunc.instructions.length);
      }
    }
  },

  compileFunctionDeclaration(node) {
    const outerFunc = this.func;
    const outerScope = this.scope;
    const outerTemps = this.temps;
    const outerSuperClassName = this._currentSuperClassName;

    const paramCount = node.params.filter(
      (p) => typeof p === "string" || (p && !p.rest),
    ).length;
    const innerFunc = new bytecode.RegisterCompiledFunction(
      node.name,
      paramCount,
    );
    innerFunc.isAsync = !!node.async;
    innerFunc.isGenerator = !!node.generator;
    const innerScope = new Scope(outerScope);
    innerScope.isFunctionBoundary = true;

    this.func = innerFunc;
    this.scope = innerScope;
    this.temps = new TempAllocator(innerFunc);
    this._currentSuperClassName = node._superClassName || null;

    this._compileParams(node.params, innerFunc, innerScope);

    if (node.body.type === NodeType.BlockStatement) {
      this._prepareFunctionBody(node.body.body);
      this.compileStatements(node.body.body);
    } else {
      this._prescanStatement(node.body);
      this.compileStatement(node.body);
    }

    const lastInstr = innerFunc.instructions[innerFunc.instructions.length - 1];
    if (!lastInstr || lastInstr.opcode !== bytecode.ROP_RETURN) {
      innerFunc.emit(bytecode.ROP_LDA_UNDEFINED);
      innerFunc.emit(bytecode.ROP_RETURN);
    }

    innerFunc.upvalues = innerScope.upvalues;

    this.func = outerFunc;
    this.scope = outerScope;
    this.temps = outerTemps;
    this._currentSuperClassName = outerSuperClassName;

    const constIdx = outerFunc.addConstant(innerFunc);

    if (innerFunc.upvalues.length > 0) {
      outerFunc.emit(bytecode.ROP_MAKE_CLOSURE, constIdx);
    } else {
      outerFunc.emit(bytecode.ROP_LDA_CONST, constIdx);
    }

    const resolved = this.scope.resolve(node.name);
    if (resolved !== null) {
      this.emitStoreAcc(resolved);
    } else {
      const nameIdx = outerFunc.addConstant(node.name);
      outerFunc.emit(bytecode.ROP_STA_GLOBAL, nameIdx);
    }
  },

  compileFunctionExpression(node) {
    const outerFunc = this.func;
    const outerScope = this.scope;
    const outerTemps = this.temps;

    const name = node.name || "<anonymous>";
    const paramCount = node.params.filter(
      (p) => typeof p === "string" || (p && !p.rest),
    ).length;
    const innerFunc = new bytecode.RegisterCompiledFunction(name, paramCount);
    const innerScope = new Scope(outerScope);
    innerScope.isFunctionBoundary = true;

    this.func = innerFunc;
    this.scope = innerScope;
    this.temps = new TempAllocator(innerFunc);

    this._compileParams(node.params, innerFunc, innerScope);

    if (node.name) {
      const selfSlot = innerFunc.addLocal(node.name);
      innerScope.define(node.name, selfSlot);
      innerFunc.selfBindingSlot = selfSlot;
    }

    if (node.body.type === NodeType.BlockStatement) {
      this._prepareFunctionBody(node.body.body);
      this.compileStatements(node.body.body);
    } else {
      this.compileStatement(node.body);
    }

    const lastInstr = innerFunc.instructions[innerFunc.instructions.length - 1];
    if (!lastInstr || lastInstr.opcode !== bytecode.ROP_RETURN) {
      innerFunc.emit(bytecode.ROP_LDA_UNDEFINED);
      innerFunc.emit(bytecode.ROP_RETURN);
    }

    innerFunc.upvalues = innerScope.upvalues;
    this.func = outerFunc;
    this.scope = outerScope;
    this.temps = outerTemps;

    const constIdx = outerFunc.addConstant(innerFunc);
    if (innerFunc.upvalues.length > 0) {
      outerFunc.emit(bytecode.ROP_MAKE_CLOSURE, constIdx);
    } else {
      outerFunc.emit(bytecode.ROP_LDA_CONST, constIdx);
    }
  },

  compileArrowFunction(node) {
    const outerFunc = this.func;
    const outerScope = this.scope;
    const outerTemps = this.temps;

    const paramCount = node.params.filter(
      (p) => typeof p === "string" || (p && !p.rest),
    ).length;
    const innerFunc = new bytecode.RegisterCompiledFunction(
      "<arrow>",
      paramCount,
    );
    innerFunc.isArrow = true;
    const innerScope = new Scope(outerScope);
    innerScope.isFunctionBoundary = true;

    this.func = innerFunc;
    this.scope = innerScope;
    this.temps = new TempAllocator(innerFunc);

    this._compileParams(node.params, innerFunc, innerScope);

    if (node.isExpression) {
      this.compileExpression(node.body);
      innerFunc.emit(bytecode.ROP_RETURN);
    } else {
      if (node.body.type === NodeType.BlockStatement) {
        this._prepareFunctionBody(node.body.body);
        this.compileStatements(node.body.body);
      } else {
        this.compileStatement(node.body);
      }
      const lastInstr =
        innerFunc.instructions[innerFunc.instructions.length - 1];
      if (!lastInstr || lastInstr.opcode !== bytecode.ROP_RETURN) {
        innerFunc.emit(bytecode.ROP_LDA_UNDEFINED);
        innerFunc.emit(bytecode.ROP_RETURN);
      }
    }

    innerFunc.upvalues = innerScope.upvalues;
    this.func = outerFunc;
    this.scope = outerScope;
    this.temps = outerTemps;

    const constIdx = outerFunc.addConstant(innerFunc);
    if (innerFunc.upvalues.length > 0) {
      outerFunc.emit(bytecode.ROP_MAKE_CLOSURE, constIdx);
    } else {
      outerFunc.emit(bytecode.ROP_LDA_CONST, constIdx);
    }
  },

  compileLazyFunctionDeclaration(node) {
    const innerFunc = new bytecode.RegisterCompiledFunction(
      node.name,
      node.params.length,
    );
    innerFunc.isLazy = true;
    innerFunc.lazySource = node.source;
    innerFunc.lazyBodyStart = node.bodyStart;
    innerFunc.lazyBodyEnd = node.bodyEnd;
    innerFunc.lazyParams = node.params;

    innerFunc.emit(bytecode.ROP_LDA_UNDEFINED);
    innerFunc.emit(bytecode.ROP_RETURN);

    const constIdx = this.func.addConstant(innerFunc);
    this.func.emit(bytecode.ROP_LDA_CONST, constIdx);

    const resolved = this.scope.resolve(node.name);
    if (resolved !== null) {
      this.emitStoreAcc(resolved);
    } else {
      const nameIdx = this.func.addConstant(node.name);
      this.func.emit(bytecode.ROP_STA_GLOBAL, nameIdx);
    }
  },

  compileClassDeclaration(node) {
    let superClassReg = -1;
    if (node.superClass) {
      const superName = node.superClass.name;
      superClassReg = this.func.addLocal("_superClass$" + node.name);
      this.temps.freeTemps = this.temps.freeTemps.filter(
        (r) => r !== superClassReg,
      );
      this.scope.define("_superClass$" + node.name, superClassReg);
      const nameIdx = this.func.addConstant(superName);
      const resolved = this.scope.resolve(superName);
      if (resolved && resolved.type === "local") {
        this.func.emit(bytecode.ROP_LDA_REG, resolved.slot);
      } else {
        this.func.emit(bytecode.ROP_LDA_GLOBAL, nameIdx);
      }
      this.func.emit(bytecode.ROP_STAR, superClassReg);
    }

    const ctorNode = node.constructor || {
      type: NodeType.FunctionDeclaration,
      name: node.name,
      params: [],
      body: { type: NodeType.BlockStatement, body: [] },
    };
    ctorNode.name = node.name;
    ctorNode._superClassName = node.superClass ? node.name : null;
    this.compileFunctionDeclaration(ctorNode);

    if (node.superClass) {
      const classResolved = this.scope.resolve(node.name);
      if (classResolved && classResolved.type === "local") {
        this.func.emit(bytecode.ROP_LDA_REG, classResolved.slot);
      } else {
        const classNameIdx = this.func.addConstant(node.name);
        this.func.emit(bytecode.ROP_LDA_GLOBAL, classNameIdx);
      }
      const subCtorReg = this.temps.alloc();
      this.func.emit(bytecode.ROP_STAR, subCtorReg);
      const protoStr = this.func.addConstant("prototype");
      const fbSlot1 = this.func.allocFeedbackSlot();
      this.func.emit(bytecode.ROP_LDA_PROP, subCtorReg, protoStr, fbSlot1);
      const subProtoReg = this.temps.alloc();
      this.func.emit(bytecode.ROP_STAR, subProtoReg);

      this.func.emit(bytecode.ROP_LDA_REG, superClassReg);
      const superCtorReg = this.temps.alloc();
      this.func.emit(bytecode.ROP_STAR, superCtorReg);
      const fbSlot2 = this.func.allocFeedbackSlot();
      this.func.emit(bytecode.ROP_LDA_PROP, superCtorReg, protoStr, fbSlot2);
      const superProtoReg = this.temps.alloc();
      this.func.emit(bytecode.ROP_STAR, superProtoReg);

      this.func.emit(bytecode.ROP_SET_PROTO, subProtoReg, superProtoReg);

      this.temps.free(superProtoReg);
      this.temps.free(superCtorReg);
      this.temps.free(subProtoReg);
      this.temps.free(subCtorReg);
    }

    for (const method of node.methods) {
      const resolved = this.scope.resolve(node.name);
      if (resolved && resolved.type === "local") {
        this.func.emit(bytecode.ROP_LDA_REG, resolved.slot);
      } else {
        const nameIdx = this.func.addConstant(node.name);
        this.func.emit(bytecode.ROP_LDA_GLOBAL, nameIdx);
      }

      const protoReg = this.temps.alloc();
      this.func.emit(bytecode.ROP_STAR, protoReg);
      const protoConstIdx = this.func.addConstant("prototype");
      const protoFbSlot = this.func.allocFeedbackSlot();
      this.func.emit(
        bytecode.ROP_LDA_PROP,
        protoReg,
        protoConstIdx,
        protoFbSlot,
      );

      const protoObjReg = this.temps.alloc();
      this.func.emit(bytecode.ROP_STAR, protoObjReg);

      const outerFunc = this.func;
      const outerScope = this.scope;
      const outerTemps = this.temps;

      const methodFunc = new bytecode.RegisterCompiledFunction(
        method.func.name,
        method.func.params.length,
      );
      this.func = methodFunc;
      this.scope = new Scope(outerScope);
      this.scope.isFunctionBoundary = true;
      this.temps = new TempAllocator(methodFunc);

      for (const p of method.func.params) {
        const slot = methodFunc.addLocal(p);
        this.scope.define(p, slot);
      }

      if (method.func.body.type === NodeType.BlockStatement) {
        this.compileStatements(method.func.body.body);
      } else {
        this.compileStatement(method.func.body);
      }

      if (
        methodFunc.instructions.length === 0 ||
        methodFunc.instructions[methodFunc.instructions.length - 1].opcode !==
          bytecode.ROP_RETURN
      ) {
        methodFunc.emit(bytecode.ROP_LDA_UNDEFINED);
        methodFunc.emit(bytecode.ROP_RETURN);
      }

      this.func = outerFunc;
      this.scope = outerScope;
      this.temps = outerTemps;

      if (methodFunc.upvalues.length > 0) {
        const constIdx = outerFunc.addConstant(methodFunc);
        outerFunc.emit(bytecode.ROP_MAKE_CLOSURE, constIdx);
      } else {
        const constIdx = outerFunc.addConstant(methodFunc);
        outerFunc.emit(bytecode.ROP_LDA_CONST, constIdx);
      }

      const methodNameIdx = outerFunc.addConstant(method.name);
      if (method.kind === "get" || method.kind === "set") {
        const fnReg = this.temps.alloc();
        outerFunc.emit(bytecode.ROP_STAR, fnReg);
        const getterReg = method.kind === "get" ? fnReg : -1;
        const setterReg = method.kind === "set" ? fnReg : -1;
        outerFunc.emit(
          bytecode.ROP_DEFINE_ACCESSOR,
          protoObjReg,
          methodNameIdx,
          getterReg,
          setterReg,
        );
        this.temps.free(fnReg);
      } else {
        const setFbSlot = outerFunc.allocFeedbackSlot();
        outerFunc.emit(
          bytecode.ROP_STA_PROP,
          protoObjReg,
          methodNameIdx,
          setFbSlot,
        );
      }

      this.temps.free(protoObjReg);
      this.temps.free(protoReg);
    }
  },

  compileSuperCall(node) {
    const className = this._currentSuperClassName;
    if (!className) {
      throw new Error(
        "[RegCompiler] super() called outside of a class constructor",
      );
    }
    const superVar = "_superClass$" + className;
    const resolved = this.scope.resolve(superVar);
    if (!resolved) {
      throw new Error("[RegCompiler] Cannot resolve super class reference");
    }
    this.emitLoadToAcc(resolved);
    const superReg = this.temps.alloc();
    this.func.emit(bytecode.ROP_STAR, superReg);

    const firstArgReg = this.temps.alloc();
    for (let i = 0; i < node.args.length; i++) {
      this.compileExpression(node.args[i]);
      if (i === 0) {
        this.func.emit(bytecode.ROP_STAR, firstArgReg);
      } else {
        const argReg = this.temps.alloc();
        this.func.emit(bytecode.ROP_STAR, argReg);
      }
    }

    this.func.emit(bytecode.ROP_LDA_THIS);
    const thisReg = this.temps.alloc();
    this.func.emit(bytecode.ROP_STAR, thisReg);

    this.func.emit(bytecode.ROP_LDA_REG, superReg);
    const fbSlot = this.func.allocFeedbackSlot();
    this.func.emit(
      bytecode.ROP_CALL_METHOD,
      thisReg,
      firstArgReg,
      node.args.length,
      fbSlot,
    );

    const totalTemps = 1 + Math.max(1, node.args.length) + 1;
    for (let i = 0; i < totalTemps; i++) {
      this.temps.free(thisReg - i);
    }
  },

  compileForInStatement(node) {
    const keysResolved = this.scope.resolve("_keys$");
    const keysSlot = keysResolved
      ? keysResolved.slot
      : this._declareLocal("_keys$", "var");
    const iResolved = this.scope.resolve("_i$");
    const iSlot = iResolved ? iResolved.slot : this._declareLocal("_i$", "var");
    const lenResolved = this.scope.resolve("_len$");
    const lenSlot = lenResolved
      ? lenResolved.slot
      : this._declareLocal("_len$", "var");
    const varResolved = this.scope.resolve(node.variable);
    const varSlot = varResolved
      ? varResolved.slot
      : this._declareLocal(
          node.variable,
          node.kind === "const" ? "const" : node.kind === "var" ? "var" : "let",
        );
    if (!varResolved) {
      this.func.setLocalBindingKind(
        varSlot,
        node.kind === "const" ? "const" : node.kind === "var" ? "var" : "let",
      );
    }

    const objReg = this.temps.alloc();
    this.compileExpression(node.object);
    this.func.emit(bytecode.ROP_STAR, objReg);
    this.func.emit(bytecode.ROP_GET_KEYS, objReg);
    this.func.emit(bytecode.ROP_STAR, keysSlot);

    const zeroIdx = this.func.addConstant(0);
    this.func.emit(bytecode.ROP_LDA_CONST, zeroIdx);
    this.func.emit(bytecode.ROP_STAR, iSlot);

    this.func.emit(bytecode.ROP_GET_LENGTH, keysSlot);
    this.func.emit(bytecode.ROP_STAR, lenSlot);

    this.temps.free(objReg);

    const outerBreak = this._breakJumps;
    const outerContinue = this._continueJumps;
    const breakJumps = [];
    const continueJumps = [];
    this._breakJumps = breakJumps;
    this._continueJumps = continueJumps;

    const loopStart = this.func.instructions.length;
    this.func.emit(bytecode.ROP_LDA_REG, iSlot);
    const fbSlot = this.func.allocFeedbackSlot();
    this.func.emit(bytecode.ROP_LT, lenSlot, fbSlot);
    const exitJump = this.func.emit(bytecode.ROP_JUMP_IF_FALSE, 0);

    this.func.emit(bytecode.ROP_LDA_INDEX, keysSlot, iSlot);
    this.func.emit(bytecode.ROP_STAR, varSlot);

    if (node.body.type === "BlockStatement") {
      this.compileStatements(node.body.body);
    } else {
      this.compileStatement(node.body);
    }

    const continueTarget = this.func.instructions.length;
    this.func.emit(bytecode.ROP_LDA_REG, iSlot);
    const oneIdx = this.func.addConstant(1);
    const oneReg = this.temps.alloc();
    this.func.emit(bytecode.ROP_LDA_CONST, oneIdx);
    this.func.emit(bytecode.ROP_STAR, oneReg);
    this.func.emit(bytecode.ROP_LDA_REG, iSlot);
    const addFb = this.func.allocFeedbackSlot();
    this.func.emit(bytecode.ROP_ADD, oneReg, addFb);
    this.func.emit(bytecode.ROP_STAR, iSlot);
    this.temps.free(oneReg);

    this.func.emit(bytecode.ROP_JUMP, loopStart);
    const endTarget = this.func.instructions.length;
    this.func.patchJump(exitJump, endTarget);
    for (const j of breakJumps) this.func.patchJump(j, endTarget);
    for (const j of continueJumps) this.func.patchJump(j, continueTarget);

    this._breakJumps = outerBreak;
    this._continueJumps = outerContinue;
  },

  compileForOfStatement(node) {
    const iterResolved = this.scope.resolve("_iter$");
    const iterSlot = iterResolved
      ? iterResolved.slot
      : this._declareLocal("_iter$", "var");
    const iterResultResolved = this.scope.resolve("_iterResult$");
    const iterResultSlot = iterResultResolved
      ? iterResultResolved.slot
      : this._declareLocal("_iterResult$", "var");
    const varResolved = this.scope.resolve(node.variable);
    const varSlot = varResolved
      ? varResolved.slot
      : this._declareLocal(
          node.variable,
          node.kind === "const" ? "const" : node.kind === "var" ? "var" : "let",
        );
    if (!varResolved) {
      this.func.setLocalBindingKind(
        varSlot,
        node.kind === "const" ? "const" : node.kind === "var" ? "var" : "let",
      );
    }

    this.compileExpression(node.iterable);
    this.func.emit(bytecode.ROP_GET_ITERATOR);
    this.func.emit(bytecode.ROP_STAR, iterSlot);

    const outerBreak = this._breakJumps;
    const outerContinue = this._continueJumps;
    const breakJumps = [];
    const continueJumps = [];
    this._breakJumps = breakJumps;
    this._continueJumps = continueJumps;

    const loopStart = this.func.instructions.length;

    this.func.emit(bytecode.ROP_LDA_REG, iterSlot);
    this.func.emit(bytecode.ROP_ITER_NEXT);
    this.func.emit(bytecode.ROP_STAR, iterResultSlot);

    this.func.emit(bytecode.ROP_LDA_REG, iterResultSlot);
    this.func.emit(bytecode.ROP_ITER_DONE);
    const exitJump = this.func.emit(bytecode.ROP_JUMP_IF_TRUE, 0);

    this.func.emit(bytecode.ROP_LDA_REG, iterResultSlot);
    this.func.emit(bytecode.ROP_ITER_VALUE);
    this.func.emit(bytecode.ROP_STAR, varSlot);

    if (node.body.type === "BlockStatement") {
      this.compileStatements(node.body.body);
    } else {
      this.compileStatement(node.body);
    }

    this.func.emit(bytecode.ROP_JUMP, loopStart);
    const endTarget = this.func.instructions.length;
    this.func.patchJump(exitJump, endTarget);
    for (const j of breakJumps) this.func.patchJump(j, endTarget);
    for (const j of continueJumps) this.func.patchJump(j, loopStart);

    this._breakJumps = outerBreak;
    this._continueJumps = outerContinue;
  },

  compileObjectDestructuring(node) {
    const tempResolved = this.scope.resolve("_destruct$");
    const tempSlot = tempResolved
      ? tempResolved.slot
      : this._declareLocal("_destruct$", "var");

    this.compileExpression(node.init);
    this.func.emit(bytecode.ROP_STAR, tempSlot);

    for (const { key, alias } of node.pattern) {
      const resolved = this.scope.resolve(alias);
      const slot = resolved
        ? resolved.slot
        : this._declareLocal(alias, node.kind === "const" ? "const" : "let");
      if (!resolved) {
        this.func.setLocalBindingKind(
          slot,
          node.kind === "const" ? "const" : "let",
        );
      }
      this.func.emit(bytecode.ROP_LDA_REG, tempSlot);
      const objReg = this.temps.alloc();
      this.func.emit(bytecode.ROP_STAR, objReg);
      const propIdx = this.func.addConstant(key);
      const fbSlot = this.func.allocFeedbackSlot();
      this.func.emit(bytecode.ROP_LDA_PROP, objReg, propIdx, fbSlot);
      this.func.emit(bytecode.ROP_STAR, slot);
      this.temps.free(objReg);
    }
  },

  compileArrayDestructuring(node) {
    const tempResolved = this.scope.resolve("_destruct$");
    const tempSlot = tempResolved
      ? tempResolved.slot
      : this._declareLocal("_destruct$", "var");

    this.compileExpression(node.init);
    this.func.emit(bytecode.ROP_STAR, tempSlot);

    for (let i = 0; i < node.pattern.length; i++) {
      const name = node.pattern[i];
      if (name === null) continue;

      const resolved = this.scope.resolve(name);
      const slot = resolved
        ? resolved.slot
        : this._declareLocal(name, node.kind === "const" ? "const" : "let");
      if (!resolved) {
        this.func.setLocalBindingKind(
          slot,
          node.kind === "const" ? "const" : "let",
        );
      }
      const idxReg = this.temps.alloc();
      const idxConst = this.func.addConstant(i);
      this.func.emit(bytecode.ROP_LDA_CONST, idxConst);
      this.func.emit(bytecode.ROP_STAR, idxReg);
      const fbSlot = this.func.allocFeedbackSlot();
      this.func.emit(bytecode.ROP_LDA_INDEX, tempSlot, idxReg, fbSlot);
      this.func.emit(bytecode.ROP_STAR, slot);
      this.temps.free(idxReg);
    }
  },
};
