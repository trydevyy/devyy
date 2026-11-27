import { StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

export function isEnvFile(path: string) {
  const name = path.split(/[/\\]/).at(-1) ?? "";
  return /^(?:\.env(?:\..+)?|.+\.env(?:\..+)?)$/i.test(name);
}

const assignment = /^\s*(?:export\s+)?[A-Za-z_][\w.-]*\s*=\s*/;

function closingQuote(line: string, from: number, quote: string) {
  for (let i = from; i < line.length; i++) {
    if (line[i] === "\\") i++;
    else if (line[i] === quote) return i;
  }
  return -1;
}

export function envValueRanges(doc: Text) {
  const ranges: { from: number; to: number }[] = [];
  let offset = 0;
  let pending: { from: number; quote: string } | undefined;
  for (const line of doc.iterLines()) {
    const start = offset;
    offset += line.length + 1;
    if (pending) {
      const end = closingQuote(line, 0, pending.quote);
      if (end === -1) continue;
      if (pending.from < start + end)
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
      if (end === -1) pending = { from: start + from, quote };
      else if (end > from) ranges.push({ from: start + from, to: start + end });
    } else {
      const comment = line.indexOf("#", valueStart);
      const value = line
        .slice(valueStart, comment === -1 ? undefined : comment)
        .trimEnd();
      if (value) {
        ranges.push({
          from: start + valueStart,
          to: start + valueStart + value.length,
        });
      }
    }
  }
  if (pending && pending.from < doc.length)
    ranges.push({ from: pending.from, to: doc.length });
  return ranges;
}

const toggleReveal = StateEffect.define<number>();
const revealAll = StateEffect.define<boolean>();

function secretMark(from: number, to: number, revealed = false) {
  return Decoration.mark({
    class: revealed ? "cm-env-value cm-env-value-revealed" : "cm-env-value",
    attributes: { "data-env-value": String(from) },
  }).range(from, to);
}

function scan(doc: Text, allRevealed = false) {
  const ranges = envValueRanges(doc);
  return {
    allRevealed,
    ends: new Map(ranges.map(({ from, to }) => [from, to])),
    revealed: new Set<number>(),
    marks: allRevealed
      ? Decoration.none
      : Decoration.set(ranges.map(({ from, to }) => secretMark(from, to))),
  };
}

const secrets = StateField.define({
  create: (state) => scan(state.doc),
  update(value, transaction) {
    const all = transaction.effects.find((effect) => effect.is(revealAll));
    if (transaction.docChanged)
      return scan(transaction.newDoc, all?.value ?? value.allRevealed);
    if (all)
      return {
        ...value,
        allRevealed: all.value,
        revealed: new Set<number>(),
        marks: all.value
          ? Decoration.none
          : Decoration.set(
              Array.from(value.ends, ([from, to]) => secretMark(from, to)),
            ),
      };
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
      const target = event.target.closest<HTMLElement>("[data-env-value]");
      if (target)
        view.dispatch({
          effects: toggleReveal.of(Number(target.dataset.envValue)),
        });
    },
  }),
];

export function revealEnvValues(view: EditorView, revealed: boolean) {
  const privacy = view.state.field(secrets, false);
  if (!privacy) return false;
  if (privacy.allRevealed !== revealed)
    view.dispatch({ effects: revealAll.of(revealed) });
  return true;
}
