import { describe, it, expect, beforeEach } from "vitest";
import { MiniJIT } from "../../src/api/engine.js";

describe("E2E: advanced algorithms", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("merge sort", () => {
    const r = engine.runValue(`
      function merge(left, right) {
        var result = [];
        var i = 0;
        var j = 0;
        while (i < left.length && j < right.length) {
          if (left[i] <= right[j]) {
            result.push(left[i]);
            i++;
          } else {
            result.push(right[j]);
            j++;
          }
        }
        while (i < left.length) { result.push(left[i]); i++; }
        while (j < right.length) { result.push(right[j]); j++; }
        return result;
      }

      function mergeSort(arr) {
        if (arr.length <= 1) return arr;
        var mid = Math.floor(arr.length / 2);
        var left = mergeSort(arr.slice(0, mid));
        var right = mergeSort(arr.slice(mid));
        return merge(left, right);
      }

      var sorted = mergeSort([38, 27, 43, 3, 9, 82, 10]);
      sorted.join(",");
    `);
    expect(r.value).toBe("3,9,10,27,38,43,82");
  });

  it("quick sort (Lomuto partition)", () => {
    const r = engine.runValue(`
      function swap(arr, i, j) {
        var tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }

      function partition(arr, lo, hi) {
        var pivot = arr[hi];
        var i = lo;
        for (var j = lo; j < hi; j++) {
          if (arr[j] < pivot) {
            swap(arr, i, j);
            i++;
          }
        }
        swap(arr, i, hi);
        return i;
      }

      function qsort(arr, lo, hi) {
        if (lo < hi) {
          var p = partition(arr, lo, hi);
          qsort(arr, lo, p - 1);
          qsort(arr, p + 1, hi);
        }
      }

      var a = [5, 8, 1, 3, 9, 2, 7, 4, 6];
      qsort(a, 0, a.length - 1);
      a.join(",");
    `);
    expect(r.value).toBe("1,2,3,4,5,6,7,8,9");
  });

  it("depth-first search on adjacency list graph", () => {
    const r = engine.runValue(`
      var graph = {
        a: ["b", "c"],
        b: ["d"],
        c: ["d", "e"],
        d: ["f"],
        e: [],
        f: []
      };

      function dfs(graph, start) {
        var visited = {};
        var order = [];
        var stack = [start];
        while (stack.length > 0) {
          var node = stack.pop();
          if (visited[node]) continue;
          visited[node] = true;
          order.push(node);
          var neighbors = graph[node];
          for (var i = neighbors.length - 1; i >= 0; i--) {
            if (!visited[neighbors[i]]) stack.push(neighbors[i]);
          }
        }
        return order;
      }

      dfs(graph, "a").join(",");
    `);
    expect(r.value).toBe("a,b,d,f,c,e");
  });

  it("breadth-first search", () => {
    const r = engine.runValue(`
      var graph = {
        a: ["b", "c"],
        b: ["d"],
        c: ["d", "e"],
        d: [],
        e: []
      };

      function bfs(graph, start) {
        var visited = {};
        var order = [];
        var queue = [start];
        var front = 0;
        visited[start] = true;
        while (front < queue.length) {
          var node = queue[front];
          front++;
          order.push(node);
          var neighbors = graph[node];
          for (var i = 0; i < neighbors.length; i++) {
            if (!visited[neighbors[i]]) {
              visited[neighbors[i]] = true;
              queue.push(neighbors[i]);
            }
          }
        }
        return order;
      }

      bfs(graph, "a").join(",");
    `);
    expect(r.value).toBe("a,b,c,d,e");
  });

  it("memoized fibonacci (top-down DP)", () => {
    const r = engine.runValue(`
      var memo = {};
      function fib(n) {
        if (n <= 1) return n;
        if (memo[n] !== undefined) return memo[n];
        memo[n] = fib(n - 1) + fib(n - 2);
        return memo[n];
      }
      fib(30);
    `);
    expect(r.value).toBe(832040);
  });

  it("bottom-up DP: longest common subsequence length", () => {
    const r = engine.runValue(`
      function lcsLength(a, b) {
        var m = a.length;
        var n = b.length;
        var dp = [];
        for (var i = 0; i <= m; i++) {
          dp.push([]);
          for (var j = 0; j <= n; j++) {
            dp[i].push(0);
          }
        }
        for (var i = 1; i <= m; i++) {
          for (var j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
              dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
              dp[i][j] = dp[i - 1][j] > dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1];
            }
          }
        }
        return dp[m][n];
      }
      lcsLength("ABCBDAB", "BDCAB");
    `);
    expect(r.value).toBe(4);
  });

  it("flatten nested arrays recursively", () => {
    const r = engine.runValue(`
      function flatten(arr) {
        var result = [];
        for (var i = 0; i < arr.length; i++) {
          if (Array.isArray(arr[i])) {
            var sub = flatten(arr[i]);
            for (var j = 0; j < sub.length; j++) result.push(sub[j]);
          } else {
            result.push(arr[i]);
          }
        }
        return result;
      }
      flatten([1, [2, [3, 4], 5], [6, 7]]).join(",");
    `);
    expect(r.value).toBe("1,2,3,4,5,6,7");
  });

  it("run-length encoding", () => {
    const r = engine.runValue(`
      function rle(s) {
        if (s.length === 0) return "";
        var result = "";
        var count = 1;
        for (var i = 1; i < s.length; i++) {
          if (s[i] === s[i - 1]) {
            count++;
          } else {
            result += s[i - 1] + count;
            count = 1;
          }
        }
        result += s[s.length - 1] + count;
        return result;
      }
      rle("aaabbbccddddde");
    `);
    expect(r.value).toBe("a3b3c2d5e1");
  });

  it("balanced parentheses checker", () => {
    const r = engine.runValue(`
      function isBalanced(s) {
        var stack = [];
        var pairs = {};
        pairs[")"] = "(";
        pairs["]"] = "[";
        pairs["}"] = "{";
        for (var i = 0; i < s.length; i++) {
          var ch = s[i];
          if (ch === "(" || ch === "[" || ch === "{") {
            stack.push(ch);
          } else if (ch === ")" || ch === "]" || ch === "}") {
            if (stack.length === 0) return false;
            if (stack.pop() !== pairs[ch]) return false;
          }
        }
        return stack.length === 0;
      }
      var r1 = isBalanced("({[]})");
      var r2 = isBalanced("({[}])");
      var r3 = isBalanced("((()))");
      var r4 = isBalanced("((()");
      (r1 ? 1000 : 0) + (r2 ? 100 : 0) + (r3 ? 10 : 0) + (r4 ? 1 : 0);
    `);
    expect(r.value).toBe(1010);
  });

  it("simple hash map with chaining (no native Map)", () => {
    const r = engine.runValue(`
      function HashMap(size) {
        this.buckets = [];
        this.size = size;
        for (var i = 0; i < size; i++) this.buckets.push([]);
      }
      HashMap.prototype = {};

      function hashStr(key, size) {
        var h = 0;
        for (var i = 0; i < key.length; i++) {
          h = (h * 31 + key[i].charCodeAt(0)) % size;
        }
        return h;
      }

      function hmSet(hm, key, val) {
        var idx = hashStr(key, hm.size);
        var bucket = hm.buckets[idx];
        for (var i = 0; i < bucket.length; i++) {
          if (bucket[i].key === key) {
            bucket[i].val = val;
            return;
          }
        }
        bucket.push({key: key, val: val});
      }

      function hmGet(hm, key) {
        var idx = hashStr(key, hm.size);
        var bucket = hm.buckets[idx];
        for (var i = 0; i < bucket.length; i++) {
          if (bucket[i].key === key) return bucket[i].val;
        }
        return -1;
      }

      var m = new HashMap(16);
      hmSet(m, "apple", 1);
      hmSet(m, "banana", 2);
      hmSet(m, "cherry", 3);
      hmSet(m, "banana", 22);
      hmGet(m, "apple") * 100 + hmGet(m, "banana") * 10 + hmGet(m, "cherry");
    `);
    expect(r.value).toBe(100 + 220 + 3);
  });

  it("tower of Hanoi move count", () => {
    const r = engine.runValue(`
      var moves = 0;
      function hanoi(n, from, to, aux) {
        if (n === 0) return;
        hanoi(n - 1, from, aux, to);
        moves++;
        hanoi(n - 1, aux, to, from);
      }
      hanoi(10, "A", "C", "B");
      moves;
    `);
    expect(r.value).toBe(1023);
  });

  it("matrix transpose", () => {
    const r = engine.runValue(`
      function transpose(matrix) {
        var rows = matrix.length;
        var cols = matrix[0].length;
        var result = [];
        for (var j = 0; j < cols; j++) {
          var row = [];
          for (var i = 0; i < rows; i++) {
            row.push(matrix[i][j]);
          }
          result.push(row);
        }
        return result;
      }
      var m = [[1, 2, 3], [4, 5, 6]];
      var t = transpose(m);
      t.length * 1000 + t[0].length * 100 + t[0][0] * 10 + t[2][1];
    `);
    expect(r.value).toBe(3210 + 6);
  });
});
