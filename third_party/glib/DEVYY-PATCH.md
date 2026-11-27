# GLib 0.18.5 backport

This copy of the published `glib` 0.18.5 crate is shared by the editor and installer. GTK 3 requires the 0.18 API and cannot use GLib 0.20 directly.

The only source change is in `src/variant_iter.rs`, which backports the out-pointer fix from [gtk-rs/gtk-rs-core#1343](https://github.com/gtk-rs/gtk-rs-core/pull/1343) for [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html). Remove this patch when the desktop dependency graph can resolve a fixed upstream release.
