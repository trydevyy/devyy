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

use super::*;
#[test]
fn graph_preserves_merges_and_historical_renames_without_touching_worktree() {
    let dir = tempfile::tempdir().unwrap();
    let base = dir.path();
    for args in [
        vec!["init", "-b", "main"],
        vec!["config", "user.name", "Graph Test"],
        vec!["config", "user.email", "graph@example.test"],
        vec!["config", "commit.gpgsign", "false"],
    ] {
        git(base, &args).unwrap();
    }
    std::fs::write(base.join("old.txt"), "original\n").unwrap();
    git(base, &["add", "."]).unwrap();
    git(base, &["commit", "-m", "Initial"]).unwrap();
    let first = git(base, &["rev-parse", "HEAD"])
        .unwrap()
        .trim()
        .to_string();
    git(base, &["checkout", "-b", "feature"]).unwrap();
    std::fs::write(base.join("feature.txt"), "feature\n").unwrap();
    git(base, &["add", "."]).unwrap();
    git(base, &["commit", "-m", "Feature"]).unwrap();
    git(base, &["checkout", "main"]).unwrap();
    git(base, &["mv", "old.txt", "renamed.txt"]).unwrap();
    git(base, &["commit", "-m", "Rename"]).unwrap();
    let renamed = git(base, &["rev-parse", "HEAD"])
        .unwrap()
        .trim()
        .to_string();
    git(
        base,
        &["merge", "--no-ff", "feature", "-m", "Merge feature"],
    )
    .unwrap();
    let page = graph_page(base, 0, 100).unwrap();
    assert_eq!(page.commits.len(), 4);
    assert_eq!(page.commits[0].parents.len(), 2);
    assert!(page
        .commits
        .iter()
        .any(|c| c.refs.iter().any(|r| r.contains("feature"))));
    assert!(graph_page(base, 0, 1).unwrap().has_more);
    assert_eq!(graph_page(base, 1, 1).unwrap().commits.len(), 1);
    assert!(graph_page(base, 0, 201).is_err());
    assert_eq!(graph_detail(base, &first).unwrap().subject, "Initial");
    let initial = historical_diff(base, &first, "old.txt", 0).unwrap();
    assert!(initial.original.is_empty());
    assert_eq!(initial.modified, "original\n");
    let files = commit_files(base, &renamed, 0).unwrap();
    assert_eq!(files[0].old_path.as_deref(), Some("old.txt"));
    let diff = historical_diff(base, &renamed, "renamed.txt", 0).unwrap();
    assert_eq!(diff.original, diff.modified);
    let merge = &page.commits[0].hash;
    assert!(commit_files(base, merge, 0)
        .unwrap()
        .iter()
        .any(|f| f.path == "feature.txt"));
    assert!(commit_files(base, merge, 1)
        .unwrap()
        .iter()
        .any(|f| f.path == "renamed.txt"));
    assert!(historical_diff(base, &first, "../outside", 0).is_err());
    assert!(checked_commit(base, "--all").is_err());
    assert!(git(base, &["status", "--porcelain"]).unwrap().is_empty());
}
