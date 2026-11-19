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
use std::sync::Arc;
use tauri::{
    test::{mock_builder, mock_context, noop_assets, MockRuntime},
    Listener,
};
fn app() -> (tauri::App<MockRuntime>, Arc<Mutex<Vec<Value>>>) {
    let app = mock_builder().build(mock_context(noop_assets())).unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    app.listen("devyy-ai", move |event| {
        sink.lock()
            .unwrap()
            .push(serde_json::from_str(event.payload()).unwrap());
    });
    (app, events)
}
fn chat() -> ChatRequest {
    ChatRequest {
        request_id: "transport-test".into(),
        provider_id: "fixture".into(),
        messages: vec![Message {
            role: "user".into(),
            content: "Explain this fixture".into(),
        }],
        cwd: None,
        model: None,
        effort: None,
    }
}
fn fixture_provider(kind: &str) -> Provider {
    Provider {
        id: "fixture".into(),
        name: "Fixture".into(),
        kind: kind.into(),
        endpoint: String::new(),
        model: "fixture-model".into(),
        executable: String::new(),
        args: Vec::new(),
        cli_json: false,
        has_key: false,
        enabled: true,
    }
}
#[test]
fn cli_model_discovery_ignores_banners_and_never_invents_models() {
    let models = cli_models("Fetching available models\nID NAME\n\x1b[32mgemini-flash\x1b[0m Gemini Flash\nanthropic/sonnet\nhttps://example.com/help\n");
    assert_eq!(models.len(), 2);
    assert_eq!(models[0]["id"], "gemini-flash");
    assert_eq!(models[0]["name"], "Gemini Flash");
    assert_eq!(models[1]["id"], "anthropic/sonnet");
    assert!(cli_models("Please sign in first").is_empty());
}
#[cfg(unix)]
#[tokio::test]
async fn antigravity_uses_documented_stream_input_and_terminal_usage() {
    let (_dir, path) = executable(
        r#"import sys,json
assert sys.argv[1:] == ['--output-format','stream-json','--input-format','stream-json','--model','fixture-model']
value=json.loads(sys.stdin.read())
assert value['event']=='user'
assert 'Explain this fixture' in value['message']['content']
assert 'You are Devyy' in value['message']['content']
print(json.dumps({'event':'step_update','step_update':{'text_delta':'Hello','usage':{'input_tokens':999}}}))
print(json.dumps({'event':'step_update','step_update':{'text_delta':' there'}}))
print(json.dumps({'event':'result','result':{'status':'SUCCESS','response':'Hello there','usage':{'input_tokens':12,'output_tokens':4}}}))
"#,
    );
    let mut p = fixture_provider("antigravity");
    p.executable = path;
    let (app, events) = app();
    antigravity_chat(app.handle(), &p, &chat()).await.unwrap();
    let events = events.lock().unwrap();
    assert_eq!(
        events
            .iter()
            .filter(|e| e["kind"] == "delta")
            .filter_map(|e| e["data"].as_str())
            .collect::<String>(),
        "Hello there"
    );
    let usage: Vec<_> = events.iter().filter(|e| e["kind"] == "usage").collect();
    assert_eq!(usage.len(), 1);
    assert_eq!(usage[0]["data"]["input_tokens"], 12);
}

#[cfg(unix)]
#[tokio::test]
async fn opencode_discovery_reads_metadata_in_the_same_private_scope_as_chat() {
    let (_dir, path) = executable(
        r#"import sys,json,os
assert sys.argv[1:]==['api','GET','/api/model']
assert os.environ['PWD']==os.getcwd()
assert not os.path.exists('Cargo.toml')
print(json.dumps({'data':[{'providerID':'router','id':'vendor/model','name':'Actual name','enabled':True,'variants':[{'id':'deep','name':'Extended'}]}]}))
"#,
    );
    let mut provider = fixture_provider("opencode");
    provider.executable = path;
    let (app, _) = app();
    let models = opencode_models(app.handle(), &provider).await.unwrap();
    assert_eq!(models[0]["id"], "router/vendor/model");
    assert_eq!(models[0]["reasoningOptions"][0]["label"], "Extended");
}
#[cfg(unix)]
#[tokio::test]
async fn opencode_streams_and_accumulates_each_step_once() {
    let (_dir, path) = executable(
        r#"import sys,json
assert sys.argv[1:]==['run','--format','json','--agent','devyy-scoped','--model','fixture-model']
assert 'Explain this fixture' in sys.stdin.read()
print(json.dumps({'type':'text','part':{'id':'text-1','text':'Hello'}}))
print(json.dumps({'type':'message.part.updated','properties':{'part':{'id':'text-1','type':'text','text':'Hello there'}}}))
print(json.dumps({'type':'message.part.delta','properties':{'partID':'text-1','field':'text','delta':'!'}}))
print(json.dumps({'type':'text','part':{'id':'text-1','text':'Hello there!'}}))
step={'type':'step_finish','part':{'id':'a','tokens':{'input':10,'output':2,'reasoning':1,'cache':{'read':3}},'cost':0.01}}
print(json.dumps(step)); print(json.dumps(step))
step['part']['id']='b'; print(json.dumps(step))
"#,
    );
    let mut p = fixture_provider("opencode");
    p.executable = path;
    let (app, events) = app();
    opencode_chat(app.handle(), &p, &chat()).await.unwrap();
    let events = events.lock().unwrap();
    assert_eq!(
        events
            .iter()
            .filter(|e| e["kind"] == "delta")
            .filter_map(|e| e["data"].as_str())
            .collect::<String>(),
        "Hello there!"
    );
    let usage: Vec<_> = events.iter().filter(|e| e["kind"] == "usage").collect();
    assert_eq!(usage.len(), 2);
    assert_eq!(usage[1]["data"]["input_tokens"], 20);
    assert_eq!(usage[1]["data"]["cache_read_input_tokens"], 6);
    assert_eq!(
        events
            .iter()
            .filter(|e| e["kind"] == "cost")
            .last()
            .unwrap()["data"]["amount"],
        0.02
    );
}
#[tokio::test]
async fn native_http_sends_conversation_and_streams_text_usage_and_summaries() {
    use std::io::{Read, Write};
    for (kind, path, body) in [
            ("custom", "chat/completions", "data: {\"choices\":[{\"delta\":{\"content\":\"héllo\"}}]}\n\ndata: {\"usage\":{\"prompt_tokens\":12,\"completion_tokens\":4}}\n\ndata: [DONE]\n\n"),
            ("openai", "responses", "data: {\"type\":\"response.reasoning_summary_text.delta\",\"delta\":\"Checking constraints.\"}\n\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"héllo\"}\n\ndata: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":12,\"output_tokens\":4}}}\n\n"),
        ] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut request = Vec::new();
                let mut buffer = [0u8; 4096];
                loop {
                    let n = socket.read(&mut buffer).unwrap();
                    assert!(n > 0);
                    request.extend_from_slice(&buffer[..n]);
                    if let Some(index) = request.windows(4).position(|b| b == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&request[..index]).to_lowercase();
                        let length = headers.lines().find_map(|l| l.strip_prefix("content-length:").and_then(|l| l.trim().parse::<usize>().ok())).unwrap();
                        if request.len() >= index + 4 + length { break; }
                    }
                }
                write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nx-ratelimit-remaining-tokens: 500\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
                request
            });
            let (mut p, r) = (fixture_provider(kind), chat());
            p.endpoint = format!("http://{address}/v1");
            if kind == "openai" { p.model = "gpt-5".into(); }
            let (app, events) = app();
            http_chat(app.handle(), &p, &r).await.unwrap();
            let request = String::from_utf8(server.join().unwrap()).unwrap();
            assert!(request.starts_with(&format!("POST /v1/{path} ")));
            assert!(request.contains("Explain this fixture"));
            assert!(!request.to_lowercase().contains("authorization:"));
            if kind == "openai" { assert!(request.contains("\"summary\":\"auto\"")); }
            let events = events.lock().unwrap();
            assert_eq!(events.iter().filter(|e| e["kind"] == "delta").count(), 1);
            assert!(events.iter().any(|e| e["kind"] == "delta" && e["data"] == "héllo"));
            assert!(events.iter().any(|e| e["kind"] == "usage"));
            assert!(events.iter().any(|e| e["kind"] == "limits" && e["data"]["x-ratelimit-remaining-tokens"] == "500"));
            assert_eq!(events.iter().any(|e| e["kind"] == "reasoning" && e["data"] == "Checking constraints."), kind == "openai");
        }
}
#[cfg(unix)]
fn executable(script: &str) -> (tempfile::TempDir, String) {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("fixture-cli");
    std::fs::write(&path, format!("#!/usr/bin/env python3\n{script}")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
    (dir, path.to_string_lossy().into())
}
#[cfg(unix)]
#[tokio::test]
async fn provider_failures_report_diagnostics_and_drain_large_stderr() {
    for kind in ["antigravity", "opencode"] {
        let (_dir, path) = executable("import sys\nsys.stdin.read()\nsys.stderr.write('Authentication required. Sign in again.\\n' + 'x' * 100000)\nsys.exit(1)");
        let mut p = fixture_provider(kind);
        p.executable = path;
        let (app, _) = app();
        let result = if kind == "antigravity" {
            antigravity_chat(app.handle(), &p, &chat()).await
        } else {
            opencode_chat(app.handle(), &p, &chat()).await
        };
        let error = result.unwrap_err();
        assert!(error.contains("Authentication required"));
        assert!(error.len() < 9000);
    }
}
#[cfg(unix)]
#[tokio::test]
async fn custom_cli_streams_text_and_json_without_a_shell_or_endpoint() {
    for structured in [false, true] {
        let (_dir, path) = executable(if structured {
            r#"import sys,json
request=json.load(sys.stdin)
assert request['model']=='literal $(echo no-shell)'
assert request['messages'][0]['content']=='Explain this fixture'
assert sys.argv[1]=='literal $(echo no-shell)'
for event in [{'type':'delta','text':'héllo'},{'type':'usage','input_tokens':12,'output_tokens':4},{'type':'cost','amount':0.01},{'type':'done'}]:
 print(json.dumps(event),flush=True)
"#
        } else {
            r#"import sys,time
assert 'Explain this fixture' in sys.stdin.read()
data='héllo'.encode()
for chunk in [data[:2], data[2:]]:
 sys.stdout.buffer.write(chunk);sys.stdout.buffer.flush();time.sleep(.01)
"#
        });
        let mut provider = fixture_provider("cli");
        provider.executable = path;
        provider.cli_json = structured;
        provider.model = "literal $(echo no-shell)".into();
        provider.args = vec!["{model}".into()];
        assert!(validate(&provider).is_ok());
        let (app, events) = app();
        custom_cli::chat(app.handle(), &provider, &chat())
            .await
            .unwrap();
        let events = events.lock().unwrap();
        assert_eq!(
            events
                .iter()
                .filter(|e| e["kind"] == "delta")
                .filter_map(|e| e["data"].as_str())
                .collect::<String>(),
            "héllo"
        );
        assert_eq!(events.iter().any(|e| e["kind"] == "usage"), structured);
        assert_eq!(events.iter().any(|e| e["kind"] == "cost"), structured);
    }
}
#[cfg(unix)]
#[tokio::test]
async fn dropping_cancelled_cli_requests_stops_their_subprocesses() {
    for kind in ["claude", "cli"] {
        let (dir, path) = executable("import sys,time,os\nopen(__file__+'.pid','w').write(str(os.getpid()))\nsys.stdin.read()\ntime.sleep(30)");
        let mut p = fixture_provider(kind);
        p.executable = path;
        let (app, _) = app();
        assert!(tokio::time::timeout(Duration::from_secs(1), async {
            if kind == "claude" {
                claude_chat(app.handle(), &p, &chat()).await
            } else {
                custom_cli::chat(app.handle(), &p, &chat()).await
            }
        })
        .await
        .is_err());
        let pid_file = dir.path().join("fixture-cli.pid");
        let mut content = None;
        for _ in 0..40 {
            if let Ok(c) = std::fs::read_to_string(&pid_file) {
                content = Some(c);
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let pid: i32 = content
            .expect("fixture-cli.pid should have been written by the script")
            .parse()
            .unwrap();
        let mut alive = true;
        for _ in 0..40 {
            if unsafe { libc::kill(pid, 0) } == -1 {
                alive = false;
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        assert!(!alive, "Cancelled {kind} subprocess was left running");
    }
}
#[cfg(unix)]
#[tokio::test]
async fn claude_cli_streams_with_tools_disabled_and_no_duplicate_result_text() {
    let (_dir, path) = executable(
        r#"import sys,json
assert sys.argv[sys.argv.index('--tools')+1]==''
assert '--strict-mcp-config' in sys.argv
assert '--no-session-persistence' in sys.argv
assert sys.argv[sys.argv.index('--effort')+1]=='medium'
assert sys.argv[sys.argv.index('--model')+1]=='fixture-model'
assert 'Explain this fixture' in sys.stdin.read()
for value in [
 {'type':'stream_event','event':{'type':'content_block_delta','delta':{'type':'thinking_delta','thinking':'Considering the fixture.'}}},
 {'type':'stream_event','event':{'type':'content_block_delta','delta':{'text':'Claude streamed reply'}}},
 {'type':'rate_limit_event','rate_limit_info':{'status':'allowed','resetsAt':1900000000}},
 {'type':'result','is_error':False,'result':'Claude streamed reply','usage':{'input_tokens':20,'output_tokens':7},'total_cost_usd':0.0123}]:
 print(json.dumps(value),flush=True)
"#,
    );
    let mut p = fixture_provider("claude");
    p.executable = path;
    let (app, events) = app();
    let mut request = chat();
    request.effort = Some("medium".into());
    claude_chat(app.handle(), &p, &request).await.unwrap();
    let events = events.lock().unwrap();
    assert_eq!(events.iter().filter(|e| e["kind"] == "delta").count(), 1);
    assert!(events
        .iter()
        .any(|e| e["kind"] == "reasoning" && e["data"] == "Considering the fixture."));
    assert!(events
        .iter()
        .any(|e| e["kind"] == "cost" && e["data"]["amount"] == 0.0123));
    assert!(events
        .iter()
        .any(|e| e["kind"] == "limits" && e["data"]["status"] == "allowed"));
    assert!(events
        .iter()
        .any(|e| e["kind"] == "usage" && e["data"]["output_tokens"] == 7));
}
