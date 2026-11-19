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

use serde_json::Value;

const START_TAGS: &[&str] = &["<ctrl94>thought", "<ctrl94>", "\u{001e}thought", "\u{001e}"];

const END_TAGS: &[&str] = &["<ctrl95>", "\u{001f}"];

pub fn start_thought_tag(s: &str) -> Option<usize> {
    for tag in START_TAGS {
        if s.starts_with(tag) {
            return Some(tag.len());
        }
    }
    None
}

pub fn end_thought_tag(s: &str) -> Option<usize> {
    for tag in END_TAGS {
        if s.starts_with(tag) {
            return Some(tag.len());
        }
    }
    None
}

pub fn is_start_tag_prefix(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    START_TAGS.iter().any(|tag| tag.starts_with(s))
}

pub fn is_end_tag_prefix(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    END_TAGS.iter().any(|tag| tag.starts_with(s))
}

pub fn extract_thoughts(input: &str) -> (String, String) {
    let mut clean = String::with_capacity(input.len());
    let mut reasoning = String::new();
    let mut i = 0;
    while i < input.len() {
        let rem = &input[i..];
        if let Some(tag_len) = start_thought_tag(rem) {
            i += tag_len;
            if i < input.len() && input[i..].starts_with('\n') {
                i += 1;
            }
            let mut end_found = false;
            while i < input.len() {
                let inner = &input[i..];
                if let Some(end_len) = end_thought_tag(inner) {
                    i += end_len;
                    if i < input.len() && input[i..].starts_with('\n') {
                        i += 1;
                    }
                    end_found = true;
                    break;
                }
                let ch = inner.chars().next().unwrap();
                reasoning.push(ch);
                i += ch.len_utf8();
            }
            if !end_found {
                break;
            }
        } else {
            let ch = rem.chars().next().unwrap();
            clean.push(ch);
            i += ch.len_utf8();
        }
    }
    (clean, reasoning)
}

pub fn parse_json_object(input: &str) -> Option<Value> {
    let trimmed = input.trim();
    if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
        if v.is_object() {
            return Some(v);
        }
    }
    let (cleaned, _) = extract_thoughts(trimmed);
    let cleaned_trim = cleaned.trim();
    if let Ok(v) = serde_json::from_str::<Value>(cleaned_trim) {
        if v.is_object() {
            return Some(v);
        }
    }
    let unquoted = cleaned_trim
        .strip_prefix("```json")
        .or_else(|| cleaned_trim.strip_prefix("```"))
        .and_then(|s| s.trim().strip_suffix("```"))
        .unwrap_or(cleaned_trim)
        .trim();
    if let Ok(v) = serde_json::from_str::<Value>(unquoted) {
        if v.is_object() {
            return Some(v);
        }
    }
    if let (Some(start), Some(end)) = (input.find('{'), input.rfind('}')) {
        if start < end {
            if let Ok(v) = serde_json::from_str::<Value>(&input[start..=end]) {
                if v.is_object() {
                    return Some(v);
                }
            }
        }
    }
    None
}

#[derive(Default)]
pub struct JsonAnswer {
    input: String,
    cursor: usize,
    depth: usize,
    string_start: Option<usize>,
    escaped: bool,
    answer_key: bool,
    colon: bool,
    reading: bool,
    done: bool,
    in_thought: bool,
    pub text: String,
    pub reasoning: String,
}

impl JsonAnswer {
    pub fn push(&mut self, chunk: &str) -> (String, String) {
        self.input.push_str(chunk);
        let mut delta = String::new();
        let mut reasoning_delta = String::new();
        while self.cursor < self.input.len() && !self.done {
            let remaining = &self.input[self.cursor..];
            if !self.reading {
                if !self.in_thought {
                    if let Some(tag_len) = start_thought_tag(remaining) {
                        self.in_thought = true;
                        self.cursor += tag_len;
                        if self.cursor < self.input.len()
                            && self.input[self.cursor..].starts_with('\n')
                        {
                            self.cursor += 1;
                        }
                        continue;
                    }
                    if is_start_tag_prefix(remaining) {
                        break;
                    }
                } else {
                    if let Some(tag_len) = end_thought_tag(remaining) {
                        self.in_thought = false;
                        self.cursor += tag_len;
                        if self.cursor < self.input.len()
                            && self.input[self.cursor..].starts_with('\n')
                        {
                            self.cursor += 1;
                        }
                        continue;
                    }
                    if is_end_tag_prefix(remaining) {
                        break;
                    }
                    let c = remaining.chars().next().unwrap();
                    reasoning_delta.push(c);
                    self.reasoning.push(c);
                    self.cursor += c.len_utf8();
                    continue;
                }
            }

            let c = remaining.chars().next().unwrap();
            if self.reading {
                if !self.in_thought {
                    if let Some(tag_len) = start_thought_tag(remaining) {
                        self.in_thought = true;
                        self.cursor += tag_len;
                        if self.cursor < self.input.len()
                            && self.input[self.cursor..].starts_with('\n')
                        {
                            self.cursor += 1;
                        }
                        continue;
                    }
                    if is_start_tag_prefix(remaining) {
                        break;
                    }
                } else {
                    if let Some(tag_len) = end_thought_tag(remaining) {
                        self.in_thought = false;
                        self.cursor += tag_len;
                        if self.cursor < self.input.len()
                            && self.input[self.cursor..].starts_with('\n')
                        {
                            self.cursor += 1;
                        }
                        continue;
                    }
                    if is_end_tag_prefix(remaining) {
                        break;
                    }
                    let c = remaining.chars().next().unwrap();
                    reasoning_delta.push(c);
                    self.reasoning.push(c);
                    self.cursor += c.len_utf8();
                    continue;
                }

                if c == '"' {
                    self.done = true;
                    break;
                }
                if c == '\\' {
                    if remaining.len() < 2 {
                        break;
                    }
                    let mut size = if remaining.as_bytes()[1] == b'u' {
                        6
                    } else {
                        2
                    };
                    if remaining.len() < size {
                        break;
                    }
                    if !remaining.is_char_boundary(size) {
                        self.done = true;
                        break;
                    }
                    if size == 6 {
                        let Ok(code) = u16::from_str_radix(&remaining[2..6], 16) else {
                            self.done = true;
                            break;
                        };
                        if (0xd800..=0xdbff).contains(&code) {
                            size = 12;
                        }
                    }
                    if remaining.len() < size {
                        break;
                    }
                    if !remaining.is_char_boundary(size) {
                        self.done = true;
                        break;
                    }
                    let encoded = format!("\"{}\"", &remaining[..size]);
                    let Ok(decoded) = serde_json::from_str::<String>(&encoded) else {
                        self.done = true;
                        break;
                    };
                    delta.push_str(&decoded);
                    self.text.push_str(&decoded);
                    self.cursor += size;
                    continue;
                }
                delta.push(c);
                self.text.push(c);
            } else if let Some(start) = self.string_start {
                if self.escaped {
                    self.escaped = false;
                } else if c == '\\' {
                    self.escaped = true;
                } else if c == '"' {
                    self.answer_key =
                        self.depth == 1 && &self.input[start..=self.cursor] == "\"answer\"";
                    self.string_start = None;
                }
            } else if self.answer_key {
                if c == ':' {
                    self.colon = true;
                } else if self.colon && c == '"' {
                    self.reading = true;
                } else if !c.is_whitespace() {
                    self.answer_key = false;
                    self.colon = false;
                }
            } else {
                match c {
                    '{' | '[' => self.depth += 1,
                    '}' | ']' => self.depth = self.depth.saturating_sub(1),
                    '"' => self.string_start = Some(self.cursor),
                    _ => {}
                }
            }
            self.cursor += c.len_utf8();
        }
        (delta, reasoning_delta)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn streams_answer_and_waits_for_split_escapes_without_exposing_tools() {
        let mut stream = JsonAnswer::default();
        assert_eq!(
            stream
                .push(r#"{"tool_requests":[{"arguments":"{\"answer\":\"private\"}"}],"ans"#)
                .0,
            ""
        );
        assert_eq!(stream.push(r#"wer":"Hello \uD83D"#).0, "Hello ");
        assert_eq!(stream.push(r#"\uDE80\nW"#).0, "🚀\nW");
        assert_eq!(stream.push("örld\"}").0, "örld");
        assert_eq!(stream.text, "Hello 🚀\nWörld");
    }
    #[test]
    fn handles_every_chunk_boundary_and_does_not_parse_nested_answers() {
        let source = r#"{"other":{"answer":"hidden"},"answer":"one\ntwo\t\"hé\"\\end"}"#;
        for split in source.char_indices().map(|(i, _)| i) {
            let mut stream = JsonAnswer::default();
            let output = stream.push(&source[..split]).0 + &stream.push(&source[split..]).0;
            assert_eq!(output, "one\ntwo\t\"hé\"\\end");
        }
    }
    #[test]
    fn filters_antigravity_thought_tags_and_routes_to_reasoning() {
        let mut stream = JsonAnswer::default();
        let chunk1 = "<ctrl94>thought\n<ctrl95>\n\n{\"answer\":\"<ctrl94>thought\nLet's inspect README.md\n<ctrl95>Here is the inspection.\",\"tool_requests\":[]}";
        let (delta, reasoning) = stream.push(chunk1);
        assert_eq!(reasoning, "Let's inspect README.md\n");
        assert_eq!(delta, "Here is the inspection.");
        assert_eq!(stream.text, "Here is the inspection.");
        assert_eq!(stream.reasoning, "Let's inspect README.md\n");
    }
    #[test]
    fn parses_json_object_with_thought_preludes() {
        let raw = "<ctrl94>thought\n<ctrl95>\n\n{\"answer\":\"<ctrl94>thought\nThinking\n<ctrl95>Hello\",\"tool_requests\":[{\"name\":\"read_files\",\"arguments\":\"{}\"}]}";
        let parsed = parse_json_object(raw).expect("Must parse JSON object");
        assert_eq!(parsed["tool_requests"][0]["name"], "read_files");
    }
}
