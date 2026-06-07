import { describe, it, expect, beforeEach } from "vitest";
import { MiniJIT } from "../../src/api/engine.js";

describe("E2E: real algorithms", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("bubble sort", () => {
    const r = engine.runValue(`
      var arr = [5, 3, 8, 1, 2, 7, 4, 6];
      for (var i = 0; i < arr.length; i++) {
        for (var j = 0; j < arr.length - 1 - i; j++) {
          if (arr[j] > arr[j + 1]) {
            var tmp = arr[j];
            arr[j] = arr[j + 1];
            arr[j + 1] = tmp;
          }
        }
      }
      var result = "";
      for (var k = 0; k < arr.length; k++) {
        if (k > 0) result += ",";
        result += arr[k];
      }
      result;
    `);
    expect(r.value).toBe("1,2,3,4,5,6,7,8");
  });

  it("binary search", () => {
    const r = engine.runValue(`
      function bsearch(arr, target) {
        var lo = 0;
        var hi = arr.length - 1;
        while (lo <= hi) {
          var mid = (lo + hi) >> 1;
          if (arr[mid] === target) return mid;
          if (arr[mid] < target) lo = mid + 1;
          else hi = mid - 1;
        }
        return -1;
      }
      var a = [2, 5, 8, 12, 16, 23, 38, 56, 72, 91];
      bsearch(a, 23) * 100 + bsearch(a, 99);
    `);
    expect(r.value).toBe(500 - 1);
  });

  it("greatest common divisor (Euclidean)", () => {
    const r = engine.runValue(`
      function gcd(a, b) {
        while (b !== 0) {
          var t = b;
          b = a % t;
          a = t;
        }
        return a;
      }
      gcd(48, 18);
    `);
    expect(r.value).toBe(6);
  });

  it("power function (fast exponentiation)", () => {
    const r = engine.runValue(`
      function power(base, exp) {
        var result = 1;
        while (exp > 0) {
          if (exp % 2 === 1) result *= base;
          base *= base;
          exp = (exp - exp % 2) / 2;
        }
        return result;
      }
      power(2, 10);
    `);
    expect(r.value).toBe(1024);
  });

  it("sieve of Eratosthenes", () => {
    const r = engine.runValue(`
      function sieve(n) {
        var is_prime = [];
        for (var i = 0; i <= n; i++) is_prime.push(true);
        is_prime[0] = false;
        is_prime[1] = false;
        for (var p = 2; p * p <= n; p++) {
          if (is_prime[p]) {
            for (var m = p * p; m <= n; m += p) {
              is_prime[m] = false;
            }
          }
        }
        var count = 0;
        for (var j = 0; j <= n; j++) {
          if (is_prime[j]) count++;
        }
        return count;
      }
      sieve(100);
    `);
    expect(r.value).toBe(25);
  });

  it("matrix multiplication 2x2", () => {
    const r = engine.runValue(`
      function matmul(a, b) {
        var result = [[0, 0], [0, 0]];
        for (var i = 0; i < 2; i++) {
          for (var j = 0; j < 2; j++) {
            for (var k = 0; k < 2; k++) {
              result[i][j] += a[i][k] * b[k][j];
            }
          }
        }
        return result;
      }
      var a = [[1, 2], [3, 4]];
      var b = [[5, 6], [7, 8]];
      var c = matmul(a, b);
      c[0][0] * 1000 + c[0][1] * 100 + c[1][0] * 10 + c[1][1];
    `);
    expect(r.value).toBe(19000 + 2200 + 430 + 50);
  });

  it("linked list traversal", () => {
    const r = engine.runValue(`
      function makeNode(val, next) {
        return {val: val, next: next};
      }
      var list = null;
      for (var i = 5; i >= 1; i--) {
        list = makeNode(i, list);
      }
      var sum = 0;
      var cur = list;
      while (cur !== null) {
        sum += cur.val;
        cur = cur.next;
      }
      sum;
    `);
    expect(r.value).toBe(15);
  });

  it("stack implementation with class", () => {
    const r = engine.runValue(`
      class Stack {
        constructor() {
          this.items = [];
          this.size = 0;
        }
        push(v) {
          this.items[this.size] = v;
          this.size++;
        }
        pop() {
          if (this.size === 0) return undefined;
          this.size--;
          return this.items[this.size];
        }
        peek() {
          if (this.size === 0) return undefined;
          return this.items[this.size - 1];
        }
      }

      var s = new Stack();
      s.push(10);
      s.push(20);
      s.push(30);
      var top = s.peek();
      var popped = s.pop();
      var second = s.peek();
      top * 100 + popped * 10 + second;
    `);
    expect(r.value).toBe(3320);
  });

  it("string reversal", () => {
    const r = engine.runValue(`
      function reverse(str) {
        var result = "";
        for (var i = str.length - 1; i >= 0; i--) {
          result += str[i];
        }
        return result;
      }
      reverse("hello");
    `);
    expect(r.value).toBe("olleh");
  });

  it("is palindrome check", () => {
    const r = engine.runValue(`
      function isPalindrome(s) {
        var len = s.length;
        for (var i = 0; i < len / 2; i++) {
          if (s[i] !== s[len - 1 - i]) return false;
        }
        return true;
      }
      var r1 = isPalindrome("racecar");
      var r2 = isPalindrome("hello");
      r1 && !r2;
    `);
    expect(r.value).toBe(true);
  });
});
