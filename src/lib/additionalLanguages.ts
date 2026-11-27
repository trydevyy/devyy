import { LanguageSupport, StreamLanguage } from "@codemirror/language";
import {
  simpleMode,
  type Rule,
} from "@codemirror/legacy-modes/mode/simple-mode";

const doubleQuoted: Rule = { regex: /"(?:\\.|[^"\\])*"/, token: "string" };
const singleQuoted: Rule = { regex: /'(?:\\.|[^'\\])*'/, token: "string" };
const number: Rule = {
  regex:
    /\b(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)\b/,
  token: "number",
};
const punctuation: Rule = { regex: /[{}()[\],.;:]/, token: "punctuation" };
const operator: Rule = { regex: /[+*/%&|!?=<>~-]+/, token: "operator" };
const hash: Rule = { regex: /#.*/, token: "comment" };
const slash: Rule = { regex: /\/\/.*/, token: "comment" };
const block: Rule = { regex: /\/\*/, token: "comment", push: "comment" };

const configKeys: Rule = {
  regex: /\b[A-Za-z_][\w.-]*(?=\s*=)/,
  token: "propertyName",
};

const modes = {
  hcl: {
    keywords:
      "terraform provider resource data module variable output locals moved import check lifecycle dynamic for in if",
    rules: [hash, slash, block, configKeys],
  },
  nix: {
    keywords: "let in rec inherit with assert if then else or",
    rules: [
      hash,
      block,
      { regex: /''/, token: "string", push: "nixString" },
      configKeys,
    ],
  },
  zig: {
    keywords:
      "addrspace align allowzero and anytype asm async await break catch comptime const continue defer else enum errdefer error export extern fn for if inline noalias noinline nosuspend opaque or orelse packed pub resume return linksection struct suspend switch test threadlocal try union unreachable usingnamespace var volatile while",
    rules: [slash, { regex: /@[A-Za-z_]\w*/, token: "meta" }],
  },
  elixir: {
    keywords:
      "def defp defmodule defprotocol defimpl defmacro defstruct defdelegate defguard defexception defoverridable do end fn if unless else case cond with for receive try rescue catch after raise quote unquote import require alias use when",
    rules: [
      hash,
      { regex: /:[a-zA-Z_][\w!?]*/, token: "atom" },
      { regex: /@[a-zA-Z_]\w*/, token: "meta" },
    ],
  },
  solidity: {
    keywords:
      "pragma import contract abstract interface library is using for struct enum event error modifier function constructor fallback receive returns return public private internal external payable view pure virtual override immutable constant memory storage calldata mapping unchecked emit revert require if else while do break continue try catch new delete assembly",
    rules: [
      slash,
      block,
      {
        regex: /\b(?:u?int\d*|bytes\d*|bool|address|string)\b/,
        token: "typeName",
      },
    ],
  },
  fish: {
    keywords:
      "function end if else switch case while for in begin and or not set export source return break continue status builtin command",
    rules: [hash, { regex: /\$[A-Za-z_]\w*/, token: "variableName.special" }],
  },
  graphql: {
    keywords:
      "query mutation subscription fragment on type input interface schema scalar enum union extend directive implements repeatable",
    rules: [
      hash,
      { regex: /"""/, token: "string", push: "tripleString" },
      { regex: /\$[A-Za-z_]\w*/, token: "variableName.special" },
      { regex: /@[A-Za-z_]\w*/, token: "meta" },
      { regex: /\b[A-Z]\w*\b/, token: "typeName" },
    ],
  },
  ini: {
    keywords: "",
    rules: [
      { regex: /[;#].*/, token: "comment" },
      { regex: /^\s*\[[^\]\r\n]+\]/, token: "heading", sol: true },
      { regex: /^\s*[\w.-]+(?=\s*[:=])/, token: "propertyName", sol: true },
    ],
  },
  mermaid: {
    keywords:
      "graph flowchart sequenceDiagram classDiagram stateDiagram stateDiagram-v2 erDiagram gantt pie gitGraph mindmap timeline journey quadrantChart subgraph direction end participant actor as loop alt else opt par and rect note Note section",
    rules: [
      { regex: /%%.*/, token: "comment" },
      { regex: /<?[-=.]+[->x]|--[|o]|\|[^|]*\|/, token: "operator" },
    ],
  },
  typst: {
    keywords: "",
    rules: [
      slash,
      block,
      { regex: /#[a-zA-Z_][\w-]*/, token: "keyword" },
      { regex: /^\s*=+\s.*/, token: "heading", sol: true },
      { regex: /\$[^$]+\$/, token: "string" },
    ],
  },
} satisfies Record<string, { keywords: string; rules: Rule[] }>;

export function additionalLanguage(name: keyof typeof modes) {
  const { keywords, rules } = modes[name];
  const keywordRules: Rule[] = keywords
    ? [
        {
          regex: new RegExp(`\\b(?:${keywords.split(" ").join("|")})\\b`),
          token: "keyword",
        },
      ]
    : [];
  return new LanguageSupport(
    StreamLanguage.define(
      simpleMode({
        start: [
          ...rules,
          doubleQuoted,
          singleQuoted,
          ...keywordRules,
          { regex: /\b(?:true|false|null|nil)\b/, token: "atom" },
          number,
          punctuation,
          operator,
          { regex: /[A-Za-z_]\w*/, token: null },
        ],
        comment: [
          { regex: /.*?\*\//, token: "comment", pop: true },
          { regex: /.+/, token: "comment" },
        ],
        nixString: [
          { regex: /.*?''/, token: "string", pop: true },
          { regex: /.+/, token: "string" },
        ],
        tripleString: [
          { regex: /.*?"""/, token: "string", pop: true },
          { regex: /.+/, token: "string" },
        ],
      }),
    ),
  );
}
