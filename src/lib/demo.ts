import type { FileEntry } from "./types";
export const seed: Record<string, string> = {
  "src/main.rs": `//! Small tools. Big ideas.\n//! Your next great project starts right here.\n\nuse devyy_playground::{greet, Project};\nuse std::time::Instant;\n\nfn main() {\n    let started = Instant::now();\n\n    // A little less setup. A lot more possibility.\n    let project = Project::new("something wonderful");\n\n    println!("{}", greet("world"));\n    println!("Let's build {}.", project.name);\n\n    let ideas = [\n        "A tool you wish existed",\n        "That weekend side project",\n        "The next big little thing",\n    ];\n\n    for (index, idea) in ideas.iter().enumerate() {\n        println!("  {}. {}", index + 1, idea);\n    }\n\n    println!("\\nReady in {:?}. Make it yours.", started.elapsed());\n}\n`,
  "src/lib.rs": `/// A small beginning for something wonderful.\n#[derive(Debug, Clone)]\npub struct Project {\n    pub name: String,\n}\n\nimpl Project {\n    pub fn new(name: &str) -> Self {\n        Self { name: name.to_owned() }\n    }\n}\n\npub fn greet(name: &str) -> String {\n    format!("Hello, {name}. Welcome to your flow.")\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn greets_by_name() {\n        assert!(greet("devyy").contains("devyy"));\n    }\n}\n`,
  "Cargo.toml": `[package]\nname = "devyy-playground"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n`,
  "README.md": `# A small beginning.\n\nWelcome to the devyy playground. This is an editable, local example.\nOpen a folder to connect your own code, Git, and a real terminal.\n\n## Make yourself at home\n\n- **⌘/Ctrl P** — jump to any file\n- **⌘/Ctrl Shift P** — find a command\n- **⌘/Ctrl S** — save your work\n- **⌘/Ctrl J** — toggle the terminal\n- **⌘/Ctrl B** — make more room for your code\n- **⌘/Ctrl \\** — split the editor\n\nLess interface. More possibility.\n`,
  ".gitignore": "/target\n.DS_Store\n",
};
export function demoEntries(files: Record<string, string>): FileEntry[] {
  const dirs = new Set<string>();
  for (const path of Object.keys(files)) {
    const parts = path.split("/");
    parts.pop();
    while (parts.length) {
      dirs.add(parts.join("/"));
      parts.pop();
    }
  }
  return [
    ...[...dirs].map((path) => ({
      path,
      name: path.split("/").pop()!,
      directory: true,
    })),
    ...Object.keys(files).map((path) => ({
      path,
      name: path.split("/").pop()!,
      directory: false,
    })),
  ];
}
