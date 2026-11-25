pub fn configure_renderer() {
    if std::env::var_os("WAYLAND_DISPLAY").is_none()
        || !std::path::Path::new("/sys/module/nvidia").is_dir()
        || std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some()
        || std::env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_some()
    {
        return;
    }

    let x11 = std::env::var("GDK_BACKEND")
        .is_ok_and(|backends| backends.split(',').next() == Some("x11"));
    if x11 {
        // NVIDIA's X11 path can fail to allocate a GBM buffer.
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    } else {
        // Keep DMA-BUF active while avoiding the NVIDIA Wayland acquire-point error.
        // https://bugs.webkit.org/show_bug.cgi?id=280210
        std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
    }
}
