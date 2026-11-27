import { StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

export function isEnvFile(path: string) {
  const name = path.split(/[/\\]/).at(-1) ?? "";
  return /^(?:\.env(?:\..+)?|.+\.env(?:\..+)?)$/i.test(name);
}

// Match whole key segments, so ordinary variables such as TOKENIZER and
// SECRETARY don't trigger masking.
const secretName =
  /(?:^|_)(?:KEYS?|TOKENS?|SECRETS?|PASSWORDS?|PASS(?:WD|PHRASE)?|PW|CREDENTIALS?|PRIVATE|AUTHORIZATION|AUTH|BEARER|COOKIES?|SESSION(?:_ID)?|SIGNATURE|CERTIFICATE|CERT|WEBHOOK|SALT|PEPPER|DSN|CONNECTION_STRING|DATABASE_URL|DB_URL|DATABASE_URI|DB_URI|REDIS_URL|MONGO(?:DB)?_URI|AMQP_URL|SMTP_URL|PGPASSWORD|MYSQL_PWD|ACCESSTOKEN|APIKEY|CLIENTSECRET|PRIVATEKEY|SECRETKEY)(?:_|$)/;
const metadataSuffix =
  /_(?:NAME|TYPE|FORMAT|ALGORITHM|METHOD|HEADER|LENGTH|SIZE|TTL|TIMEOUT|EXPIRY|EXPIRES|EXPIRATION|ENABLED|REQUIRED|PATH|FILE|DIRECTORY|VERSION|ENDPOINT|ISSUER|AUDIENCE|SCOPE|SCOPES)$/;
const safeName = new Set([
  "PUBLIC_KEY",
  "PUBLIC_KEYS",
  "SSH_PUBLIC_KEY",
  "API_URL",
  "API_BASE_URL",
]);
const strongValue =
  /^(?:-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----|(?:gh[pousr]_|github_pat_|glpat-|xox[baprs]-|sk-|sk_(?:live|test)_|rk_(?:live|test)_|AIza|AKIA|ASIA|npm_|hf_|xai-)\S{12,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[a-z][a-z\d+.-]*:\/\/[^\s/@:]+:[^\s/@]+@)/i;
const assignment = /^\s*(?:export\s+)?([A-Za-z_][\w.-]*)\s*=\s*/;
const inlineComment = /(^|\s)#/;

function sensitiveName(key: string) {
  const name = key
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .replace(/[.\-]+/g, "_")
    .toUpperCase();
  return (
    !safeName.has(name) && !metadataSuffix.test(name) && secretName.test(name)
  );
}

function closingQuote(line: string, from: number, quote: string) {
  for (let i = from; i < line.length; i++) {
    if (line[i] === "\\") i++;
    else if (line[i] === quote) return i;
  }
  return -1;
}

export function envSecrets(doc: Text) {
  const ranges: { from: number; to: number }[] = [];
  let offset = 0;
  let pending: { from: number; mask: boolean; quote: string } | undefined;
  for (const line of doc.iterLines()) {
    const start = offset;
    offset += line.length + 1;
    if (pending) {
      const end = closingQuote(line, 0, pending.quote);
      if (end === -1) continue;
      if (pending.mask && pending.from < start + end)
        ranges.push({ from: pending.from, to: start + end });
      pending = undefined;
      continue;
    }
    const entry = assignment.exec(line);
    if (!entry) continue;
    const valueStart = entry[0].length;
    const quote = line[valueStart];
    if (quote === '"' || quote === "'" || quote === "`") {
      const from = valueStart + 1;
      const end = closingQuote(line, from, quote);
      const mask =
        sensitiveName(entry[1]) ||
        strongValue.test(
          line.slice(
            from,
            Math.min(end === -1 ? line.length : end, from + 512),
          ),
        );
      if (end === -1) pending = { from: start + from, mask, quote };
      else if (mask && end > from)
        ranges.push({ from: start + from, to: start + end });
    } else {
      const value = line.slice(valueStart).split(inlineComment, 1)[0].trimEnd();
      if (
        value &&
        (sensitiveName(entry[1]) || strongValue.test(value.slice(0, 512)))
      ) {
        ranges.push({
          from: start + valueStart,
          to: start + valueStart + value.length,
        });
      }
    }
  }
  if (pending?.mask && pending.from < doc.length)
    ranges.push({ from: pending.from, to: doc.length });
  return ranges;
}

const toggleReveal = StateEffect.define<number>();

function secretMark(from: number, to: number, revealed = false) {
  return Decoration.mark({
    class: revealed ? "cm-env-secret cm-env-secret-revealed" : "cm-env-secret",
    attributes: { "data-env-secret": String(from) },
  }).range(from, to);
}

function scan(doc: Text) {
  const ranges = envSecrets(doc);
  return {
    ends: new Map(ranges.map(({ from, to }) => [from, to])),
    revealed: new Set<number>(),
    marks: Decoration.set(ranges.map(({ from, to }) => secretMark(from, to))),
  };
}

const secrets = StateField.define({
  create: (state) => scan(state.doc),
  update(value, transaction) {
    if (transaction.docChanged) return scan(transaction.newDoc);
    const toggle = transaction.effects.find((effect) =>
      effect.is(toggleReveal),
    );
    if (!toggle) return value;
    const from = toggle.value;
    const to = value.ends.get(from);
    if (to === undefined) return value;
    const revealed = new Set(value.revealed);
    if (revealed.has(from)) revealed.delete(from);
    else revealed.add(from);
    return {
      ...value,
      revealed,
      marks: value.marks.update({
        filterFrom: from,
        filterTo: to,
        filter: (start) => start !== from,
        add: [secretMark(from, to, revealed.has(from))],
      }),
    };
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.marks),
});

export const envPrivacy = [
  secrets,
  EditorView.domEventHandlers({
    click(event, view) {
      if (
        !(event.target instanceof Element) ||
        !view.state.selection.main.empty
      )
        return;
      const target = event.target.closest<HTMLElement>("[data-env-secret]");
      if (target)
        view.dispatch({
          effects: toggleReveal.of(Number(target.dataset.envSecret)),
        });
    },
  }),
];
