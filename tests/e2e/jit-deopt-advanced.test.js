import { describe, it, expect, beforeEach } from "vitest";
import { MiniJIT } from "../../src/api/engine.js";
import { getPayload } from "../../src/core/value/index.js";

function jitEngine() {
  return new MiniJIT({
    tieringPolicy: { jitThreshold: 5, baselineThreshold: 2 },
  });
}

describe("E2E: JIT comparison operators", () => {
  let engine;
  beforeEach(() => { engine = jitEngine(); });

  it("less-than after int training deopts to float", () => {
    const r = engine.runValue(`
      function lt(a,b){return a<b;}
      for(var i=0;i<10;i++) lt(i,5);
      lt(1.5, 2.5);
    `);
    expect(r.value).toBe(true);
  });

  it("greater-than with type change", () => {
    const r = engine.runValue(`
      function gt(a,b){return a>b;}
      for(var i=0;i<10;i++) gt(i,5);
      gt(10.5, 2.5);
    `);
    expect(r.value).toBe(true);
  });

  it("strict equality int then string", () => {
    const r = engine.runValue(`
      function eq(a,b){return a===b;}
      for(var i=0;i<10;i++) eq(i,i);
      eq("hello","hello");
    `);
    expect(r.value).toBe(true);
  });

  it("not-equal int then string", () => {
    const r = engine.runValue(`
      function ne(a,b){return a!==b;}
      for(var i=0;i<10;i++) ne(i,5);
      ne("a","b");
    `);
    expect(r.value).toBe(true);
  });

  it("less-than-or-equal preserves semantics", () => {
    const r = engine.runValue(`
      function lte(a,b){return a<=b;}
      for(var i=0;i<10;i++) lte(i,5);
      lte(5.0, 5.0);
    `);
    expect(r.value).toBe(true);
  });

  it("greater-than-or-equal preserves semantics", () => {
    const r = engine.runValue(`
      function gte(a,b){return a>=b;}
      for(var i=0;i<10;i++) gte(i,5);
      gte(3.0, 3.0);
    `);
    expect(r.value).toBe(true);
  });
});

describe("E2E: JIT bitwise and unary operators", () => {
  let engine;
  beforeEach(() => { engine = jitEngine(); });

  it("bitwise AND after int training", () => {
    const r = engine.runValue(`
      function band(a,b){return a&b;}
      for(var i=0;i<10;i++) band(i,7);
      band(255, 15);
    `);
    expect(r.value).toBe(15);
  });

  it("bitwise OR", () => {
    const r = engine.runValue(`
      function bor(a,b){return a|b;}
      for(var i=0;i<10;i++) bor(i,0);
      bor(10, 5);
    `);
    expect(r.value).toBe(15);
  });

  it("bitwise XOR", () => {
    const r = engine.runValue(`
      function bxor(a,b){return a^b;}
      for(var i=0;i<10;i++) bxor(i,i);
      bxor(255, 128);
    `);
    expect(r.value).toBe(127);
  });

  it("left shift", () => {
    const r = engine.runValue(`
      function shl(a,b){return a<<b;}
      for(var i=0;i<10;i++) shl(i,1);
      shl(5, 3);
    `);
    expect(r.value).toBe(40);
  });

  it("right shift", () => {
    const r = engine.runValue(`
      function shr(a,b){return a>>b;}
      for(var i=0;i<10;i++) shr(i,1);
      shr(40, 3);
    `);
    expect(r.value).toBe(5);
  });

  it("unary negate after int training", () => {
    const r = engine.runValue(`
      function neg(a){return -a;}
      for(var i=0;i<10;i++) neg(i);
      neg(42);
    `);
    expect(r.value).toBe(-42);
  });

  it("bitwise NOT", () => {
    const r = engine.runValue(`
      function bnot(a){return ~a;}
      for(var i=0;i<10;i++) bnot(i);
      bnot(0);
    `);
    expect(r.value).toBe(-1);
  });

  it("typeof after int training with string input", () => {
    const r = engine.runValue(`
      function typOf(x){return typeof x;}
      for(var i=0;i<10;i++) typOf(i);
      typOf("hello");
    `);
    expect(r.value).toBe("string");
  });
});

describe("E2E: JIT array and string ops", () => {
  let engine;
  beforeEach(() => { engine = jitEngine(); });

  it("array push under JIT", () => {
    const r = engine.runValue(`
      function pushN(arr,n){for(var i=0;i<n;i++) arr.push(i);return arr.length;}
      for(var k=0;k<10;k++) pushN([],5);
      pushN([], 10);
    `);
    expect(r.value).toBe(10);
  });

  it("array index access under JIT", () => {
    const r = engine.runValue(`
      function getIdx(arr,i){return arr[i];}
      var a=[10,20,30,40,50];
      for(var k=0;k<10;k++) getIdx(a,0);
      getIdx(a, 4);
    `);
    expect(r.value).toBe(50);
  });

  it("string charAt under JIT", () => {
    const r = engine.runValue(`
      function ch(s,i){return s.charAt(i);}
      for(var k=0;k<10;k++) ch("hello",0);
      ch("world", 3);
    `);
    expect(r.value).toBe("l");
  });

  it("string concat under JIT", () => {
    const r = engine.runValue(`
      function cat(a,b){return a+b;}
      for(var k=0;k<10;k++) cat("x","y");
      cat("hello", " world");
    `);
    expect(r.value).toBe("hello world");
  });
});

describe("E2E: JIT type-change deopts", () => {
  let engine;
  beforeEach(() => { engine = jitEngine(); });

  it("add: int trained, float deopt", () => {
    const r = engine.runValue(`
      function add(a,b){return a+b;}
      for(var i=0;i<10;i++) add(i,i);
      add(1.5, 2.5);
    `);
    expect(r.value).toBe(4);
  });

  it("add: int trained, string deopt", () => {
    const r = engine.runValue(`
      function add(a,b){return a+b;}
      for(var i=0;i<10;i++) add(i,i);
      add("hello", " world");
    `);
    expect(r.value).toBe("hello world");
  });

  it("subtract: int trained, float deopt", () => {
    const r = engine.runValue(`
      function sub(a,b){return a-b;}
      for(var i=0;i<10;i++) sub(i,1);
      sub(5.5, 2.3);
    `);
    expect(r.value).toBeCloseTo(3.2);
  });

  it("multiply: int trained, float deopt", () => {
    const r = engine.runValue(`
      function mul(a,b){return a*b;}
      for(var i=0;i<10;i++) mul(i,2);
      mul(2.5, 4.0);
    `);
    expect(r.value).toBe(10);
  });

  it("modulo: int trained, float deopt", () => {
    const r = engine.runValue(`
      function mod(a,b){return a%b;}
      for(var i=0;i<10;i++) mod(i,3);
      mod(7.5, 2.0);
    `);
    expect(r.value).toBe(1.5);
  });

  it("comparison: int trained, string comparison deopt", () => {
    const r = engine.runValue(`
      function cmp(a,b){return a<b;}
      for(var i=0;i<10;i++) cmp(i,5);
      cmp("apple","banana");
    `);
    expect(r.value).toBe(true);
  });

  it("mixed add in loop: starts int then encounters float mid-loop", () => {
    const r = engine.runValue(`
      function add(a,b){return a+b;}
      for(var i=0;i<10;i++) add(i,i);
      var sum=0;
      sum=add(1,2);
      sum=add(sum, 0.5);
      sum;
    `);
    expect(r.value).toBe(3.5);
  });
});

describe("E2E: JIT property deopts", () => {
  let engine;
  beforeEach(() => { engine = jitEngine(); });

  it("property access after delete", () => {
    const r = engine.runValue(`
      function getX(o){return o.x;}
      var obj={x:10,y:20};
      for(var i=0;i<10;i++) getX(obj);
      delete obj.x;
      getX(obj);
    `);
    expect(r.tag).toBe("undefined");
  });

  it("property access on different shaped object", () => {
    const r = engine.runValue(`
      function getV(o){return o.v;}
      for(var i=0;i<10;i++) getV({v:i});
      getV({v:42, extra:true});
    `);
    expect(r.value).toBe(42);
  });

  it("computed property access with key change", () => {
    const r = engine.runValue(`
      function get(o,k){return o[k];}
      var obj={a:10,b:20};
      for(var i=0;i<10;i++) get(obj,"a");
      get(obj,"b");
    `);
    expect(r.value).toBe(20);
  });
});

describe("E2E: JIT argument mismatches", () => {
  let engine;
  beforeEach(() => { engine = jitEngine(); });

  it("too few arguments after int training", () => {
    const r = engine.runValue(`
      function add(a,b){return a+b;}
      for(var i=0;i<10;i++) add(i,i);
      add(5);
    `);
    expect(r.value).toBeNaN();
  });

  it("too many arguments after int training", () => {
    const r = engine.runValue(`
      function add(a,b){return a+b;}
      for(var i=0;i<10;i++) add(i,i);
      add(10, 20, 30, 40);
    `);
    expect(r.value).toBe(30);
  });

  it("undefined arg after int training", () => {
    const r = engine.runValue(`
      function add(a,b){return a+b;}
      for(var i=0;i<10;i++) add(i,i);
      add(5, undefined);
    `);
    expect(r.value).toBeNaN();
  });

  it("null arg after int training", () => {
    const r = engine.runValue(`
      function add(a,b){return a+b;}
      for(var i=0;i<10;i++) add(i,i);
      add(5, null);
    `);
    expect(r.value).toBe(5);
  });

  it("boolean arg after int training", () => {
    const r = engine.runValue(`
      function add(a,b){return a+b;}
      for(var i=0;i<10;i++) add(i,i);
      add(10, true);
    `);
    expect(r.value).toBe(11);
  });
});

describe("E2E: JIT polymorphic and dynamic dispatch", () => {
  let engine;
  beforeEach(() => { engine = jitEngine(); });

  it("polymorphic calls with different object shapes", () => {
    const r = engine.runValue(`
      function getX(o){return o.x;}
      for(var i=0;i<10;i++) getX({x:i});
      getX({x:100, y:200, z:300});
    `);
    expect(r.value).toBe(100);
  });

  it("method call on JIT-trained object", () => {
    const r = engine.runValue(`
      function callM(o){return o.m();}
      var obj={m:function(){return 42;}};
      for(var i=0;i<10;i++) callM(obj);
      var obj2={m:function(){return 99;}};
      callM(obj2);
    `);
    expect(r.value).toBe(99);
  });

  it("nested function calls under JIT", () => {
    const r = engine.runValue(`
      function inner(x){return x*2;}
      function outer(x){return inner(x)+1;}
      for(var i=0;i<10;i++) outer(i);
      outer(50);
    `);
    expect(r.value).toBe(101);
  });
});

describe("E2E: JIT mid-loop deopt", () => {
  let engine;
  beforeEach(() => { engine = jitEngine(); });

  it("deopt mid-loop preserves accumulated state", () => {
    const r = engine.runValue(`
      function add(a,b){return a+b;}
      for(var i=0;i<10;i++) add(i,i);
      var sum=0;
      for(var j=0;j<5;j++){
        if(j===3) sum=add(sum, 0.5);
        else sum=add(sum,j);
      }
      sum;
    `);
    expect(r.value).toBe(7.5);
  });

  it("array elements kind transition mid-loop", () => {
    const r = engine.runValue(`
      function add(a,b){return a+b;}
      for(var i=0;i<10;i++) add(i,i);
      var arr=[1,2,3,4,5];
      var sum=0;
      for(var k=0;k<arr.length;k++){
        if(k===3) arr[k]=0.5;
        sum=add(sum,arr[k]);
      }
      sum;
    `);
    expect(r.value).toBe(11.5);
  });
});

describe("E2E: JIT control flow", () => {
  let engine;
  beforeEach(() => { engine = jitEngine(); });

  it("ternary operator under JIT", () => {
    const r = engine.runValue(`
      function abs(x){return x>=0?x:-x;}
      for(var i=0;i<10;i++) abs(i);
      abs(-42);
    `);
    expect(r.value).toBe(42);
  });

  it("while loop under JIT", () => {
    const r = engine.runValue(`
      function countDown(n){var s=0;while(n>0){s+=n;n--;}return s;}
      for(var i=0;i<10;i++) countDown(5);
      countDown(100);
    `);
    expect(r.value).toBe(5050);
  });

  it("do-while under JIT", () => {
    const r = engine.runValue(`
      function doLoop(n){var s=0;var i=1;do{s+=i;i++;}while(i<=n);return s;}
      for(var k=0;k<10;k++) doLoop(5);
      doLoop(10);
    `);
    expect(r.value).toBe(55);
  });

  it("early return in optimized function", () => {
    const r = engine.runValue(`
      function search(arr,v){
        for(var i=0;i<arr.length;i++) if(arr[i]===v) return i;
        return -1;
      }
      var a=[5,10,15,20,25];
      for(var k=0;k<10;k++) search(a,15);
      search(a,25);
    `);
    expect(r.value).toBe(4);
  });

  it("try-catch under JIT", () => {
    const r = engine.runValue(`
      function safe(x){
        try{if(x<0) throw "neg";return x*2;}
        catch(e){return -1;}
      }
      for(var i=0;i<10;i++) safe(i);
      safe(-5);
    `);
    expect(r.value).toBe(-1);
  });

  it("multiple return paths under JIT", () => {
    const r = engine.runValue(`
      function classify(n){
        if(n<0) return "negative";
        if(n===0) return "zero";
        if(n<10) return "small";
        return "big";
      }
      for(var i=0;i<10;i++) classify(i);
      classify(-5) + "," + classify(0) + "," + classify(5) + "," + classify(100);
    `);
    expect(r.value).toBe("negative,zero,small,big");
  });
});

describe("E2E: JIT closures and scope", () => {
  let engine;
  beforeEach(() => { engine = jitEngine(); });

  it("closure mutation under JIT", () => {
    const r = engine.runValue(`
      function makeCounter(){var c=0;return function(){c++;return c;};}
      var inc=makeCounter();
      for(var i=0;i<10;i++) inc();
      inc();
    `);
    expect(r.value).toBe(11);
  });

  it("closure over loop variable under JIT", () => {
    const r = engine.runValue(`
      function make(){var fns=[];for(var i=0;i<5;i++){fns.push(function(){return i;});}return fns;}
      var fns=make();
      fns[0]() + "," + fns[4]();
    `);
    expect(r.value).toBe("5,5");
  });
});

describe("E2E: JIT with constructors", () => {
  let engine;
  beforeEach(() => { engine = jitEngine(); });

  it("constructor called repeatedly under JIT", () => {
    const r = engine.runValue(`
      function Point(x,y){this.x=x;this.y=y;}
      for(var i=0;i<10;i++) new Point(i,i);
      var p=new Point(3,4);
      p.x*p.x+p.y*p.y;
    `);
    expect(r.value).toBe(25);
  });

  it("method on constructed object under JIT", () => {
    const r = engine.runValue(`
      function Box(w,h){this.w=w;this.h=h;}
      function area(b){return b.w*b.h;}
      for(var i=0;i<10;i++) area(new Box(i,i));
      area(new Box(7,8));
    `);
    expect(r.value).toBe(56);
  });
});

describe("E2E: JIT deopt-reopt cycles", () => {
  let engine;
  beforeEach(() => { engine = jitEngine(); });

  it("repeated deopt-reopt still produces correct results", () => {
    engine.run("function f(a,b){return a+b;} for(var i=0;i<10;i++) f(i,i);");
    const r1 = getPayload(engine.run('f("a","b")'));
    engine.run("for(var i=0;i<20;i++) f(i,i);");
    const r2 = getPayload(engine.run('f("c","d")'));
    engine.run("for(var i=0;i<30;i++) f(i,i);");
    const r3 = getPayload(engine.run("f(100,200)"));
    expect(r1).toBe("ab");
    expect(r2).toBe("cd");
    expect(r3).toBe(300);
  });

  it("reoptimization after deopt produces correct results", () => {
    const r = engine.runValue(`
      function add(a,b){return a+b;}
      for(var i=0;i<10;i++) add(i,i);
      add("x","y");
      for(var j=0;j<20;j++) add(j,j);
      add(100,200);
    `);
    expect(r.value).toBe(300);
  });
});

describe("E2E: JIT large loops", () => {
  let engine;
  beforeEach(() => { engine = jitEngine(); });

  it("large loop with JIT-compiled body", () => {
    const r = engine.runValue(`
      function bigLoop(){var s=0;for(var i=0;i<100000;i++) s+=1;return s;}
      bigLoop();
    `);
    expect(r.value).toBe(100000);
  });
});

describe("E2E: JIT coercion and edge cases", () => {
  let engine;
  beforeEach(() => { engine = jitEngine(); });

  it("string-to-number coercion after int training", () => {
    const r = engine.runValue(`
      function add(a,b){return a+b;}
      for(var i=0;i<10;i++) add(i,i);
      add("3","4");
    `);
    expect(r.value).toBe("34");
  });

  it("default params handled correctly after JIT", () => {
    const r = engine.runValue(`
      function f(a,b){if(b===undefined) b=10;return a+b;}
      for(var i=0;i<10;i++) f(i,i);
      f(5);
    `);
    expect(r.value).toBe(15);
  });

  it("register pressure: many parameters under JIT", () => {
    const r = engine.runValue(`
      function big(a,b,c,d,e,f,g,h){return (a+b)*(c-d)+(e*f)-(g*h);}
      for(var i=0;i<10;i++) big(1,2,3,4,5,6,7,8);
      big(10,20,30,40,10,30,20,40);
    `);
    expect(r.value).toBe(-800);
  });

  it("deopt preserves local variable state", () => {
    const r = engine.runValue(`
      function add(a,b){return a+b;}
      for(var i=0;i<10;i++) add(i,i);
      var x=100;
      var y=add(x, 0.5);
      x+y;
    `);
    expect(r.value).toBe(200.5);
  });

  it("chained property writes under JIT", () => {
    const r = engine.runValue(`
      function init(o){o.a=1;o.b=2;o.c=3;return o.a+o.b+o.c;}
      for(var i=0;i<10;i++) init({});
      init({});
    `);
    expect(r.value).toBe(6);
  });

  it("boundary comparisons under JIT", () => {
    const r = engine.runValue(`
      function clamp(v,lo,hi){if(v<lo) return lo;if(v>hi) return hi;return v;}
      for(var i=0;i<10;i++) clamp(i,2,8);
      clamp(0,1,10)+","+clamp(50,1,10)+","+clamp(5,1,10);
    `);
    expect(r.value).toBe("1,10,5");
  });

  it("array out-of-bounds after optimization", () => {
    const r = engine.runValue(`
      function getIdx(arr,i){return arr[i];}
      var a=[10,20,30];
      for(var k=0;k<10;k++) getIdx(a,0);
      getIdx(a, 99);
    `);
    expect(r.tag).toBe("undefined");
  });

  it("for-of loop under JIT", () => {
    const r = engine.runValue(`
      function sumOf(arr){var s=0;for(var v of arr) s+=v;return s;}
      for(var k=0;k<10;k++) sumOf([1,2,3]);
      sumOf([10,20,30,40]);
    `);
    expect(r.value).toBe(100);
  });

  it("destructuring under JIT", () => {
    const r = engine.runValue(`
      function sumPair(pair){var [a,b]=pair;return a+b;}
      for(var k=0;k<10;k++) sumPair([1,2]);
      sumPair([100,200]);
    `);
    expect(r.value).toBe(300);
  });

  it("mixed arithmetic: int then float in computation chain", () => {
    const r = engine.runValue(`
      function calc(x){return x*2+0.5;}
      for(var i=0;i<10;i++) calc(i);
      calc(10);
    `);
    expect(r.value).toBe(20.5);
  });

  it("return object from JIT-compiled function", () => {
    const r = engine.runValue(`
      function mk(a,b){return {sum:a+b, diff:a-b};}
      for(var i=0;i<10;i++) mk(i,1);
      var r=mk(10,3);
      r.sum+","+r.diff;
    `);
    expect(r.value).toBe("13,7");
  });

  it("map over array after JIT training", () => {
    const r = engine.runValue(`
      function dbl(x){return x*2;}
      for(var i=0;i<10;i++) dbl(i);
      [1,2,3,4,5].map(dbl).join(",");
    `);
    expect(r.value).toBe("2,4,6,8,10");
  });

  it("this binding in method calls under JIT", () => {
    const r = engine.runValue(`
      var obj={val:10,get:function(){return this.val;}};
      for(var i=0;i<10;i++) obj.get();
      obj.val=99;
      obj.get();
    `);
    expect(r.value).toBe(99);
  });
});
