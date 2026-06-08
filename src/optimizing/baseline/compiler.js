import * as bytecode from "../../bytecode/register/ops/bytecode.js";
import { tracer } from "../../core/tracing/index.js";
import { BaselineRuntime } from "./runtime.js";

export { BaselineRuntime } from "./runtime.js";
import { DEFAULT_TIERING_POLICY } from "../../runtime/tiering/policy.js";
export const BASELINE_THRESHOLD = DEFAULT_TIERING_POLICY.baselineThreshold;

export class BaselineCompiler {
  compile(compiledFn, interpreter) {
    const instrs = compiledFn.instructions;
    if (instrs.length === 0 || instrs.length > 1000) return null;
    if (
      instrs.some(
        (instr) =>
          instr.opcode === bytecode.ROP_TRY_START ||
          instr.opcode === bytecode.ROP_TRY_END ||
          instr.opcode === bytecode.ROP_THROW,
      )
    )
      return null;
    if (
      instrs.some(
        (instr) =>
          instr.opcode === bytecode.ROP_CALL_SPREAD ||
          instr.opcode === bytecode.ROP_REST_ARGS ||
          instr.opcode === bytecode.ROP_SPREAD_ARRAY ||
          instr.opcode === bytecode.ROP_DEFINE_ACCESSOR,
      )
    )
      return null;
    if (
      instrs.some((instr) => {
        if (instr.opcode !== bytecode.ROP_MAKE_CLOSURE) return false;
        const inner = compiledFn.constants[instr.operands[0]];
        return inner && inner.upvalues && inner.upvalues.length > 0;
      })
    )
      return null;

    const body = this.generateBody(compiledFn);
    const rt = new BaselineRuntime(compiledFn, interpreter);

    try {
      const fn = new Function("args", "tv", "$", "pc", body);

      tracer.jitCompile(
        compiledFn.name,
        `Baseline compiled: ${instrs.length} bytecodes`,
      );

      const baselineFn = function baselineCode(args, thisValue, interp) {
        return fn(args, thisValue || rt.u, rt, 0);
      };
      baselineFn._call0 = function baselineCall0(thisValue, interp) {
        return fn([], thisValue || rt.u, rt, 0);
      };
      baselineFn._call1 = function baselineCall1(a0, thisValue, interp) {
        return fn([a0], thisValue || rt.u, rt, 0);
      };
      baselineFn._call2 = function baselineCall2(a0, a1, thisValue, interp) {
        return fn([a0, a1], thisValue || rt.u, rt, 0);
      };
      baselineFn._call3 = function baselineCall3(
        a0,
        a1,
        a2,
        thisValue,
        interp,
      ) {
        return fn([a0, a1, a2], thisValue || rt.u, rt, 0);
      };
      baselineFn._isBaseline = true;
      return baselineFn;
    } catch (e) {
      tracer.jitCompile(compiledFn.name, `Baseline failed: ${e.message}`);
      return null;
    }
  }

  generateBody(compiledFn) {
    const instrs = compiledFn.instructions;
    const nRegs = compiledFn.registerCount;
    const nParams = compiledFn.paramCount;
    const hasClosures = instrs.some(
      (i) =>
        i.opcode === bytecode.ROP_MAKE_CLOSURE ||
        i.opcode === bytecode.ROP_LDA_UPVALUE ||
        i.opcode === bytecode.ROP_STA_UPVALUE,
    );

    let c = "";
    c += `var acc,t,t2,t3,t4;\n`;
    c += `var r=new Array(${nRegs});\n`;
    c += `for(var i=0;i<${nRegs};i++)r[i]=$.u;\n`;
    c += `for(var i=0;i<args.length&&i<${nParams};i++)r[i]=args[i];\n`;
    c += `acc=$.u;\n`;
    c += `$.cf.lastExecutionTime=Date.now();\n`;
    if (hasClosures) {
      c += `var _ouv=new Map(),_ce=null;\n`;
    }
    c += `L:while(1){switch(pc){\n`;

    for (let i = 0; i < instrs.length; i++) {
      c += `case ${i}:`;
      const nextInstr = i + 1 < instrs.length ? instrs[i + 1] : null;
      c += this.emitOp(instrs[i], i, compiledFn, hasClosures, nextInstr);
      c += "\n";
    }

    c += `default:return $.u;}}\n`;
    return c;
  }

  emitOp(instr, idx, compiledFn, hasClosures, nextInstr) {
    const op = instr.opcode;
    const o = instr.operands;

    switch (op) {
      case bytecode.ROP_LDA_CONST:
        return `acc=$.c(${o[0]});`;

      case bytecode.ROP_LDA_REG:
        if (hasClosures) {
          return `acc=_ouv.has(${o[0]})?_ouv.get(${o[0]}).get():r[${o[0]}];`;
        }
        return `acc=r[${o[0]}];`;

      case bytecode.ROP_STAR:
        if (hasClosures) {
          return `if(_ouv.has(${o[0]}))_ouv.get(${o[0]}).set(acc);else r[${o[0]}]=acc;`;
        }
        return `r[${o[0]}]=acc;`;

      case bytecode.ROP_MOV:
        return `r[${o[0]}]=r[${o[1]}];`;

      case bytecode.ROP_LDA_GLOBAL:
        return `acc=$.lg(${o[0]});`;

      case bytecode.ROP_STA_GLOBAL:
        return `$.sg(${o[0]},acc);`;

      case bytecode.ROP_LDA_PROP:
        return `acc=$.gp(r[${o[0]}],${o[1]},${o[2] ?? 0});`;

      case bytecode.ROP_STA_PROP:
        return `$.sp(r[${o[0]}],${o[1]},acc,${o[2] ?? 0});`;

      case bytecode.ROP_LDA_INDEX:
        return `acc=$.gi(r[${o[0]}],r[${o[1]}],${o[2] ?? 0});`;

      case bytecode.ROP_STA_INDEX:
        return `$.si(r[${o[0]}],r[${o[1]}],acc,${o[2] ?? 0});`;

      case bytecode.ROP_ADD:
        return `t=r[${o[0]}];if((acc&15)===0&&(t&15)===0){t2=acc+t;if(t2>=-17179869184&&t2<=17179869168)acc=t2;else acc=$.add(acc,t,${o[1]});}else{acc=$.add(acc,t,${o[1]});}`;

      case bytecode.ROP_SUB:
        return `t=r[${o[0]}];if((acc&15)===0&&(t&15)===0){t2=acc-t;if(t2>=-17179869184&&t2<=17179869168)acc=t2;else acc=$.sub(acc,t,${o[1]});}else{acc=$.sub(acc,t,${o[1]});}`;

      case bytecode.ROP_MUL:
        return `t=r[${o[0]}];if((acc&15)===0&&(t&15)===0){t2=(acc/16)*(t/16);if((t2|0)===t2&&t2>=-1073741824&&t2<=1073741823)acc=t2*16;else acc=$.mul(acc,t,${o[1]});}else{acc=$.mul(acc,t,${o[1]});}`;

      case bytecode.ROP_DIV:
        return `acc=$.div(acc,r[${o[0]}],${o[1]});`;

      case bytecode.ROP_MOD:
        return `acc=$.mod(acc,r[${o[0]}],${o[1]});`;

      case bytecode.ROP_EQ:
        return `t=r[${o[0]}];if((acc&15)===0&&(t&15)===0)acc=acc===t?$.t:$.f;else acc=$.eq(acc,t,${o[1]});`;

      case bytecode.ROP_NEQ:
        return `t=r[${o[0]}];if((acc&15)===0&&(t&15)===0)acc=acc!==t?$.t:$.f;else acc=$.neq(acc,t,${o[1]});`;

      case bytecode.ROP_LT:
        return `t=r[${o[0]}];if((acc&15)===0&&(t&15)===0)acc=acc<t?$.t:$.f;else acc=$.cmp(acc,t,0,${o[1]});`;

      case bytecode.ROP_GT:
        return `t=r[${o[0]}];if((acc&15)===0&&(t&15)===0)acc=acc>t?$.t:$.f;else acc=$.cmp(acc,t,1,${o[1]});`;

      case bytecode.ROP_LTE:
        return `t=r[${o[0]}];if((acc&15)===0&&(t&15)===0)acc=acc<=t?$.t:$.f;else acc=$.cmp(acc,t,2,${o[1]});`;

      case bytecode.ROP_GTE:
        return `t=r[${o[0]}];if((acc&15)===0&&(t&15)===0)acc=acc>=t?$.t:$.f;else acc=$.cmp(acc,t,3,${o[1]});`;

      case bytecode.ROP_NOT:
        return `acc=$.not(acc,${o[0] ?? -1});`;

      case bytecode.ROP_NEG:
        return `acc=$.neg(acc,${o[0] ?? -1});`;

      case bytecode.ROP_TYPEOF:
        return `acc=$.typeofOp(acc);`;

      case bytecode.ROP_JUMP:
        return `pc=${o[0]};continue L;`;

      case bytecode.ROP_JUMP_IF_FALSE: {
        const fbSlot = o.length > 1 ? o[1] : -1;
        return `if(!$.toBool(acc)){$.branch(${fbSlot},true);pc=${o[0]};continue L;}$.branch(${fbSlot},false);`;
      }

      case bytecode.ROP_JUMP_IF_TRUE: {
        const fbSlot = o.length > 1 ? o[1] : -1;
        return `if($.toBool(acc)){$.branch(${fbSlot},true);pc=${o[0]};continue L;}$.branch(${fbSlot},false);`;
      }

      case bytecode.ROP_CALL: {
        const calleeReg = o[0];
        const arg0Reg = o[1];
        const argCount = o[2];
        const fbSlot = o.length > 3 ? o[3] : 0;
        const isTailCall =
          nextInstr && nextInstr.opcode === bytecode.ROP_RETURN;
        const prefix = isTailCall ? "return " : "acc=";
        if (argCount === 0)
          return `${prefix}$.invokeCall0(r[${calleeReg}],${fbSlot});`;
        if (argCount === 1)
          return `${prefix}$.invokeCall1(r[${calleeReg}],r[${arg0Reg}],${fbSlot});`;
        if (argCount === 2)
          return `${prefix}$.invokeCall2(r[${calleeReg}],r[${arg0Reg}],r[${arg0Reg + 1}],${fbSlot});`;
        let argArr = "";
        for (let i = 0; i < argCount; i++) {
          if (i > 0) argArr += ",";
          argArr += `r[${arg0Reg + i}]`;
        }
        return `${prefix}$.invokeCall(r[${calleeReg}],[${argArr}],$.u,${fbSlot},null);`;
      }

      case bytecode.ROP_CALL_METHOD: {
        const receiverReg = o[0];
        const arg0Reg = o[1];
        const argCount = o[2];
        const fbSlot = o.length > 3 ? o[3] : 0;
        let argArr = "";
        for (let i = 0; i < argCount; i++) {
          if (i > 0) argArr += ",";
          argArr += `r[${arg0Reg + i}]`;
        }
        return `acc=$.callMethod(acc,r[${receiverReg}],[${argArr}],${fbSlot});`;
      }

      case bytecode.ROP_NEW: {
        const calleeReg = o[0];
        const arg0Reg = o[1];
        const argCount = o[2];
        const fb = o.length > 3 ? o[3] : -1;
        if (argCount === 0) return `acc=$.rcn(r[${calleeReg}],[],${fb});`;
        if (argCount === 1)
          return `acc=$.rcn(r[${calleeReg}],[r[${arg0Reg}]],${fb});`;
        if (argCount === 2)
          return `acc=$.rcn(r[${calleeReg}],[r[${arg0Reg}],r[${arg0Reg + 1}]],${fb});`;
        let argArr = "";
        for (let i = 0; i < argCount; i++) {
          if (i > 0) argArr += ",";
          argArr += `r[${arg0Reg + i}]`;
        }
        return `acc=$.rcn(r[${calleeReg}],[${argArr}],${fb});`;
      }

      case bytecode.ROP_NEW_OBJECT:
        return `acc=$.newObj();`;

      case bytecode.ROP_NEW_ARRAY: {
        const startReg = o[0];
        const count = o[1];
        let elements = "";
        for (let i = 0; i < count; i++) {
          if (i > 0) elements += ",";
          elements += `r[${startReg + i}]`;
        }
        return `acc=$.newArr([${elements}]);`;
      }

      case bytecode.ROP_RETURN:
        return `return acc;`;

      case bytecode.ROP_LDA_THIS:
        return `acc=tv;`;

      case bytecode.ROP_LDA_UNDEFINED:
        return `acc=$.u;`;

      case bytecode.ROP_LDA_NULL:
        return `acc=$.n;`;

      case bytecode.ROP_LDA_TRUE:
        return `acc=$.t;`;

      case bytecode.ROP_LDA_FALSE:
        return `acc=$.f;`;

      case bytecode.ROP_LDA_UPVALUE:
        return `acc=_ce?_ce[${o[0]}].get():$.u;`;

      case bytecode.ROP_STA_UPVALUE:
        return `if(_ce)_ce[${o[0]}].set(acc);`;

      case bytecode.ROP_MAKE_CLOSURE:
        return `acc=$.closure($.cf.constants[${o[0]}],r,_ce,_ouv);`;

      case bytecode.ROP_TEST_FEEDBACK:
        return ``;

      case bytecode.ROP_BITAND:
        return `t=r[${o[0]}];acc=$.bitand(acc,t,${o[1]});`;
      case bytecode.ROP_BITOR:
        return `t=r[${o[0]}];acc=$.bitor(acc,t,${o[1]});`;
      case bytecode.ROP_BITXOR:
        return `t=r[${o[0]}];acc=$.bitxor(acc,t,${o[1]});`;
      case bytecode.ROP_SHL:
        return `t=r[${o[0]}];acc=$.shl(acc,t,${o[1]});`;
      case bytecode.ROP_SHR:
        return `t=r[${o[0]}];acc=$.shr(acc,t,${o[1]});`;
      case bytecode.ROP_USHR:
        return `t=r[${o[0]}];acc=$.ushr(acc,t,${o[1]});`;
      case bytecode.ROP_POW:
        return `t=r[${o[0]}];acc=$.pow(acc,t,${o[1]});`;
      case bytecode.ROP_BITNOT:
        return `acc=$.bitnot(acc,${o[0]});`;
      case bytecode.ROP_INSTANCEOF:
        return `t=r[${o[0]}];acc=$.instanceofOp(acc,t,${o[1]});`;
      case bytecode.ROP_IN:
        return `t=r[${o[0]}];acc=$.inOp(acc,t,${o[1]});`;
      case bytecode.ROP_VOID:
        return `acc=$.u;`;
      case bytecode.ROP_DELETE_PROP:
        return `acc=$.deleteProp(r[${o[0]}],${o[1]});`;

      case bytecode.ROP_LOOSE_EQ:
        return `t=r[${o[0]}];acc=$.looseEq(acc,t,${o[1]});`;

      case bytecode.ROP_LOOSE_NEQ:
        return `t=r[${o[0]}];acc=$.looseNeq(acc,t,${o[1]});`;

      case bytecode.ROP_IS_NULLISH:
        return `acc=$.isNullish(acc)?$.t:$.f;`;

      case bytecode.ROP_NEW_REGEX:
        return `acc=$.newRegex(${o[0]});`;

      case bytecode.ROP_GET_LENGTH:
        return `acc=$.getLength(r[${o[0]}]);`;

      case bytecode.ROP_GET_KEYS:
        return `acc=$.getKeys(r[${o[0]}]);`;

      case bytecode.ROP_REST_ARGS:
        return `acc=$.restArgs(r,${o[0]},args.length);`;

      case bytecode.ROP_SPREAD_ARRAY:
        return `acc=$.spreadArray(r[${o[0]}]);`;

      case bytecode.ROP_COPY_PROPS:
        return `$.copyProps(r[${o[0]}],acc);`;

      case bytecode.ROP_STA_COMPUTED_PROP:
        return `$.setComputedProp(r[${o[0]}],r[${o[1]}],acc);`;

      case bytecode.ROP_CALL_SPREAD:
        return `acc=$.callSpread(r[${o[0]}],r[${o[1]}]);`;

      case bytecode.ROP_ARRAY_PUSH:
        return `$.arrayPush(r[${o[0]}],acc);`;

      case bytecode.ROP_TRY_START:
      case bytecode.ROP_TRY_END:
      case bytecode.ROP_THROW:
        return `throw new Error('Unsupported baseline opcode');`;

      default:
        return `throw new Error('Unsupported baseline opcode');`;
    }
  }
}
