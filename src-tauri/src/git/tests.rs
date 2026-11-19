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
fn repository() -> tempfile::TempDir {
    let temp = tempfile::tempdir().unwrap();
    let base = temp.path();
    for args in [
        vec!["init", "-b", "main"],
        vec!["config", "user.name", "Devyy test"],
        vec!["config", "user.email", "test@devyy.local"],
        vec!["config", "commit.gpgsign", "false"],
        vec!["config", "core.hooksPath", "disabled-hooks"],
    ] {
        git(base, &args).unwrap();
    }
    temp
}
fn commit_file(base: &Path, path: &str, content: &str) {
    std::fs::write(base.join(path), content).unwrap();
    git(base, &["add", "--", path]).unwrap();
    git(base, &["commit", "-m", content]).unwrap();
}
fn add_module(base: &Path, source: &Path, path: &str) {
    git(
        base,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            "--",
            source.to_str().unwrap(),
            path,
        ],
    )
    .unwrap();
}
#[test]
fn remote_branches_track_and_local_branches_rename_delete_and_fast_forward() {
    let temp = repository();
    let base = temp.path();
    commit_file(base, "file.txt", "initial");
    git(base, &["remote", "add", "origin", base.to_str().unwrap()]).unwrap();
    git(base, &["update-ref", "refs/remotes/origin/topic", "HEAD"]).unwrap();
    git(
        base,
        &[
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/topic",
        ],
    )
    .unwrap();
    let details = branches(base).unwrap();
    assert_eq!(details.len(), 2); // Symbolic remote HEAD must not be offered as a branch.
    assert!(details
        .iter()
        .any(|item| item.remote && item.name == "origin/topic"));
    switch_branch(base, "refs/remotes/origin/topic", false, None).unwrap();
    assert_eq!(status(base).unwrap().branch, "topic");
    assert_eq!(
        status(base).unwrap().upstream.as_deref(),
        Some("origin/topic")
    );
    switch_branch(base, "main", false, None).unwrap();
    switch_branch(base, "refs/remotes/origin/topic", false, None).unwrap();
    branch_action(base, "rename", "refs/heads/topic", Some("renamed")).unwrap();
    assert_eq!(status(base).unwrap().branch, "renamed");
    commit_file(base, "file.txt", "new commit");
    switch_branch(base, "main", false, None).unwrap();
    assert!(branch_action(base, "delete", "refs/heads/renamed", None).is_err());
    branch_action(base, "merge", "refs/heads/renamed", None).unwrap();
    git(
        base,
        &[
            "update-ref",
            "refs/remotes/origin/topic",
            "refs/heads/renamed",
        ],
    )
    .unwrap();
    branch_action(base, "delete", "refs/heads/renamed", None).unwrap();
    assert!(!branches(base)
        .unwrap()
        .iter()
        .any(|item| item.name == "renamed"));
    assert!(switch_branch(base, "--force", true, None).is_err());
    assert!(branch_action(base, "delete", "refs/heads/main", None).is_err());
}
#[test]
fn branch_switching_preserves_dirty_files_and_refuses_overwrites_and_divergent_updates() {
    let temp = repository();
    let base = temp.path();
    commit_file(base, "file.txt", "initial");
    switch_branch(base, "feature", true, None).unwrap();
    commit_file(base, "file.txt", "feature");
    switch_branch(base, "main", false, None).unwrap();
    std::fs::write(base.join("file.txt"), "unsaved work").unwrap();
    assert!(switch_branch(base, "feature", false, None).is_err());
    assert_eq!(
        std::fs::read_to_string(base.join("file.txt")).unwrap(),
        "unsaved work"
    );
    commit_file(base, "file.txt", "divergent");
    assert!(branch_action(base, "merge", "refs/heads/feature", None).is_err());
    assert_eq!(
        std::fs::read_to_string(base.join("file.txt")).unwrap(),
        "divergent"
    );
    switch_branch(base, "from-feature", true, Some("refs/heads/feature")).unwrap();
    assert_eq!(
        std::fs::read_to_string(base.join("file.txt")).unwrap(),
        "feature"
    );
}
#[test]
fn branch_lists_mark_other_worktrees_and_refuse_deleting_them() {
    let temp = repository();
    let other = tempfile::tempdir().unwrap();
    let base = temp.path();
    commit_file(base, "file.txt", "initial");
    git(
        base,
        &[
            "worktree",
            "add",
            "-b",
            "other",
            other.path().join("tree").to_str().unwrap(),
        ],
    )
    .unwrap();
    let details = branches(base).unwrap();
    assert!(details
        .iter()
        .any(|item| item.name == "other" && item.worktree.is_some()));
    assert!(branch_action(base, "delete", "refs/heads/other", None).is_err());
}
#[test]
fn submodules_support_spaces_dirty_status_initialization_and_scoped_operations() {
    let source = repository();
    commit_file(source.path(), "lib.rs", "initial library");
    let temp = repository();
    let canonical = temp.path().canonicalize().unwrap();
    let base = canonical.as_path();
    commit_file(base, "root.txt", "root");
    add_module(base, source.path(), "packages/shared library");
    git(base, &["commit", "-am", "Add module"]).unwrap();
    let entries = submodules(base).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].path, "packages/shared library");
    assert!(entries[0].initialized);
    assert!(!entries[0].dirty);
    assert_eq!(
        entries[0].head.as_deref(),
        Some(entries[0].expected.as_str())
    );
    let child = repository_base(base, Some(&entries[0].path)).unwrap();
    std::fs::write(child.join("lib.rs"), "modified library").unwrap();
    assert!(submodules(base).unwrap()[0].dirty);
    let local = local_path(Some(&entries[0].path), "packages/shared library/lib.rs").unwrap();
    stage(&child, local, false).unwrap();
    assert_eq!(status(&child).unwrap().changes[0].index, "M");
    assert_eq!(status(base).unwrap().changes[0].index, " ");
    assert_eq!(
        diff_files(&child, local, true).unwrap().modified,
        "modified library"
    );
    assert!(local_path(Some(&entries[0].path), "root.txt").is_err());
    assert!(repository_base(base, Some("../outside")).is_err());
    git(&child, &["reset", "--hard", "HEAD"]).unwrap();
    git(
        base,
        &["submodule", "deinit", "--", "packages/shared library"],
    )
    .unwrap();
    assert!(!submodules(base).unwrap()[0].initialized);
    assert!(repository_base(base, Some("packages/shared library")).is_err());
    submodule_action(base, "update", Some("packages/shared library"), None).unwrap();
    assert!(submodules(base).unwrap()[0].initialized);
    submodule_action(base, "sync", Some("packages/shared library"), None).unwrap();
    assert!(submodule_action(base, "update", Some("root.txt"), None).is_err());
    let diff = diff_files(base, "packages/shared library", false).unwrap();
    assert!(diff.modified.starts_with("Subproject commit "));
    #[cfg(unix)]
    {
        std::fs::remove_dir_all(&child).unwrap();
        std::os::unix::fs::symlink(source.path(), &child).unwrap();
        assert!(diff_files(base, "packages/shared library", false).is_err());
        assert!(!submodules(base).unwrap()[0].initialized);
    }
}
#[test]
fn nested_submodules_are_discovered_and_targeted_through_their_parent_repository() {
    let leaf = repository();
    commit_file(leaf.path(), "leaf.txt", "leaf");
    let middle = repository();
    commit_file(middle.path(), "middle.txt", "middle");
    add_module(middle.path(), leaf.path(), "inner library");
    git(middle.path(), &["commit", "-am", "Nested module"]).unwrap();
    let parent = repository();
    let canonical = parent.path().canonicalize().unwrap();
    let base = canonical.as_path();
    commit_file(base, "parent.txt", "parent");
    add_module(base, middle.path(), "modules/middle");
    git(
        base,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "update",
            "--init",
            "--recursive",
        ],
    )
    .unwrap();
    let entries = submodules(base).unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[1].parent, "modules/middle");
    assert_eq!(entries[1].path, "modules/middle/inner library");
    submodule_action(base, "sync", Some("modules/middle/inner library"), None).unwrap();
    submodule_action(base, "update", Some("modules/middle/inner library"), None).unwrap();
    assert!(submodule_action(
        base,
        "add",
        Some("../escape"),
        Some("https://example.com/repo.git")
    )
    .is_err());
    assert!(submodule_action(base, "add", Some("safe"), Some("--bad-option")).is_err());
}
#[test]
fn visual_diffs_keep_head_index_and_worktree_separate() {
    let temp = repository();
    let canonical = temp.path().canonicalize().unwrap();
    let base = canonical.as_path();
    std::fs::write(base.join("file name.rs"), "base\n").unwrap();
    stage(base, "file name.rs", false).unwrap();
    git(base, &["commit", "-m", "Initial"]).unwrap();
    std::fs::write(base.join("file name.rs"), "staged\n").unwrap();
    stage(base, "file name.rs", false).unwrap();
    std::fs::write(base.join("file name.rs"), "working\n").unwrap();
    let staged = diff_files(base, "file name.rs", true).unwrap();
    assert_eq!(staged.original, "base\n");
    assert_eq!(staged.modified, "staged\n");
    let working = diff_files(base, "file name.rs", false).unwrap();
    assert_eq!(working.original, "staged\n");
    assert_eq!(working.modified, "working\n");
    let state = status(base).unwrap();
    assert_eq!(state.changes[0].index, "M");
    assert_eq!(state.changes[0].worktree, "M");
    assert!(diff_files(base, "../outside", false).is_err());
    assert!(stage(base, "../outside", false).is_err());
}
#[test]
fn visual_diffs_handle_unborn_renamed_deleted_binary_and_untracked_files() {
    let temp = repository();
    let canonical = temp.path().canonicalize().unwrap();
    let base = canonical.as_path();
    std::fs::write(base.join("before.txt"), "original\n").unwrap();
    stage(base, "before.txt", false).unwrap();
    assert!(diff_files(base, "before.txt", true)
        .unwrap()
        .original
        .is_empty());
    git(base, &["commit", "-m", "Initial"]).unwrap();
    git(base, &["mv", "before.txt", "after.txt"]).unwrap();
    let renamed = diff_files(base, "after.txt", true).unwrap();
    assert_eq!(renamed.old_path.as_deref(), Some("before.txt"));
    assert_eq!(renamed.original, "original\n");
    std::fs::remove_file(base.join("after.txt")).unwrap();
    let deleted = diff_files(base, "after.txt", false).unwrap();
    assert_eq!(deleted.original, "original\n");
    assert!(deleted.modified.is_empty());
    std::fs::write(base.join("new.txt"), "new\n").unwrap();
    let new = diff_files(base, "new.txt", false).unwrap();
    assert!(new.original.is_empty());
    assert_eq!(new.modified, "new\n");
    std::fs::write(base.join("binary.bin"), [0, 1, 2]).unwrap();
    assert!(diff_files(base, "binary.bin", false).unwrap().binary);
    stage(base, "after.txt", true).unwrap();
    assert!(status(base)
        .unwrap()
        .changes
        .iter()
        .all(|change| change.index.trim().is_empty() || change.index == "?"));
}
