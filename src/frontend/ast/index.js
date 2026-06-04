export const NodeType = {
  Program: "Program",
  FunctionDeclaration: "FunctionDeclaration",
  LazyFunctionDeclaration: "LazyFunctionDeclaration",
  LetDeclaration: "LetDeclaration",
  ConstDeclaration: "ConstDeclaration",
  VarDeclaration: "VarDeclaration",
  IfStatement: "IfStatement",
  WhileStatement: "WhileStatement",
  ForStatement: "ForStatement",
  ReturnStatement: "ReturnStatement",
  EmptyStatement: "EmptyStatement",
  BlockStatement: "BlockStatement",
  ExpressionStatement: "ExpressionStatement",
  AssignmentExpression: "AssignmentExpression",
  BinaryExpression: "BinaryExpression",
  UnaryExpression: "UnaryExpression",
  LogicalExpression: "LogicalExpression",
  CallExpression: "CallExpression",
  NewExpression: "NewExpression",
  MemberExpression: "MemberExpression",
  ObjectExpression: "ObjectExpression",
  ArrayExpression: "ArrayExpression",
  ConditionalExpression: "ConditionalExpression",
  AwaitExpression: "AwaitExpression",
  SwitchStatement: "SwitchStatement",
  SwitchCase: "SwitchCase",
  BreakStatement: "BreakStatement",
  TryStatement: "TryStatement",
  ThrowStatement: "ThrowStatement",
  ClassDeclaration: "ClassDeclaration",
  ForInStatement: "ForInStatement",
  ForOfStatement: "ForOfStatement",
  Identifier: "Identifier",
  Literal: "Literal",
  ThisExpression: "ThisExpression",
  ObjectDestructuring: "ObjectDestructuring",
  ArrayDestructuring: "ArrayDestructuring",
  YieldExpression: "YieldExpression",
  UpdateExpression: "UpdateExpression",
  DoWhileStatement: "DoWhileStatement",
  ContinueStatement: "ContinueStatement",
  CompoundAssignmentExpression: "CompoundAssignmentExpression",
  ArrowFunctionExpression: "ArrowFunctionExpression",
  FunctionExpression: "FunctionExpression",
  TemplateLiteral: "TemplateLiteral",
  OptionalMemberExpression: "OptionalMemberExpression",
  OptionalCallExpression: "OptionalCallExpression",
  NullishCoalescingExpression: "NullishCoalescingExpression",
  SpreadElement: "SpreadElement",
  LabeledStatement: "LabeledStatement",
  SuperCallExpression: "SuperCallExpression",
};

export function Program(body) {
  return { type: NodeType.Program, body };
}

export function FunctionDeclaration(name, params, body) {
  return {
    type: NodeType.FunctionDeclaration,
    name,
    params,
    body,
    async: false,
  };
}

export function AsyncFunctionDeclaration(name, params, body) {
  return {
    type: NodeType.FunctionDeclaration,
    name,
    params,
    body,
    async: true,
  };
}

export function LazyFunctionDeclaration(
  name,
  params,
  source,
  bodyStart,
  bodyEnd,
) {
  return {
    type: NodeType.LazyFunctionDeclaration,
    name,
    params,
    source,
    bodyStart,
    bodyEnd,
    isLazy: true,
  };
}

export function LetDeclaration(name, init) {
  return { type: NodeType.LetDeclaration, name, init };
}

export function ConstDeclaration(name, init) {
  return { type: NodeType.ConstDeclaration, name, init };
}

export function VarDeclaration(name, init) {
  return { type: NodeType.VarDeclaration, name, init };
}

export function IfStatement(test, consequent, alternate) {
  return { type: NodeType.IfStatement, test, consequent, alternate };
}

export function WhileStatement(test, body) {
  return { type: NodeType.WhileStatement, test, body };
}

export function ForStatement(init, test, update, body) {
  return { type: NodeType.ForStatement, init, test, update, body };
}

export function ReturnStatement(argument) {
  return { type: NodeType.ReturnStatement, argument };
}

export function EmptyStatement() {
  return { type: NodeType.EmptyStatement };
}

export function BlockStatement(body) {
  return { type: NodeType.BlockStatement, body };
}

export function ExpressionStatement(expression) {
  return { type: NodeType.ExpressionStatement, expression };
}

export function AssignmentExpression(target, value) {
  return { type: NodeType.AssignmentExpression, target, value };
}

export function BinaryExpression(op, left, right) {
  return { type: NodeType.BinaryExpression, op, left, right };
}

export function UnaryExpression(op, argument) {
  return { type: NodeType.UnaryExpression, op, argument };
}

export function LogicalExpression(op, left, right) {
  return { type: NodeType.LogicalExpression, op, left, right };
}

export function CallExpression(callee, args) {
  return { type: NodeType.CallExpression, callee, args };
}

export function NewExpression(callee, args) {
  return { type: NodeType.NewExpression, callee, args };
}

export function MemberExpression(object, property, computed) {
  return {
    type: NodeType.MemberExpression,
    object,
    property,
    computed: !!computed,
  };
}

export function ObjectExpression(properties) {
  return { type: NodeType.ObjectExpression, properties };
}

export function ArrayExpression(elements) {
  return { type: NodeType.ArrayExpression, elements };
}

export function Identifier(name) {
  return { type: NodeType.Identifier, name };
}

export function Literal(value, kind) {
  return { type: NodeType.Literal, value, kind };
}

export function ConditionalExpression(test, consequent, alternate) {
  return { type: NodeType.ConditionalExpression, test, consequent, alternate };
}

export function AwaitExpression(argument) {
  return { type: NodeType.AwaitExpression, argument };
}

export function SwitchStatement(discriminant, cases) {
  return { type: NodeType.SwitchStatement, discriminant, cases };
}

export function SwitchCase(test, consequent) {
  return { type: NodeType.SwitchCase, test, consequent };
}

export function BreakStatement() {
  return { type: NodeType.BreakStatement };
}

export function TryStatement(block, handler, finalizer) {
  return { type: NodeType.TryStatement, block, handler, finalizer };
}

export function ThrowStatement(argument) {
  return { type: NodeType.ThrowStatement, argument };
}

export function ForInStatement(variable, object, body, kind = "let") {
  return { type: NodeType.ForInStatement, variable, object, body, kind };
}

export function ForOfStatement(variable, iterable, body, kind = "let") {
  return { type: NodeType.ForOfStatement, variable, iterable, body, kind };
}

export function ClassDeclaration(name, superClass, constructor, methods) {
  return {
    type: NodeType.ClassDeclaration,
    name,
    superClass,
    constructor,
    methods,
  };
}

export function SuperCallExpression(args) {
  return { type: NodeType.SuperCallExpression, args };
}

export function ThisExpression() {
  return { type: NodeType.ThisExpression };
}

export function ObjectDestructuring(pattern, init, kind) {
  return { type: NodeType.ObjectDestructuring, pattern, init, kind };
}

export function ArrayDestructuring(pattern, init, kind) {
  return { type: NodeType.ArrayDestructuring, pattern, init, kind };
}

export function GeneratorFunctionDeclaration(name, params, body) {
  return {
    type: NodeType.FunctionDeclaration,
    name,
    params,
    body,
    async: false,
    generator: true,
  };
}

export function YieldExpression(argument, delegate) {
  return { type: NodeType.YieldExpression, argument, delegate: !!delegate };
}

export function UpdateExpression(op, argument, prefix) {
  return { type: NodeType.UpdateExpression, op, argument, prefix };
}

export function DoWhileStatement(test, body) {
  return { type: NodeType.DoWhileStatement, test, body };
}

export function ContinueStatement() {
  return { type: NodeType.ContinueStatement };
}

export function CompoundAssignmentExpression(op, target, value) {
  return { type: NodeType.CompoundAssignmentExpression, op, target, value };
}

export function ArrowFunctionExpression(params, body, isExpression) {
  return { type: NodeType.ArrowFunctionExpression, params, body, isExpression };
}

export function FunctionExpression(name, params, body) {
  return { type: NodeType.FunctionExpression, name, params, body };
}

export function TemplateLiteral(parts, expressions) {
  return { type: NodeType.TemplateLiteral, parts, expressions };
}

export function OptionalMemberExpression(object, property) {
  return { type: NodeType.OptionalMemberExpression, object, property };
}

export function OptionalCallExpression(callee, args) {
  return { type: NodeType.OptionalCallExpression, callee, args };
}

export function NullishCoalescingExpression(left, right) {
  return { type: NodeType.NullishCoalescingExpression, left, right };
}

export function SpreadElement(argument) {
  return { type: NodeType.SpreadElement, argument };
}

export function LabeledStatement(label, body) {
  return { type: NodeType.LabeledStatement, label, body };
}
