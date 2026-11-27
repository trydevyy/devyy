//! Billing data for the configured inference connection.

use super::*;

pub(super) fn is_openrouter(p: &Provider) -> bool {
    p.kind == "custom" && official_endpoint(p, "openrouter.ai", "/api/v1")
}

fn official_endpoint(p: &Provider, host: &str, path: &str) -> bool {
    endpoint(p).is_ok_and(|url| {
        url.scheme() == "https"
            && url.host_str() == Some(host)
            && url.port().is_none()
            && url.path().trim_end_matches('/') == path
    })
}

pub(super) fn merge_usage(total: &mut Value, event: &Value) {
    if let (Some(total), Some(event)) = (total.as_object_mut(), event.as_object()) {
        for (key, value) in event {
            if !value.is_null() {
                total.insert(key.clone(), value.clone());
            }
        }
    }
}

pub(super) fn record_tier(usage: &mut Value, event: &Value) {
    let tier = event
        .pointer("/response/service_tier")
        .or_else(|| event.pointer("/message/service_tier"))
        .or_else(|| event.get("service_tier"));
    if tier
        .and_then(Value::as_str)
        .is_some_and(|tier| !matches!(tier, "default" | "standard"))
    {
        usage["_nonstandard"] = json!(true);
    }
}

pub(super) fn cost(p: &Provider, usage: &Value) -> Option<(f64, bool)> {
    if p.kind == "antigravity" {
        let model = usage["model"].as_str().unwrap_or(&p.model);
        let model = model.trim_end_matches(|c: char| c.is_whitespace());
        let model = ["-minimal", "-low", "-medium", "-high", "-xhigh", "-max"]
            .iter()
            .find_map(|suffix| model.strip_suffix(suffix))
            .unwrap_or(model);
        let (input_rate, cache_rate, output_rate) = match model {
            // Published Gemini Developer API standard text rates, in USD per million tokens.
            "gemini-4-hydrogen" => (1.5, 0.075, 7.5),
            "gemini-3.8-flash" => {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .ok()?
                    .as_secs();
                if now < 1_798_761_600 {
                    (0.75, 0.075, 3.75)
                } else {
                    (1.5, 0.15, 7.5)
                }
            }

            _ => return None,
        };
        let input = usage["input_tokens"].as_u64()?;
        let cached = usage["cache_read_tokens"].as_u64()?;
        let output = antigravity_output(usage)?;
        let uncached = input.checked_sub(cached)?;
        return Some((
            (uncached as f64 * input_rate
                + cached as f64 * cache_rate
                + output as f64 * output_rate)
                / 1_000_000.0,
            true,
        ));
    }
    if is_openrouter(p) {
        let amount = usage["cost"].as_f64()?;
        return (amount >= 0.0).then_some((amount, false));
    }

    if usage["_nonstandard"] == true {
        return None;
    }

    // USD per million tokens at standard public rates. Unknown models and
    // nonstandard usage are intentionally left unpriced.
    let output = usage["output_tokens"].as_u64()? as f64;
    let input = usage["input_tokens"].as_u64()? as f64;
    let amount = match p.kind.as_str() {
        "openai" | "chatgpt"
            if p.kind == "chatgpt" || official_endpoint(p, "api.openai.com", "/v1") =>
        {
            let (base, hit, out) = match p.model.as_str() {
                // https://developers.openai.com/api/docs/pricing
                "gpt-6.2-astra" => (8.0, 0.4, 40.0),
                "gpt-6.2-sol" | "gpt-6.1-sol" => (2.0, 0.1, 10.0),
                "gpt-6-astra" => (10.0, 1.0, 50.0),
                "gpt-5.4" | "gpt-5.4-2026-03-05" => (2.5, 0.25, 15.0),
                _ => return None,
            };
            let details = &usage["input_tokens_details"];
            let cached = details["cached_tokens"].as_u64().unwrap_or(0) as f64;
            // Extended context and separately metered cache writes can change rates.
            if input > 128_000.0
                || cached > input
                || details.as_object().is_some_and(|fields| {
                    fields.iter().any(|(key, count)| {
                        key != "cached_tokens" && count.as_u64().unwrap_or(0) > 0
                    })
                })
            {
                return None;
            }
            (input - cached) * base + cached * hit + output * out
        }
        "anthropic" if official_endpoint(p, "api.anthropic.com", "/v1") => {
            let (base, hit, out) = match p.model.as_str() {
                // https://platform.claude.com/docs/en/about-claude/pricing
                "claude-sonnet-4-6" => (3.0, 0.3, 15.0),
                "claude-opus-4-6" | "claude-opus-4-8" => (5.0, 0.5, 25.0),
                "claude-haiku-4-5" | "claude-haiku-4-5-20251001" => (1.0, 0.1, 5.0),
                "claude-fable-5-2" => (8.0, 0.2, 40.0),
                "claude-opus-5-5" => (4.0, 0.2, 20.0),
                "claude-sonnet-5-5" => (2.0, 0.1, 10.0),
                _ => return None,
            };
            let cached = usage["cache_read_input_tokens"].as_u64().unwrap_or(0);
            let write = usage["cache_creation_input_tokens"].as_u64().unwrap_or(0);
            let hourly = usage["cache_creation"]["ephemeral_1h_input_tokens"]
                .as_u64()
                .unwrap_or(0)
                .min(write);
            if input + cached as f64 + write as f64 > 128_000.0 {
                return None;
            }
            input * base
                + cached as f64 * hit
                + (write - hourly) as f64 * base * 1.25
                + hourly as f64 * base * 2.0
                + output * out
        }
        _ => return None,
    };
    Some((amount / 1_000_000.0, true))
}

pub(super) fn antigravity_output(usage: &Value) -> Option<u64> {
    let output = usage["output_tokens"].as_u64()?;
    let thinking = usage["thinking_tokens"].as_u64().unwrap_or_default();
    let total = usage["total_tokens"].as_u64();
    let input = usage["input_tokens"].as_u64().unwrap_or_default();
    Some(if total == Some(input.saturating_add(output)) {
        output
    } else {
        output.saturating_add(thinking)
    })
}

#[tauri::command]
pub async fn ai_billing_snapshot(
    app: AppHandle,
    state: State<'_, AiState>,
    provider_id: String,
    request_id: String,
) -> Result<Value, String> {
    let p = provider(&app, &state, &provider_id)?;
    if !p.enabled || !is_openrouter(&p) {
        return Err("This connection does not expose API key spending limits.".into());
    }
    let key = provider_key(&p)?.ok_or("Save an OpenRouter API key first.")?;
    let (_guard, mut cancel) = job(&state, &request_id, &provider_id)?;
    let fetch = async {
        let mut response = client()?
            .get("https://openrouter.ai/api/v1/key")
            .bearer_auth(key)
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|_| "Could not check the OpenRouter key.")?;
        if !response.status().is_success() {
            return Err(format!(
                "OpenRouter returned HTTP {} checking the key.",
                response.status()
            ));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Could not read OpenRouter key usage.")?
        {
            if bytes.len() + chunk.len() > 64 * 1024 {
                return Err("OpenRouter key response was too large.".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        let result: Value =
            serde_json::from_slice(&bytes).map_err(|_| "Invalid OpenRouter key usage.")?;
        let data = &result["data"];
        if !data.is_object() {
            return Err("OpenRouter returned no key usage.".into());
        }
        let effective = &data["effective_budget"];
        let free = &data["free_model_daily_requests"];
        Ok(json!({
            "limit": data["limit"].as_f64(),
            "remaining": data["limit_remaining"].as_f64(),
            "period": data["limit_reset"].as_str(),
            "usage": data["usage"].as_f64(),
            "usageDaily": data["usage_daily"].as_f64(),
            "usageWeekly": data["usage_weekly"].as_f64(),
            "usageMonthly": data["usage_monthly"].as_f64(),
            "byokUsage": data["byok_usage"].as_f64(),
            "effective": effective.is_object().then(|| json!({
                "limit": effective["limit_usd"].as_f64(),
                "remaining": effective["remaining_usd"].as_f64(),
                "period": effective["reset_interval"].as_str(),
                "resetsAt": effective["resets_at"].as_str(),
                "scope": effective["scope"].as_str(),
            })),
            "freeRequests": free.is_object().then(|| json!({
                "limit": free["limit"].as_u64(),
                "remaining": free["remaining"].as_u64(),
            })),
        }))
    };
    tokio::select! {
        result = fetch => result,
        _ = cancel.changed() => Err("Usage check cancelled.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn antigravity_prices_text_and_counts_reasoning_once() {
        let mut p = defaults()
            .into_iter()
            .find(|p| p.kind == "antigravity")
            .unwrap();
        p.model = "gemini-4-hydrogen-high".into();
        let usage = json!({"input_tokens":1000,"cache_read_tokens":600,"output_tokens":200,"thinking_tokens":100,"total_tokens":1200});
        assert_eq!(antigravity_output(&usage), Some(200));
        assert_eq!(cost(&p, &usage), Some((2145.0 / 1_000_000.0, true)));
        p.model = "unknown-model".into();
        assert_eq!(cost(&p, &usage), None);
    }

    #[test]
    fn estimates_only_official_endpoints_and_counts_cache_at_its_own_rate() {
        let mut p = defaults()
            .into_iter()
            .find(|p| p.kind == "anthropic")
            .unwrap();
        p.model = "claude-sonnet-4-6".into();
        let usage = json!({"input_tokens":100, "output_tokens":20, "cache_read_input_tokens":50,
            "cache_creation_input_tokens":20, "cache_creation":{"ephemeral_1h_input_tokens":10}});
        let (amount, estimated) = cost(&p, &usage).unwrap();
        assert!(estimated);
        assert!((amount - 0.0007125).abs() < 1e-12);
        p.endpoint = "https://another.example/v1".into();
        assert_eq!(cost(&p, &usage), None);
    }
}
