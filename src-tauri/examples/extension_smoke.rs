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

#![allow(dead_code)]
#[path = "../src/extension_host.rs"]
mod extension_host;
#[path = "../src/extension_servers.rs"]
mod extension_servers;
#[path = "../src/extensions.rs"]
mod extensions;
#[path = "../src/language_config.rs"]
mod language_config;
#[path = "../src/lsp.rs"]
mod lsp;
#[path = "../src/process.rs"]
mod process;
#[path = "../src/workspace.rs"]
mod workspace;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;
static FINISHED: AtomicBool = AtomicBool::new(false);
#[tauri::command]
fn smoke_result(result: Value, app: tauri::AppHandle) {
    println!("EXTENSION_NATIVE_SMOKE {result}");
    let passed = result["completion"] == "hello"
        && result["isolation"] == "sandboxed"
        && result["script"] == true
        && result["tree"] == "Example extension"
        && result["mainMenuBlocked"] == true
        && result["frameMenuBlocked"] == true
        && result["customHandlerRan"] == true;
    FINISHED.store(true, Ordering::SeqCst);
    app.state::<extension_host::ExtensionHost>().shutdown();
    app.exit(if passed { 0 } else { 1 });
}
fn main() {
    let base = std::env::temp_dir().join(format!("devyy-native-extension-{}", std::process::id()));
    let package = base.join("extensions/devyy.devyy-example");
    std::fs::create_dir_all(&package).unwrap();
    for file in ["package.json", "extension.cjs", "server.cjs", "icon.svg"] {
        std::fs::copy(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../examples/devyy-extension")
                .join(file),
            package.join(file),
        )
        .unwrap();
    }
    let project = base.join("project");
    std::fs::create_dir_all(&project).unwrap();
    std::fs::write(project.join("sample.devyy-sample"), "hel").unwrap();
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "xyz.devyy.extension-smoke".into();
    context.config_mut().app.app_directories_override = Some(
        tauri::utils::config::AppDirectoriesOverride::Root(base.clone()),
    );
    context.config_mut().app.windows.clear();
    let workspace_path = serde_json::to_string(&project.to_string_lossy()).unwrap();
    let app = tauri::Builder::default()
        .plugin(tauri::plugin::Builder::<tauri::Wry>::new("context-menu-policy").js_init_script_on_all_frames(include_str!("../../public/context-menu.js")).build())
        .manage(extension_host::ExtensionHost::default()).manage(workspace::Workspace::default()).manage(lsp::LanguageServers::default())
        .register_uri_scheme_protocol("devyy-smoke", |_, _| tauri::http::Response::builder().header("Content-Type", "text/html").header("Content-Security-Policy", "default-src 'self'; script-src 'self'; frame-src devyy-extension: http://devyy-extension.localhost; style-src 'unsafe-inline'").body(b"<!doctype html><body>Checking native extension runtime</body>".to_vec()).unwrap())
        .register_uri_scheme_protocol("devyy-extension", |context, request| extension_host::webview_response(context.app_handle(), &request))
        .invoke_handler(tauri::generate_handler![smoke_result,workspace::open_workspace,extension_host::extension_host_request,extension_host::extension_webview_document,lsp::lsp_start,lsp::lsp_request,lsp::file_uri])
        .setup(move |app| {
            let script = r#"
                (async()=>{
                    const call=window.__TAURI_INTERNALS__.invoke;
                    let customHandlerRan=false;document.body.addEventListener('contextmenu',()=>customHandlerRan=true);
                    const menuEvent=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});document.body.dispatchEvent(menuEvent);
                    const mainMenuBlocked=menuEvent.defaultPrevented;
                    try {
                        await call('open_workspace',{path:WORKSPACE_PATH});
                        await call('extension_host_request',{method:'restart',params:{}});
                        const tree=await call('extension_host_request',{method:'tree',params:{id:'devyy.example.tree'}});
                        await call('lsp_start',{language:'devyy-sample'});
                        const uri=await call('file_uri',{path:'sample.devyy-sample'});
                        await call('lsp_request',{language:'devyy-sample',method:'textDocument/didOpen',params:{textDocument:{uri,languageId:'devyy-sample',version:1,text:'hel'}},notification:true});
                        const completions=await call('lsp_request',{language:'devyy-sample',method:'textDocument/completion',params:{textDocument:{uri},position:{line:0,character:3}},notification:false});
                        const html="<!doctype html><body><script>let isolation;try{parent.document;isolation='unsafe'}catch{isolation='sandboxed'}const menuEvent=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});document.body.dispatchEvent(menuEvent);parent.postMessage({script:true,isolation,frameMenuBlocked:menuEvent.defaultPrevented},'*')<\/script></body>";
                        const url=await call('extension_webview_document',{id:'native-smoke',html});
                        const frame=document.createElement('iframe');frame.sandbox='allow-scripts';frame.src=url;
                        window.addEventListener('message',event=>{if(event.source===frame.contentWindow)call('smoke_result',{result:{...event.data,mainMenuBlocked,customHandlerRan,completion:completions[0]?.label,tree:tree[0]?.label}})});
                        document.body.append(frame);
                    } catch(error) { call('smoke_result',{result:{error:String(error)}}); }
                })();
            "#.replace("WORKSPACE_PATH", &workspace_path);
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External("devyy-smoke://localhost/".parse().unwrap()))
                .title("Devyy extension verification").inner_size(600.0, 400.0)
                .on_page_load(move |window, payload| { if payload.event() == tauri::webview::PageLoadEvent::Finished && payload.url().scheme() == "devyy-smoke" { let _ = window.eval(&script); } }).build()?;
            Ok(())
        }).build(context).expect("Native extension smoke failed to start");
    let timeout = app.handle().clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(35));
        if !FINISHED.load(Ordering::SeqCst) {
            eprintln!("Native extension smoke timed out");
            timeout.state::<extension_host::ExtensionHost>().shutdown();
            timeout.exit(1);
        }
    });
    app.run(|app, event| {
        if let tauri::RunEvent::Exit = event {
            app.state::<extension_host::ExtensionHost>().shutdown();
        }
    });
    let _ = std::fs::remove_dir_all(base);
}
