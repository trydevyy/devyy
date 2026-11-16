// Copyright (C) 2026 Devyy contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

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
