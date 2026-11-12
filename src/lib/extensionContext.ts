// Parse VS Code when clauses as data. Never evaluate extension-provided JavaScript.
export function matchesContext(
  expression: string | undefined,
  context: Record<string, unknown>,
): boolean {
  if (!expression?.trim()) return true;
  const tokens =
    expression
      .match(
        /\s*(===|!==|==|!=|&&|\|\||>=|<=|=~|[!()><]|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\/(?:[^/\\]|\\.)*\/[gimsuy]*|[^\s!()=<>|&]+)/g,
      )
      ?.map((token) => token.trim()) ?? [];
  let index = 0;
  const take = () => tokens[index++];
  const literal = (token: string | undefined): unknown => {
    if (!token) return undefined;
    if (token === "true") return true;
    if (token === "false") return false;
    if (token.startsWith("'") || token.startsWith('"'))
      return token.slice(1, -1);
    if (/^-?\d+(?:\.\d+)?$/.test(token)) return Number(token);
    return token;
  };
  const primary = (): unknown => {
    if (tokens[index] === "!") {
      take();
      return !primary();
    }
    if (tokens[index] === "(") {
      take();
      const value = or();
      if (take() !== ")") throw Error("Unclosed when clause");
      return value;
    }
    const key = take();
    if (!key) throw Error("Missing context key");
    let value = key === "true" ? true : key === "false" ? false : context[key];
    const operator = tokens[index];
    if (
      [
        "==",
        "===",
        "!=",
        "!==",
        ">",
        "<",
        ">=",
        "<=",
        "=~",
        "in",
        "not",
      ].includes(operator)
    ) {
      take();
      let op = operator;
      if (op === "not") {
        if (take() !== "in") throw Error("Invalid operator");
        op = "not in";
      }
      const rightToken = take();
      if (op === "in" || op === "not in") {
        const right = context[rightToken!];
        const member = Array.isArray(right)
          ? right.includes(value)
          : !!right &&
            typeof right === "object" &&
            Object.prototype.hasOwnProperty.call(right, String(value));
        return op === "in" ? member : !member;
      }
      const right = literal(rightToken);
      if (op === "==" || op === "===") return value === right;
      if (op === "!=" || op === "!==") return value !== right;
      if (op === "=~") {
        const match = /^\/(.*)\/([gimsuy]*)$/.exec(rightToken ?? "");
        return (
          !!match &&
          new RegExp(match[1], match[2].replace(/[gy]/g, "")).test(
            String(value ?? ""),
          )
        );
      }
      const a = Number(value),
        b = Number(right);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      value =
        op === ">" ? a > b : op === "<" ? a < b : op === ">=" ? a >= b : a <= b;
    }
    return value;
  };
  const and = (): unknown => {
    let value = primary();
    while (tokens[index] === "&&") {
      take();
      const right = primary();
      value = !!value && !!right;
    }
    return value;
  };
  const or = (): unknown => {
    let value = and();
    while (tokens[index] === "||") {
      take();
      const right = and();
      value = !!value || !!right;
    }
    return value;
  };
  try {
    const value = or();
    return index === tokens.length && !!value;
  } catch {
    return false;
  }
}
