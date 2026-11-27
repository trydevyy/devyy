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
#[path = "../src/account.rs"]
mod account;
#[path = "../src/appearance.rs"]
mod appearance;
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
#[path = "../src/ssh.rs"]
mod ssh;
#[path = "../src/store.rs"]
mod store;
#[path = "../src/workspace.rs"]
mod workspace;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;
static FINISHED: AtomicBool = AtomicBool::new(false);
#[tauri::command]
fn compat_result(result: Value, app: tauri::AppHandle) {
    println!("EXTENSION_COMPAT_SMOKE {result}");
    let passed = result["active"] == true
        && result["rendered"] == true
        && result["messages"].as_u64().unwrap_or(0) > 0
        && result["error"].is_null();
    FINISHED.store(true, Ordering::SeqCst);
    app.state::<extension_host::ExtensionHost>().shutdown();
    app.exit(if passed { 0 } else { 1 });
}
fn main() {
    let package = std::path::PathBuf::from(
        std::env::var("DEVYY_COMPAT_EXTENSION")
            .expect("Set DEVYY_COMPAT_EXTENSION to an unpacked extension directory"),
    );
    let manifest: Value =
        serde_json::from_slice(&std::fs::read(package.join("package.json")).unwrap()).unwrap();
    let id = format!(
        "{}.{}",
        manifest["publisher"].as_str().unwrap(),
        manifest["name"].as_str().unwrap()
    );
    let view = manifest["contributes"]["views"]
        .as_object()
        .unwrap()
        .values()
        .flat_map(|v| v.as_array().unwrap())
        .filter(|v| v["type"] == "webview")
        .min_by_key(|v| {
            let id = v["id"].as_str().unwrap_or_default();
            (id.to_ascii_lowercase().contains("secondary"), id.len())
        })
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let base = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(base.path().join("extensions")).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(&package, base.path().join("extensions").join(&id)).unwrap();
    #[cfg(not(unix))]
    panic!("This smoke fixture currently uses a symlink on Unix");
    std::env::set_var("CODEX_HOME", base.path().join("codex"));
    std::env::set_var("CLAUDE_CONFIG_DIR", base.path().join("claude"));
    std::fs::create_dir_all(base.path().join("project")).unwrap();
    std::fs::write(base.path().join("project/example.rs"), "fn main() {}\n").unwrap();
    let project = base.path().join("project");
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "xyz.devyy.compat-smoke".into();
    context.config_mut().app.app_directories_override = Some(
        tauri::utils::config::AppDirectoriesOverride::Root(base.path().to_path_buf()),
    );
    context.config_mut().app.windows.clear();
    let storage = include_str!("../../public/extension-storage.js");
    let bootstrap = include_str!("../../public/extension-webview.js");
    let codec = include_str!("../../public/extension-messages.js");
    let params = json!({"id":id,"view":view,"root":project}).to_string();
    let app=tauri::Builder::default()
      .manage(extension_host::ExtensionHost::default()).manage(workspace::Workspace::default()).manage(lsp::LanguageServers::default())
      .register_uri_scheme_protocol("devyy-smoke",|_,_|tauri::http::Response::builder().header("Content-Type","text/html").header("Content-Security-Policy","default-src 'self'; script-src 'self'; frame-src devyy-extension: http://devyy-extension.localhost; style-src 'unsafe-inline'").body(b"<!doctype html><body>Checking extension compatibility</body>".to_vec()).unwrap())
      .register_uri_scheme_protocol("devyy-extension",|context,request|extension_host::webview_response(context.app_handle(),&request))
      .invoke_handler(tauri::generate_handler![compat_result,workspace::open_workspace,extension_host::extension_host_request,extension_host::extension_webview_document])
      .setup(move|app|{
        let script=r#"
          (async()=>{
            const params=PARAMS;const call=window.__TAURI_INTERNALS__.invoke;
            const request=(method,params={})=>call('extension_host_request',{method,params});
            let frame, ready=false, messages=0, active=false, view,errors=[],queue=[],sendQueue=Promise.resolve(),types=new Set(),outgoing=0,extensionErrors=[],workbench=new Set();
            const reply=(message)=>{if(ready)frame.contentWindow.postMessage({channel:'devyy-host',message:window.__DEVYY_EXTENSION_MESSAGES__.decode(message)},'*');else queue.push(message)};
            const callback=window.__TAURI_INTERNALS__.transformCallback(({payload:e})=>{
              if(e.event==='webview'&&e.payload.id===params.view)view=e.payload;
              if(e.event==='webviewMessage'){outgoing++;reply(e.payload.message);}
              if(e.event==='workbenchRequest'){workbench.add(e.payload.method);void request('workbenchResponse',{id:e.payload.id,error:'No interactive action was requested in this smoke test'});}
              if(e.event==='hostError')errors.push(e.payload.error);
            });
            await call('plugin:event|listen',{event:'extension-host',target:{kind:'Any'},handler:callback});
            window.addEventListener('message',async e=>{
              if(e.source!==frame?.contentWindow)return;
              if(e.data?.channel==='devyy-ready'){ready=true;for(const message of queue)reply(message);queue=[];}
              if(e.data?.channel==='devyy-extension'){messages++;if(e.data.message?.type==='log-message'&&e.data.message?.level==='error'&&extensionErrors.length<8)extensionErrors.push({message:e.data.message.message,safe:e.data.message.tags?.safe,error:e.data.message.tags?.sensitive?.errorMessage});types.add(e.data.message?.type??Object.keys(e.data.message??{}).join(','));sendQueue=sendQueue.then(()=>request('webviewMessage',{id:params.view,message:window.__DEVYY_EXTENSION_MESSAGES__.encode(e.data.message)}));await sendQueue;}
              if(e.data?.channel==='compat-render')await call('compat_result',{result:{id:params.id,active,rendered:e.data.rendered,messages,outgoing,types:[...types],extensionErrors,workbench:[...workbench],ready,queued:queue.length,body:e.data.body,root:e.data.root,error:e.data.errors[0]??errors[0]??null}});
            });
            try{
              await call('open_workspace',{path:params.root});
              const statuses=await request('restart');active=statuses.some(s=>s.id.toLowerCase()===params.id.toLowerCase()&&s.status==='active');
              if(!active)throw Error(JSON.stringify(statuses));
              await request('resolveView',{id:params.view});for(let i=0;i<200&&!view?.html;i++)await new Promise(r=>setTimeout(r,10));if(!view?.html)throw Error('No webview HTML');
              const probe=`<script>const errors=[];window.addEventListener('error',e=>{if(e.message)errors.push(e.message);else if(e.target?.src)errors.push('Resource failed: '+e.target.src)} ,true);setTimeout(()=>parent.postMessage({channel:'compat-render',rendered:document.querySelector('#root')?.childElementCount>0&&document.body.innerText.trim().length>20&&!/hit a snag|something went wrong|^Error:/i.test(document.body.innerText),body:document.body.innerText.trim().slice(0,300),root:document.querySelector('#root')?.childElementCount,errors},'*'),12000);<\/script>`;
              let html=window.__DEVYY_CREATE_WEBVIEW_DOCUMENT__({html:view.html,theme:'midnight',tokens:'--vscode-editor-background:#181818;--vscode-editor-foreground:#fff;--vscode-foreground:#fff;--vscode-sideBar-background:#181818;--vscode-input-background:#222;--vscode-input-foreground:#fff'});
              html=html.replace('<head>','<head>'+probe);
              const url=await call('extension_webview_document',{id:params.view,html});
              frame=document.createElement('iframe');frame.sandbox='allow-scripts';frame.style='width:600px;height:700px';frame.src=url;document.body.append(frame);
            }catch(e){await call('compat_result',{result:{active,rendered:false,messages,error:String(e)}});}
          })();
        "#.replace("PARAMS",&params);
        tauri::WebviewWindowBuilder::new(app,"main",tauri::WebviewUrl::CustomProtocol("devyy-smoke://localhost/".parse().unwrap())).initialization_script(format!("{storage}\n{codec}\n{bootstrap}\n{script}")).build()?;
        let handle=app.handle().clone();std::thread::spawn(move||{std::thread::sleep(std::time::Duration::from_secs(50));if!FINISHED.load(Ordering::SeqCst){println!("EXTENSION_COMPAT_SMOKE timeout");handle.state::<extension_host::ExtensionHost>().shutdown();handle.exit(1);}});Ok(())
      }).build(context).expect("build compatibility fixture");
    app.run(|_, _| {});
}
