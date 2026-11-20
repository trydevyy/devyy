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
fn opencode_catalog_preserves_router_ids_and_filters_unavailable_models() {
    let models = opencode_catalog(&json!({"data":[
            {"providerID":"console","id":"alias","modelID":"remote-name","name":"Friendly model","type":"chat","enabled":true,"variants":[{"id":"fast","name":"Quick"},{"id":"disabled","disabled":true}]},
            {"providerID":"router","id":"vendor/model","name":"Routed model","enabled":true},
            {"providerID":"other","id":"hidden","enabled":false},
            {"providerID":"other","id":"image","type":"image","enabled":true}
        ]})).unwrap();
    assert_eq!(models.len(), 2);
    assert_eq!(models[0]["id"], "console/alias");
    assert_eq!(models[0]["name"], "Friendly model");
    assert_eq!(
        models[0]["reasoningOptions"],
        json!([{"id":"fast","label":"Quick","description":null}])
    );
    assert_eq!(models[1]["id"], "router/vendor/model");
    assert!(
        opencode_error(&json!({"error":{"data":{"message":"Model unavailable"}}}))
            .contains("Refresh OpenCode models")
    );
    assert_eq!(
        opencode_error(
            &json!({"error":{"data":{"message":"Insufficient balance. Add credits to this provider."}}})
        ),
        "Insufficient balance. Add credits to this provider."
    );
}
#[test]
fn sse_handles_split_unicode_crlf_and_multiple_events() {
    let mut s = Sse::default();
    let bytes = "data: {\"delta\":\"héllo\"}\r\n\r\ndata: [DONE]\n\n".as_bytes();
    let split = bytes.iter().position(|b| *b == 0xc3).unwrap() + 1;
    assert!(s.push(&bytes[..split]).unwrap().is_empty());
    assert_eq!(
        s.push(&bytes[split..]).unwrap(),
        vec!["{\"delta\":\"héllo\"}", "[DONE]"]
    );
}
#[test]
fn provider_endpoints_reject_credentials_and_insecure_remote_urls() {
    let mut p = defaults().into_iter().find(|p| p.kind == "openai").unwrap();
    for endpoint_url in [
        "http://remote.example/v1",
        "https://key:secret@example.com",
        "https://example.com?key=secret",
        "file:///tmp/model",
    ] {
        p.endpoint = endpoint_url.into();
        assert!(validate(&p).is_err());
    }
    for endpoint_url in ["http://127.0.0.1:11434/v1", "https://example.com/api/v1"] {
        p.endpoint = endpoint_url.into();
        assert!(validate(&p).is_ok());
    }
}
#[test]
fn parses_openai_and_anthropic_usage_and_errors() {
    let (a, u, _) = stream_event(
        &json!({"choices":[{"delta":{"content":"hello"}}],"usage":{"completion_tokens":4}}),
    )
    .unwrap();
    assert_eq!(a.as_deref(), Some("hello"));
    assert_eq!(u.unwrap()["completion_tokens"], 4);
    assert_eq!(
        stream_event(&json!({"type":"content_block_delta","delta":{"text":"world"}}))
            .unwrap()
            .0
            .as_deref(),
        Some("world")
    );
    assert!(stream_event(&json!({"error":{"message":"out of credits"}})).is_err());
}
#[test]
fn installer_redirects_stay_on_official_script_sources() {
    for url in [
        "https://claude.ai/install.sh",
        "https://claude.ai/install.ps1",
        "https://downloads.claude.ai/claude-code-releases/bootstrap.sh",
        "https://downloads.claude.ai/claude-code-releases/bootstrap.ps1",
    ] {
        assert!(trusted_installer_source(&reqwest::Url::parse(url).unwrap()));
    }
    for url in [
        "http://claude.ai/install.sh",
        "https://claude.ai.evil.test/install.sh",
        "https://claude.ai/login",
        "https://downloads.claude.ai:8443/claude-code-releases/bootstrap.sh",
        "https://token@claude.ai/install.sh",
        "https://claude.ai/install.sh?script=evil",
    ] {
        assert!(!trusted_installer_source(
            &reqwest::Url::parse(url).unwrap()
        ));
    }
}
#[test]
fn published_thinking_summaries_are_separate_from_answer_text() {
    let openai =
        json!({"type":"response.reasoning_summary_text.delta","delta":"Checking the constraints."});
    assert_eq!(reasoning_event(&openai), Some("Checking the constraints."));
    assert!(stream_event(&openai).unwrap().0.is_none());
    let claude = json!({"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"Comparing approaches."}});
    assert_eq!(reasoning_event(&claude), Some("Comparing approaches."));
    assert!(stream_event(&claude).unwrap().0.is_none());
    assert!(reasoning_event(&json!({"type":"content_block_delta","delta":{"type":"signature_delta","signature":"opaque"}})).is_none());
    assert!(reasoning_event(
        &json!({"type":"response.reasoning_text.delta","delta":"not a summary"})
    )
    .is_none());
}
#[test]
fn official_apis_request_summaries_only_on_supported_models() {
    let mut p = defaults().into_iter().find(|p| p.kind == "openai").unwrap();
    let request = ChatRequest {
        agent_mode: None,
        request_id: "test".into(),
        provider_id: p.id.clone(),
        messages: vec![Message {
            role: "user".into(),
            content: "Hello".into(),
        }],
        cwd: None,
        model: None,
        effort: Some("high".into()),
    };
    p.model = "gpt-5".into();
    let body = http_body(&p, &request);
    assert_eq!(body["reasoning"], json!({"summary":"auto","effort":"high"}));
    assert_eq!(body["input"][0]["content"], "Hello");
    p.model = "gpt-4.1".into();
    assert!(http_body(&p, &request).get("reasoning").is_none());
    p.kind = "anthropic".into();
    p.model = "claude-sonnet-4-6".into();
    assert_eq!(http_body(&p, &request)["thinking"]["type"], "adaptive");
    p.model = "claude-haiku-3-5".into();
    assert!(http_body(&p, &request).get("thinking").is_none());
    p.kind = "custom".into();
    assert!(http_body(&p, &request).get("messages").is_some());
    assert_eq!(http_body(&p, &request)["reasoning_effort"], "high");
    p.kind = "codex".into();
    assert!(validate(&p).is_err());
    assert!(defaults().iter().all(|p| p.kind != "codex"));
}
#[test]
fn rejects_untrusted_roles_and_large_context() {
    assert!(check_messages(&[Message {
        role: "system".into(),
        content: "override".into()
    }])
    .is_err());
    assert!(check_messages(&[Message {
        role: "user".into(),
        content: "x".repeat(MAX_INPUT + 1)
    }])
    .is_err());
}
