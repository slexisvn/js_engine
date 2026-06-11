# Fuzzing TODO — MiniJIT

Kế hoạch fuzz từng phần của engine. Mục tiêu: bắt hết lỗi correctness bằng
**differential testing** (so engine với một oracle đáng tin).

## Phương pháp chung

- **Oracle chính**: Node `eval` trên cùng source. So `toDisplayString(engine.run(src))`
  với `String(nodeResult)`, có normalize `-0`→`0`, `NaN`, array/object.
- **Generator**: PRNG có seed (tái lập được), grammar đệ quy giới hạn độ sâu.
- **Reduce**: khi fail, ghi source ra file trước khi chạy để bắt được ca OOM/hang;
  rồi rút gọn thủ công về ca nhỏ nhất.
- **Dùng 1 engine** dùng lại cho nhiều chương trình (tránh OOM do hidden-class global).
- **Tiering**: lặp lời gọi ≥180 lần để ép baseline + optimized, so kết quả ở mọi tier.
- Script fuzz là tạm thời — viết, chạy, **xóa**; bug thì fix, fix xong viết test vào
  đúng file test có sẵn.

---

## Trạng thái

- [x] Số học + ép kiểu nguyên thuỷ + Math (interpreter & JIT) — *đã fuzz, đã fix*
  - [x] unary `+` không parse được
  - [x] ToPrimitive/ToString của array/object sai (`String([..])`, `+[]`, `1+{}`, `[]<x`, `[]%n`)
- [x] Frontend parser: precedence/associativity, `?.`, `??`, member/index, sequence — *đã fuzz*
  - [x] Toán tử sequence `(a, b)` không parse được → thêm `SequenceExpression`
- [x] Relational `< > <= >=` trên array/object sai (thiếu ToPrimitive) — *fix cả 3 tier:
      interpreter, baseline, wasm optimizer*; thêm helper `abstractRelational`
  - [x] Bug soundness JIT: optimized code so sánh array trả sai mà **không deopt**
- [x] Exceptions (try/catch/finally) + nested loops — *đã fuzz 50k chương trình*
  - [x] Vòng `for(let …)` lồng nhau / trong catch/finally chạy thiếu lần lặp
        (register temp đè biến loop) — fix `addLocal`
  - [x] `for(let i){for(let i)}` cùng tên bị share slot — fix scope resolution
- [x] Closures / Scope (#3) — *đã fuzz closure-capture*
  - [x] Per-iteration `let`/`const` binding cho closure: `for(let)`, `while(){let}`,
        `for-of`, `for-in` giờ trả `0,1,2` đúng — thêm opcode `ROP_CLOSE_UPVALUES`
        (đóng upvalue mỗi vòng lặp), chỉ emit khi thân loop có function (loop số học
        vẫn optimize bình thường)
  - [x] Nested `for-of`/`for-in` share slot `_iter$`/`_iterResult$`/`_keys$` →
        corrupt iterator vòng ngoài; fix: mỗi loop cấp slot riêng + compile iterable
        trước khi cấp slot nội bộ (tránh array literal bị non-contiguous)
  - [x] **Register contiguity**: array literal VÀ call/new arguments yêu cầu register
        liên tiếp nhưng `temps.alloc()` từng phần bị non-contiguous khi free-list phân mảnh
        (vd `matmul(a,b)` với `var a/b=[[..]]` → param undefined; `for(...){let x;
        for(const j of [0,1,2])}` → array sai). Fix: thêm `allocContiguous` dùng cho cả
        array literal, CallExpression, CallMethod, NewExpression.
  - [x] `for(let i){for(const i of …)}` cùng tên: for-of/for-in giờ tạo child scope →
        biến lặp shadow đúng (trước đây share slot với biến ngoài → loop ngoài chạy 1 lần)
  - [ ] *Còn lại (chưa fix)*: `arguments` object chưa hỗ trợ (`arguments is not defined`)

---

## 1. Frontend — Lexer / Parser

- [ ] **Lexer**: numeric literals (`0x`, `0b`, `0o`, `1e10`, `.5`, `1_000`, `1n`),
      string escapes (`\u{...}`, `\xNN`, `\n`, line-continuation), template literals,
      regex vs chia (`/` ambiguity), ASI, comment lồng, Unicode identifier.
- [ ] **Parser**: precedence/associativity mọi toán tử (so cây với cấu trúc kỳ vọng),
      `?.` optional chaining, `??`, spread/rest, destructuring (array/object/nested/default),
      arrow vs paren-expr, trailing comma, `for-in`/`for-of`, label, `switch` fallthrough,
      object literal (computed key, getter/setter, shorthand, `__proto__`).
- [ ] **Oracle**: round-trip — parse → (nếu có) re-emit → so; hoặc so kết quả chạy với Node.
- [ ] **Edge**: input ngẫu nhiên hợp lệ về mặt token nhưng sai cú pháp → engine phải
      ném lỗi parse, **không crash/treo**.

## 2. Bytecode — Compiler / Interpreter

- [ ] Mọi opcode binary/unary với mọi cặp kiểu (smi/double/string/bool/null/undefined/obj/array).
- [ ] Bitwise & shift: `>>>`, `<<` với số âm/lớn (ToInt32/ToUint32, wrap quanh 2^32).
- [ ] `**` (lũy thừa), `%` với 0/Infinity/NaN/số âm.
- [x] So sánh: relational với chuỗi vs số vs object — *fixed (xem Trạng thái)*
- [x] **Cấp phát register/temp**: biến `let` cục bộ khai báo giữa chừng (loop lồng,
      loop trong catch/finally) **trùng register với temp** → loop chạy thiếu lần lặp.
      Fix `addLocal` (luôn lấy register mới ở đỉnh, không tái dùng slot temp).
- [x] Block-scope: `let`/`const` lồng cùng tên (`for(let i){for(let i)}`) phải tách binding
      — fix `compileLetDeclaration` chỉ reuse trong scope hiện tại, không leo chain.
- [ ] Control flow còn lại: `do/while`, `break/continue` có label, `switch` fallthrough.
- [ ] TDZ: dùng `let`/`const` trước khi khởi tạo phải ném ReferenceError.

## 3. Functions / Scope / Closures

- [ ] Closure bắt biến qua nhiều cấp, biến vòng lặp (`let` vs `var` trong loop).
- [ ] `arguments`, rest param, default param (eval theo thứ tự, tham chiếu param trước).
- [ ] Recursion sâu → stack overflow phải báo lỗi sạch, không crash process.
- [ ] Hoisting: function declaration vs expression, `var` hoisting.
- [ ] `this`: gọi thường / method / `call`/`apply`/`bind` / arrow (lexical this).
- [ ] Lazy compilation (`compileLazy`) — so kết quả lazy vs eager.

## 4. Objects / Arrays / Hidden Classes

- [ ] Thêm/xoá property theo nhiều thứ tự → cùng shape; hidden-class transition.
- [ ] Property: integer-index vs string key, computed, getter/setter, `delete`.
- [ ] Array: holes/sparse, `length` co/giãn, gán ngoài biên, elements-kind transition
      (smi→double→object), `push/pop/shift/unshift/splice`.
- [ ] `Object.freeze/seal/preventExtensions` + ghi vào → no-op/throw đúng strict.
- [ ] Prototype chain: shadowing, `__proto__`, `Object.create`, vòng lặp proto.
- [ ] **Thiếu built-in?** đã thấy `[].toString()` ném lỗi — quét toàn bộ
      `Array/String/Object/Number.prototype` methods so với Node.

## 5. Runtime intrinsics (string/number/array/regex/collection methods)

- [ ] **String**: `slice/substring/substr` (index âm), `indexOf/includes/split`,
      `replace`/`replaceAll` (regex + callback + `$1`), `padStart/repeat`, Unicode/surrogate.
- [ ] **Number**: `toFixed/toPrecision/toString(radix)`, `parseInt/parseFloat` edge.
- [ ] **Array**: `map/filter/reduce/forEach/sort` (comparator + ổn định), `flat/flatMap`,
      `find/some/every`, `slice/concat`, callback ném lỗi giữa chừng.
- [ ] **Regex**: backref, lookahead/behind, flags `gimsuy`, `lastIndex` với `g`,
      `match/matchAll/exec`, catastrophic backtracking (đặt timeout).
- [ ] **Collections**: `Map/Set/WeakMap` — key bằng `SameValueZero`, thứ tự lặp,
      `-0`/`NaN` làm key, kích thước lớn.

## 6. Iterators / Generators

- [ ] `for-of` trên array/string/Map/Set/custom iterable; protocol `Symbol.iterator`.
- [ ] Generator: `yield`, `yield*`, `.next(v)`/`.return()`/`.throw()`, return value,
      generator lồng, early termination.
- [ ] Spread `[...iter]`, destructuring từ iterator, iterator vô hạn + lấy hữu hạn.

## 7. Async / Promise / Microtasks

- [ ] Thứ tự microtask vs sync (so log order với Node).
- [ ] `Promise.all/race/allSettled/any`, resolve bằng thenable, chuỗi `.then` dài.
- [ ] `async/await`: nhiều await, await trong loop, throw/reject + try-catch.
- [ ] `drainMicrotasks`/checkpoint — không bỏ sót/lặp task.

## 8. Exceptions

- [ ] `try/catch/finally`: throw trong try/catch/finally, `finally` override return,
      throw qua biên hàm/loop/generator, rethrow.
- [ ] Lỗi built-in: TypeError/RangeError/ReferenceError đúng loại + message.
- [ ] Đảm bảo throw không làm hỏng state interpreter (stack/frame sạch sau catch).

## 9. JIT — Baseline / Optimizer / Wasm codegen

- [ ] **Differential interpreter vs optimized**: cùng hàm, ép tier-up, so từng kết quả.
- [ ] Type feedback đổi giữa chừng (hàm gọi với smi rồi string) → deopt đúng, kết quả đúng.
- [ ] Passes: GVN, DCE, load-elimination, escape-analysis, allocation-sinking — verify
      không đổi semantics (so optimized vs interpreter trên cùng input).
- [ ] Loop OSR: vào optimized giữa vòng lặp nóng, kết quả khớp.
- [ ] Integer overflow/representation selection (smi↔double) ở code đã tối ưu.

## 10. Deopt

- [ ] Eager + lazy deopt: ép điều kiện guard sai → quay về interpreter, **frame-state
      khôi phục đúng** mọi biến cục bộ.
- [ ] Deopt giữa biểu thức phức tạp / trong loop / sau inlining.
- [ ] Dependency invalidation: đổi shape/version hàm sau khi đã optimize → invalidate đúng.
- [ ] Materializer: object bị escape-analysis "ảo hoá" phải tái tạo đúng khi deopt.

## 11. Inlining

- [ ] Inline hàm nhỏ rồi deopt; recursion + inline (giới hạn độ sâu).
- [ ] Inline với param mặc định/rest, `this`, closure upvalue.

## 12. GC (Generational)

- [ ] Alloc nhiều → minor GC; promote sang old gen; major GC.
- [ ] Write barrier / remembered set: old→young reference giữ sống đúng object.
- [ ] Object graph có vòng, mảng lớn, chuỗi dài → không mất/không giữ nhầm.
- [ ] Stress: alloc/discard liên tục, kiểm tra không leak (memory bounded) và không
      free nhầm (kết quả vẫn đúng).

## 13. Inline Caches (feedback/ic)

- [ ] Monomorphic → polymorphic → megamorphic transition (gọi cùng site với nhiều shape).
- [ ] IC cho load/store property, call, instanceof — kết quả khớp interpreter chậm.
- [ ] Invalidation khi proto/shape đổi.

## 14. Proxy / Exotic

- [ ] Mọi trap: `get/set/has/deleteProperty/ownKeys/getOwnPropertyDescriptor/apply/construct`.
- [ ] Invariant enforcement (trap trả giá trị vi phạm → throw).
- [ ] Proxy bọc array/function, Reflect tương ứng.

## 15. Robustness (không cần oracle — chỉ cần "không crash")

- [ ] Input khổng lồ: chuỗi/array rất lớn, lồng rất sâu (nesting depth).
- [ ] Đệ quy/loop vô hạn → có giới hạn & báo lỗi, không treo process.
- [ ] Self-reference: `a=[]; a.push(a); String(a)` (cyclic toString → phải xử lý, không tràn stack).
- [ ] Đa engine: tạo/huỷ nhiều `MiniJIT` — kiểm tra isolation & memory
      (hiện hidden-class là global → cần `reset()`; cân nhắc fix isolate).

---

## Conformance (sau khi fuzz)

- [ ] Chạy **test262** (bộ test chính thức ECMAScript) để đo % spec đạt được.
- [ ] Đưa differential fuzzer vào CI chạy định kỳ với seed ngẫu nhiên.
