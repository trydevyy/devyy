#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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

#[cfg(target_os = "linux")]
#[path = "../../shared/linux_webkit.rs"]
mod linux_webkit;

fn main() {
    #[cfg(windows)]
    if let Some(result) = devyy_lib::updater::run_helper() {
        if let Err(error) = result {
            let text: Vec<u16> = error.encode_utf16().chain([0]).collect();
            let title: Vec<u16> = "Devyy update".encode_utf16().chain([0]).collect();
            unsafe {
                windows_sys::Win32::UI::WindowsAndMessaging::MessageBoxW(
                    std::ptr::null_mut(),
                    text.as_ptr(),
                    title.as_ptr(),
                    0x10,
                );
            }
        }
        return;
    }
    #[cfg(windows)]
    devyy_lib::updater::clean_previous_helper();
    #[cfg(target_os = "linux")]
    linux_webkit::configure_renderer();
    devyy_lib::run();
}
