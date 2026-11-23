pub fn configure_renderer() {
    // WebKitGTK can commit a DMA-BUF without an acquire timeline on NVIDIA Wayland.
    // https://bugs.webkit.org/show_bug.cgi?id=280210
    if std::env::var_os("WAYLAND_DISPLAY").is_some()
        && std::path::Path::new("/sys/module/nvidia").is_dir()
        && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}
