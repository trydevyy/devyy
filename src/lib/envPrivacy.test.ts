import { Text } from "@codemirror/state";
import { expect, it } from "vitest";
import { envSecrets, isEnvFile } from "./envPrivacy";

it("masks secret names and recognizable values without including comments or quotes", () => {
  const lines = [
    "# API_KEY=no",
    "PORT=5000",
    "export githubToken = 'abc#def' # keep this visible",
    "db-url=postgres://local/example",
    "AWS_ACCESS_KEY_ID=test-id",
    "PASSWORD_LENGTH=16",
    "TOKENIZER=ordinary",
    "SSH_PUBLIC_KEY=public",
    "RANDOM_ALIAS=postgres://user:example@localhost/db",
    "EMPTY_SECRET= # no value",
    'PRIVATE_KEY="line one',
    "line two",
    'line three" # keep this visible',
    "OTHER=true",
  ];
  const doc = Text.of(lines);
  expect(
    envSecrets(doc).map(({ from, to }) => doc.sliceString(from, to)),
  ).toEqual([
    "abc#def",
    "postgres://local/example",
    "test-id",
    "postgres://user:example@localhost/db",
    "line one\nline two\nline three",
  ]);
});

it("recognizes dotenv filenames without enabling masking for unrelated files", () => {
  for (const path of [
    ".env",
    ".env.local",
    "config/dev.env",
    "C:\\repo\\.ENV.TEST",
  ])
    expect(isEnvFile(path)).toBe(true);
  for (const path of [".envrc", "environment.ts", "src/.env/README.md"])
    expect(isEnvFile(path)).toBe(false);
});
