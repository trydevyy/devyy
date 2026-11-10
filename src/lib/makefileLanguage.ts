import { LanguageSupport, StreamLanguage } from "@codemirror/language";
const make = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.peek() === "#") {
      stream.skipToEnd();
      return "comment";
    }
    if (
      stream.match(
        /^(?:-?include|define|endef|ifdef|ifndef|ifeq|ifneq|else|endif|export|unexport|override|private|vpath)\b/,
      )
    )
      return "keyword";
    if (stream.match(/^\$\([^)]+\)|^\$\{[^}]+\}|^\$[@<^?%*+|]/))
      return "variableName";
    if (stream.match(/^[\w./%*-]+(?=\s*:)/)) return "labelName";
    if (stream.match(/^[\w.-]+(?=\s*[:?+]?=)/)) return "variableName";
    if (stream.match(/^(?::?=|\?=|\+=|:|;)/)) return "operator";
    if (stream.match(/^"(?:[^"\\]|\\.)*"|^'[^']*'/)) return "string";
    if (stream.match(/^\d+(?:\.\d+)?/)) return "number";
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "#" } },
});
export const makefile = () => new LanguageSupport(make);
