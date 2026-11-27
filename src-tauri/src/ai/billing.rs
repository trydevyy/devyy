//! Billing data for the configured inference connection.

use super::{
    pricing::{Rates, Source},
    *,
};

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

pub(super) fn record_pricing_context(usage: &mut Value, event: &Value) {
    if let Some(model) = event
        .pointer("/response/model")
        .or_else(|| event.pointer("/message/model"))
        .or_else(|| event.get("model"))
        .and_then(Value::as_str)
    {
        usage["_billing_model"] = json!(model);
    }
    if event
        .pointer("/message/inference_geo")
        .or_else(|| event.get("inference_geo"))
        .and_then(Value::as_str)
        .is_some_and(|geo| geo != "global")
    {
        usage["_nonstandard"] = json!(true);
    }
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

pub(super) fn pricing_source(p: &Provider) -> Option<Source> {
    match p.kind.as_str() {
        "chatgpt" => Some(Source::OpenAi),
        "openai" if official_endpoint(p, "api.openai.com", "/v1") => Some(Source::OpenAi),
        "anthropic" if official_endpoint(p, "api.anthropic.com", "/v1") => Some(Source::Anthropic),
        "antigravity" => Some(Source::Gemini),
        _ => None,
    }
}

fn metered(tokens: u64, rate: Option<f64>) -> Option<f64> {
    if tokens == 0 {
        Some(0.0)
    } else {
        Some(tokens as f64 * rate?)
    }
}

struct Meter {
    input: u64,
    output: u64,
    read: u64,
    short_write: u64,
    long_write: u64,
}

impl Meter {
    fn prompt_tokens(&self) -> u64 {
        self.input
            .saturating_add(self.read)
            .saturating_add(self.short_write)
            .saturating_add(self.long_write)
    }

    fn estimate(&self, rate: Rates) -> Option<f64> {
        Some(
            (self.input as f64 * rate.input
                + self.output as f64 * rate.output
                + metered(self.read, rate.read)?
                + metered(self.short_write, rate.short_write)?
                + metered(self.long_write, rate.long_write)?)
                / 1_000_000.0,
        )
    }
}

fn token_meter(source: Source, usage: &Value) -> Option<Meter> {
    let input = usage["input_tokens"]
        .as_u64()
        .or_else(|| usage["prompt_tokens"].as_u64())?;
    let output = usage["output_tokens"]
        .as_u64()
        .or_else(|| usage["completion_tokens"].as_u64())?;
    let count = |value: &Value| value.as_u64().unwrap_or_default();
    match source {
        Source::OpenAi => {
            let details = usage
                .get("input_tokens_details")
                .or_else(|| usage.get("prompt_tokens_details"))
                .unwrap_or(&Value::Null);
            let read = count(&details["cached_tokens"]);
            let writes = &details["cache_write_tokens_details"];
            let short_write = count(&writes["ttl_30m_tokens"]);
            let long_write = count(&writes["ttl_12h_tokens"]);
            if count(&details["cache_write_tokens"]) > short_write.checked_add(long_write)?
                || count(&details["audio_tokens"]) > 0
                || count(&details["image_tokens"]) > 0
                || usage
                    .pointer("/completion_tokens_details/audio_tokens")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
                    > 0
            {
                return None;
            }
            Some(Meter {
                input: input
                    .checked_sub(read)?
                    .checked_sub(short_write)?
                    .checked_sub(long_write)?,
                output,
                read,
                short_write,
                long_write,
            })
        }
        Source::Anthropic => {
            let read = count(&usage["cache_read_input_tokens"]);
            let writes = count(&usage["cache_creation_input_tokens"]);
            let long_write = count(&usage["cache_creation"]["ephemeral_1h_input_tokens"]);
            Some(Meter {
                input,
                output,
                read,
                short_write: writes.checked_sub(long_write)?,
                long_write,
            })
        }
        Source::Gemini => {
            let read = usage["cache_read_tokens"].as_u64()?;
            Some(Meter {
                input: input.checked_sub(read)?,
                output: antigravity_output(usage)?,
                read,
                short_write: 0,
                long_write: 0,
            })
        }
    }
}

pub(super) async fn cost(p: &Provider, usage: &Value) -> Option<(f64, bool)> {
    if is_openrouter(p) {
        let amount = usage["cost"].as_f64()?;
        return (amount.is_finite() && amount >= 0.0).then_some((amount, false));
    }
    if usage["_nonstandard"] == true {
        return None;
    }
    let source = pricing_source(p)?;
    let mut model = usage["_billing_model"]
        .as_str()
        .or_else(|| usage["model"].as_str())
        .unwrap_or(&p.model)
        .trim();
    if matches!(source, Source::Gemini) {
        model = ["-minimal", "-low", "-medium", "-high", "-xhigh", "-max"]
            .iter()
            .find_map(|suffix| model.strip_suffix(suffix))
            .unwrap_or(model);
    }
    let tokens = token_meter(source, usage)?;
    let rates = source.rates(model, tokens.prompt_tokens()).await?;
    Some((tokens.estimate(rates)?, true))
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
    fn gemini_reasoning_is_counted_once() {
        let usage = json!({"input_tokens":1000,"cache_read_tokens":600,"output_tokens":200,
            "thinking_tokens":100,"total_tokens":1200});
        let meter = token_meter(Source::Gemini, &usage).unwrap();
        assert_eq!((meter.input, meter.read, meter.output), (400, 600, 200));
    }

    #[test]
    fn cache_writes_are_billed_once_at_the_correct_rate() {
        let usage = json!({"input_tokens":100,"output_tokens":20,
            "input_tokens_details":{"cached_tokens":50,"cache_write_tokens":20,
                "cache_write_tokens_details":{"ttl_30m_tokens":10,"ttl_12h_tokens":10}}});
        let rates = Rates {
            input: 4.0,
            output: 20.0,
            read: Some(0.2),
            short_write: Some(5.0),
            long_write: Some(10.0),
        };
        let meter = token_meter(Source::OpenAi, &usage).unwrap();
        assert_eq!(meter.prompt_tokens(), 100);
        assert!((meter.estimate(rates).unwrap() - 0.00068).abs() < 1e-12);

        let usage = json!({"input_tokens":100,"output_tokens":20,"cache_read_input_tokens":50,
            "cache_creation_input_tokens":20,"cache_creation":{"ephemeral_1h_input_tokens":10}});
        let rates = Rates {
            input: 3.0,
            output: 15.0,
            read: Some(0.3),
            short_write: Some(3.75),
            long_write: Some(6.0),
        };
        let meter = token_meter(Source::Anthropic, &usage).unwrap();
        assert!((meter.estimate(rates).unwrap() - 0.0007125).abs() < 1e-12);
    }

    #[test]
    fn first_party_prices_do_not_apply_to_other_endpoints() {
        let mut p = defaults()
            .into_iter()
            .find(|p| p.kind == "anthropic")
            .unwrap();
        p.endpoint = "https://another.example/v1".into();
        assert!(pricing_source(&p).is_none());
    }
}
