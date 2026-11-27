//! Standard text-token rates from the providers' public pricing documents.

use super::client;
use chrono::{DateTime, NaiveDate, Utc};
use std::{
    collections::HashMap,
    time::{Duration, Instant, SystemTime},
};
use tokio::sync::Mutex;

#[derive(Clone, Copy)]
pub(super) enum Source {
    OpenAi,
    Anthropic,
    Gemini,
}

#[derive(Clone, Copy)]
pub(super) struct Rates {
    pub input: f64,
    pub output: f64,
    pub read: Option<f64>,
    pub short_write: Option<f64>,
    pub long_write: Option<f64>,
}

#[derive(Clone, Copy)]
struct ModelRates {
    standard: Rates,
    extended: Option<(u64, Rates)>,
}

type Catalog = HashMap<String, ModelRates>;

struct CachedCatalog {
    until: Instant,
    rates: Catalog,
}

impl Source {
    fn url(self) -> &'static str {
        match self {
            Self::OpenAi => "https://developers.openai.com/api/docs/pricing.md",
            Self::Anthropic => "https://platform.claude.com/docs/en/about-claude/pricing.md",
            Self::Gemini => "https://aistudio.google.com/docs/pricing.md",
        }
    }

    fn cache(self) -> &'static Mutex<Option<CachedCatalog>> {
        static OPENAI: Mutex<Option<CachedCatalog>> = Mutex::const_new(None);
        static ANTHROPIC: Mutex<Option<CachedCatalog>> = Mutex::const_new(None);
        static GEMINI: Mutex<Option<CachedCatalog>> = Mutex::const_new(None);
        match self {
            Self::OpenAi => &OPENAI,
            Self::Anthropic => &ANTHROPIC,
            Self::Gemini => &GEMINI,
        }
    }

    async fn load(self) -> Option<Catalog> {
        let mut response = client()
            .ok()?
            .get(self.url())
            .timeout(Duration::from_secs(3))
            .send()
            .await
            .ok()?
            .error_for_status()
            .ok()?;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.ok()? {
            if bytes.len() + chunk.len() > 1024 * 1024 {
                return None;
            }
            bytes.extend_from_slice(&chunk);
        }
        let doc = std::str::from_utf8(&bytes).ok()?;
        let rates = match self {
            Self::OpenAi => openai(doc),
            Self::Anthropic => anthropic(doc),
            Self::Gemini => gemini(doc, DateTime::<Utc>::from(SystemTime::now()).date_naive()),
        };
        (!rates.is_empty()).then_some(rates)
    }

    async fn with_catalog<T>(self, read: impl FnOnce(&Catalog) -> T) -> T {
        let mut cache = self.cache().lock().await;
        if cache
            .as_ref()
            .is_none_or(|cached| Instant::now() >= cached.until)
        {
            let loaded = self.load().await;
            let ttl = if loaded.is_some() { 3600 } else { 60 };
            *cache = Some(CachedCatalog {
                until: Instant::now() + Duration::from_secs(ttl),
                rates: loaded.unwrap_or_default(),
            });
        }
        read(&cache.as_ref().expect("catalog initialized").rates)
    }

    pub(super) async fn prefetch(self) {
        self.with_catalog(|_| ()).await;
    }

    pub(super) async fn rates(self, model: &str, input: u64) -> Option<Rates> {
        self.with_catalog(|catalog| {
            let model = match self {
                Self::OpenAi if model == "gpt-5.4-2026-03-05" => "gpt-5.4",
                Self::Anthropic => model
                    .rsplit_once('-')
                    .filter(|(_, date)| date.len() == 8 && date.bytes().all(|c| c.is_ascii_digit()))
                    .map_or(model, |(name, _)| name),
                Self::Gemini => model.strip_prefix("models/").unwrap_or(model),
                _ => model,
            };
            let rates = catalog.get(model)?;
            Some(match rates.extended {
                Some((threshold, extended)) if input > threshold => extended,
                _ => rates.standard,
            })
        })
        .await
    }
}

fn usd(cell: &str) -> Option<f64> {
    let number = cell
        .trim()
        .strip_prefix('$')?
        .split(|c: char| !c.is_ascii_digit() && c != '.' && c != ',')
        .next()?;
    let price = number.replace(',', "").parse::<f64>().ok()?;
    (price.is_finite() && price >= 0.0).then_some(price)
}

fn markdown_rows(section: &str) -> impl Iterator<Item = Vec<&str>> {
    section.lines().filter_map(|line| {
        let row = line.trim().strip_prefix('|')?.strip_suffix('|')?;
        Some(row.split('|').map(str::trim).collect())
    })
}

fn openai(doc: &str) -> Catalog {
    let Some((_, section)) = doc.split_once("### Standard pricing data\n") else {
        return Catalog::new();
    };
    let section = section.split("\n### ").next().unwrap_or_default();
    const FLAT_HEADER: &[&str] = &["Model", "Input", "Output", "Cached input"];
    const CONTEXT_HEADER: &[&str] = &[
        "Model",
        "Short context input",
        "Short context output",
        "Short context cached input",
        "Short context 30m write",
        "Short context 12h write",
        "Long context input",
        "Long context output",
        "Long context cached input",
        "Long context 30m write",
        "Long context 12h write",
    ];
    let mut table_width = 0;
    markdown_rows(section)
        .filter_map(|cells| {
            if cells.first() == Some(&"Model") {
                let header = cells.as_slice();
                table_width = if header == FLAT_HEADER || header == CONTEXT_HEADER {
                    cells.len()
                } else {
                    0
                };
                return None;
            }
            if cells.len() != table_width {
                return None;
            }
            let model = cells.first()?.split_whitespace().next()?;
            let read_rate = |index: usize| {
                Some(Rates {
                    input: usd(cells.get(index).copied()?)?,
                    output: usd(cells.get(index + 1).copied()?)?,
                    read: cells.get(index + 2).copied().and_then(usd),
                    short_write: cells.get(index + 3).copied().and_then(usd),
                    long_write: cells.get(index + 4).copied().and_then(usd),
                })
            };
            let extended = if table_width == 11 {
                // The pricing page defines long context as more than 272K input tokens.
                Some((272_000, read_rate(6)?))
            } else {
                None
            };
            Some((
                model.to_owned(),
                ModelRates {
                    standard: read_rate(1)?,
                    extended,
                },
            ))
        })
        .collect()
}

fn anthropic(doc: &str) -> Catalog {
    let section = doc
        .split_once("## Model pricing\n")
        .map_or("", |(_, rest)| rest);
    let section = section.split("\n## ").next().unwrap_or_default();
    const HEADER: &[&str] = &[
        "Model",
        "Base input tokens",
        "5m cache writes",
        "1h cache writes",
        "Cache hits and refreshes",
        "Output tokens",
    ];
    let mut rows = markdown_rows(section);
    if rows.next().as_deref() != Some(HEADER) {
        return Catalog::new();
    }
    let mut catalog = Catalog::new();
    let mut extended = Vec::new();
    for cells in rows {
        let [model, input, short, long, read, output] = cells.as_slice() else {
            continue;
        };
        let (Some(input), Some(output), Some(read), Some(short), Some(long)) =
            (usd(input), usd(output), usd(read), usd(short), usd(long))
        else {
            continue;
        };
        let name = model
            .split(" (")
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase()
            .replace([' ', '.'], "-");
        let rates = Rates {
            input,
            output,
            read: Some(read),
            short_write: Some(short),
            long_write: Some(long),
        };
        if let Some(threshold) = model
            .split_once("(for prompts over ")
            .and_then(|(_, text)| {
                text.split_whitespace()
                    .next()?
                    .replace(',', "")
                    .parse()
                    .ok()
            })
        {
            extended.push((name, threshold, rates));
        } else {
            catalog.insert(
                name,
                ModelRates {
                    standard: rates,
                    extended: None,
                },
            );
        }
    }
    for (name, threshold, rates) in extended {
        if let Some(model) = catalog.get_mut(&name) {
            model.extended = Some((threshold, rates));
        }
    }
    catalog
}

fn gemini(doc: &str, today: NaiveDate) -> Catalog {
    doc.split("\n## ")
        .filter_map(|section| {
            let (_, heading) = section.lines().next()?.split_once("id=\"gemini-")?;
            let (suffix, _) = heading.split_once('"')?;
            let (_, standard) = section.split_once("{% tab title=\"Standard\" %}")?;
            let (table, _) = standard.split_once("{% /table %}")?;
            let rate = |label: &str| {
                let row = table
                    .split("\n  ---")
                    .find_map(|row| row.split_once(label).map(|(_, values)| values))?;
                // The third cell is the paid token price. Accept a single flat price
                // or a dated change. Multimodal and context-tier prices need more usage data.
                let price = row.split("\n  * ").nth(2)?.trim();
                let current = usd(price)?;
                if let Some((_, after)) = price.split_once(" through ") {
                    let date = NaiveDate::parse_from_str(
                        after.lines().next()?.trim().trim_end_matches('.'),
                        "%B %d, %Y",
                    )
                    .ok()?;
                    let next = after.lines().nth(1)?.trim();
                    return if today <= date {
                        Some(current)
                    } else {
                        usd(next.split_once(" starting ")?.0)
                    };
                }
                let line = price.lines().next()?;
                let amount = line.strip_prefix('$')?.trim();
                amount.parse::<f64>().ok().filter(|value| *value == current)
            };
            let standard = Rates {
                input: rate("* Input price")?,
                output: rate("* Output price")?,
                read: rate("* Context caching price"),
                short_write: None,
                long_write: None,
            };
            Some((
                format!("gemini-{suffix}"),
                ModelRates {
                    standard,
                    extended: None,
                },
            ))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_standard_openai_prices_without_using_batch_rates() {
        let doc = r#"
### Standard pricing data
| Model | Short context input | Short context output | Short context cached input | Short context 30m write | Short context 12h write | Long context input | Long context output | Long context cached input | Long context 30m write | Long context 12h write |
| example (<272K context length) | $2 | $10 | $0.10 | $2.50 | $5 | $4 | $15 | $0.20 | $5 | $10 |

| Model | Input | Output | Cached input |
| other | $1 | $6 | - |

### Batch pricing data
| example | $1 | $5 | $0.05 |
"#;
        let catalog = openai(doc);
        assert_eq!(catalog["example"].standard.input, 2.0);
        assert_eq!(catalog["example"].extended.unwrap().1.output, 15.0);
        assert_eq!(catalog["other"].standard.read, None);
    }

    #[test]
    fn reads_anthropic_cache_rates_and_context_tiers() {
        let doc = r#"
## Model pricing
| Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens |
| Claude Example 5.5 (for prompts up to 100,000 tokens) | $0.10 / MTok | $0.125 / MTok | $0.20 / MTok | $0.01 / MTok | $0.50 / MTok |
| Claude Example 5.5 (for prompts over 100,000 tokens) | $0.50 / MTok | $0.625 / MTok | $1 / MTok | $0.05 / MTok | $2.50 / MTok |
"#;
        let catalog = anthropic(doc);
        let example = catalog["claude-example-5-5"];
        assert_eq!(example.standard.short_write, Some(0.125));
        let (threshold, extended) = example.extended.unwrap();
        assert_eq!(threshold, 100_000);
        assert_eq!(extended.read, Some(0.05));
    }

    #[test]
    fn gemini_changes_rates_on_the_published_date() {
        let doc = r#"
## Gemini Example {% id="gemini-example" %}
  {% tab title="Standard" %}
  {% table %}
  * Feature
  * Free Tier
  * Paid Tier, per 1M tokens in USD

  ---

  * Input price
  * Free of charge
  * $0.75 through December 31, 2026.
  $1.50 starting January 1, 2027.

  ---

  * Output price (including thinking tokens)
  * Free of charge
  * $3.75 through December 31, 2026.
  $7.50 starting January 1, 2027.

  ---

  * Context caching price
  * Free of charge
  * $0.075 through December 31, 2026.
  $0.15 starting January 1, 2027.
  $0.50 / 1,000,000 tokens per hour (storage price)

  {% /table %}
"#;
        let before = gemini(doc, NaiveDate::from_ymd_opt(2026, 12, 31).unwrap());
        let after = gemini(doc, NaiveDate::from_ymd_opt(2027, 1, 1).unwrap());
        assert_eq!(before["gemini-example"].standard.input, 0.75);
        assert_eq!(after["gemini-example"].standard.read, Some(0.15));
    }
}
