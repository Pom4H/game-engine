//! A bounded experimental dialect in the existing worldc crate, not a second scene compiler.
//! No dependencies, floating-point quantities, implicit defaults or runtime source parsing.
use std::{collections::BTreeMap, env, fs, io::Read, process};
const LIMIT: u64 = 1_000_000_000_000_000;
const SCALE: u128 = 1_000_000;
#[derive(Debug, Clone, PartialEq, Eq)]
struct Contract {
    id: String, capacity: u64, observed: u64, error: u64, source: String,
    at: u64, flow: u64, delay: u64, target: u64, within: u64,
}
fn identity(value: &str) -> Result<String, String> {
    let b = value.as_bytes();
    if b.is_empty() || b.len() > 80 || !(b[0].is_ascii_alphabetic() || b[0] == b'_') ||
        !b.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'_' || *c == b'-') {
        return Err("expected bounded ASCII identity".into());
    }
    Ok(value.into())
}
fn quantity(text: &str, dimension: &str) -> Result<u64, String> {
    let parts: Vec<_> = text.split_whitespace().collect();
    if parts.len() != 2 { return Err("expected NUMBER UNIT with explicit dimension".into()); }
    let factor: u128 = match (dimension, parts[1]) {
        ("volume", "L" | "л") | ("flow", "L/s" | "л/с") | ("time", "s" | "с") => 1_000_000,
        ("volume", "mL" | "мл") | ("flow", "mL/s" | "мл/с") | ("time", "ms" | "мс") => 1_000,
        ("volume", "m3") | ("flow", "m3/s") => 1_000_000_000,
        ("time", "us") => 1,
        _ => return Err(format!("invalid {} unit: {}", dimension, parts[1])),
    };
    let number: Vec<_> = parts[0].split('.').collect();
    if number.len() > 2 || number[0].is_empty() || number[0].len() > 16 ||
        !number[0].bytes().all(|c| c.is_ascii_digit()) {
        return Err("expected unsigned decimal, no exponent or sign".into());
    }
    let fraction = number.get(1).copied().unwrap_or("");
    if fraction.len() > 6 || (number.len() == 2 && fraction.is_empty()) || !fraction.bytes().all(|c| c.is_ascii_digit()) {
        return Err("at most six decimal places are supported".into());
    }
    let denominator = 10u128.pow(fraction.len() as u32);
    let whole: u128 = number[0].parse().map_err(|_| "invalid number")?;
    let frac: u128 = if fraction.is_empty() { 0 } else { fraction.parse().map_err(|_| "invalid fraction")? };
    let numerator = (whole * denominator + frac) * factor;
    if numerator % denominator != 0 { return Err("quantity is below the exact micro-unit resolution".into()); }
    let value = numerator / denominator;
    if value > LIMIT as u128 { return Err("quantity exceeds dialect bound".into()); }
    Ok(value as u64)
}
fn parse(input: &str) -> Result<Contract, String> {
    if input.len() > 65_536 { return Err("source exceeds 64 KiB".into()); }
    let lines: Vec<_> = input.lines().enumerate().map(|(i, s)| (i + 1, s.split('#').next().unwrap_or("").trim()))
        .filter(|(_, s)| !s.is_empty()).collect();
    let (_, header) = lines.first().ok_or("empty contract")?;
    let words: Vec<_> = header.split_whitespace().collect();
    if words.len() != 3 || !["contract", "контракт"].contains(&words[0]) || words[2] != "{" {
        return Err("line 1: expected contract ID {".into());
    }
    let id = identity(words[1])?;
    if lines.last().map(|(_, s)| *s) != Some("}") { return Err("missing closing brace".into()); }
    let mut fields = BTreeMap::new();
    for (line, text) in &lines[1..lines.len() - 1] {
        let (key, value) = text.split_once(':').ok_or_else(|| format!("line {line}: expected key: value"))?;
        let key = match key.trim() {
            "capacity" | "ёмкость" => "capacity", "observed" | "измерено" => "observed",
            "error" | "погрешность" => "error", "source" | "источник" => "source",
            "at" | "момент" => "at", "flow" | "расход" => "flow",
            "start_delay" | "задержка_пуска" => "start_delay", "goal" | "цель" => "goal",
            "law" | "закон" => "law",
            unknown => return Err(format!("line {line}: unknown field {unknown}")),
        };
        if fields.insert(key, (*line, value.trim())).is_some() { return Err(format!("line {line}: duplicate field {key}")); }
    }
    let field = |name: &str| -> Result<(usize, &str), String> { fields.get(name).copied().ok_or_else(|| format!("missing field {name}")) };
    let q = |name: &str, dimension: &str| -> Result<u64, String> {
        let (line, text) = field(name)?;
        quantity(text, dimension).map_err(|e| format!("line {line}: {name}: {e}"))
    };
    let (line, goal) = field("goal")?;
    let words: Vec<_> = goal.split_whitespace().collect();
    if words.len() != 6 || !["reach", "достичь"].contains(&words[0]) || !["within", "за"].contains(&words[3]) {
        return Err(format!("line {line}: only 'reach V UNIT within T UNIT' is defined; no implicit interpretation"));
    }
    if field("law")?.1 != "constant-inflow-no-outflow" { return Err("unsupported law; assumptions must be explicit".into()); }
    let c = Contract {
        id, capacity: q("capacity", "volume")?, observed: q("observed", "volume")?, error: q("error", "volume")?,
        source: identity(field("source")?.1)?, at: q("at", "time")?, flow: q("flow", "flow")?, delay: q("start_delay", "time")?,
        target: quantity(&format!("{} {}", words[1], words[2]), "volume").map_err(|e| format!("line {line}: goal: {e}"))?,
        within: quantity(&format!("{} {}", words[4], words[5]), "time").map_err(|e| format!("line {line}: goal: {e}"))?,
    };
    if c.capacity == 0 || c.error > c.observed || c.observed + c.error > c.capacity ||
        c.target > c.capacity || c.flow == 0 || c.within == 0 { return Err("inconsistent bounds, flow or deadline".into()); }
    Ok(c)
}
impl Contract {
    fn json(&self) -> String {
        format!(concat!("{{\"schema\":\"world-contract/tank-affine@1\",\"id\":\"{}\",\"capacityUl\":\"{}\",",
            "\"observation\":{{\"volumeUl\":\"{}\",\"errorUl\":\"{}\",\"atUs\":\"{}\",\"source\":\"{}\"}},",
            "\"assumptions\":{{\"law\":\"constant-inflow-no-outflow\",\"flowUlPerSecond\":\"{}\",\"startDelayUs\":\"{}\"}},",
            "\"goal\":{{\"kind\":\"reach\",\"volumeUl\":\"{}\",\"withinUs\":\"{}\"}}}}"),
            self.id, self.capacity, self.observed, self.error, self.at, self.source, self.flow, self.delay, self.target, self.within)
    }
    // Independent closed-form reference: no EngineKernel, integration loop or TS-generated code.
    fn oracle(&self, elapsed: u64) -> String {
        let active = elapsed.saturating_sub(self.delay) as u128;
        let added = self.flow as u128 * active;
        let lower = self.observed - self.error;
        let guaranteed = if self.target <= lower { 0 } else {
            let missing = (self.target - lower) as u128 * SCALE;
            self.delay as u128 + (missing + self.flow as u128 - 1) / self.flow as u128
        } + self.at as u128;
        format!("{{\"timeUs\":\"{}\",\"lowerPl\":\"{}\",\"nominalPl\":\"{}\",\"upperPl\":\"{}\",\"guaranteedAtUs\":\"{}\"}}",
            self.at as u128 + elapsed as u128, lower as u128 * SCALE + added,
            self.observed as u128 * SCALE + added, (self.observed + self.error) as u128 * SCALE + added, guaranteed)
    }
}
fn run(args: &[String]) -> Result<(), String> {
    let (oracle, path, elapsed) = match args {
        [path] => (false, path, 0),
        [flag, path, time] if flag == "--oracle" => {
            let elapsed: u64 = time.parse().map_err(|_| "oracle time must be unsigned integer microseconds")?;
            if elapsed > LIMIT { return Err("oracle time exceeds dialect bound".into()); }
            (true, path, elapsed)
        },
        _ => return Err("usage: world-contract FILE | --oracle FILE ELAPSED_US".into()),
    };
    let mut bytes = Vec::new();
    fs::File::open(path).and_then(|file| file.take(65_537).read_to_end(&mut bytes)).map_err(|e| format!("{path}: {e}"))?;
    if bytes.len() > 65_536 { return Err("source exceeds 64 KiB".into()); }
    let source = std::str::from_utf8(&bytes).map_err(|_| "source is not UTF-8")?;
    let c = parse(source)?;
    println!("{}", if oracle { c.oracle(elapsed) } else { c.json() });
    Ok(())
}
fn main() { if let Err(e) = run(&env::args().skip(1).collect::<Vec<_>>()) { eprintln!("{e}"); process::exit(2); } }

#[cfg(test)]
mod tests {
    use super::*;
    const SOURCE: &str = include_str!("../../examples/world-contracts/tank-en.wcontract");
    #[test] fn translations_are_identical() { assert_eq!(parse(SOURCE).unwrap(), parse(include_str!("../../examples/world-contracts/tank-ru.wcontract")).unwrap()); }
    #[test] fn units_are_exact() { assert_eq!(quantity("0.07 m3", "volume").unwrap(), 70_000_000); assert_eq!(quantity("5000 mL/s", "flow").unwrap(), 5_000_000); }
    #[test] fn dimensions_do_not_coerce() { assert!(parse(&SOURCE.replace("flow: 5 L/s", "flow: 5 L")).is_err()); }
    #[test] fn unknown_and_duplicate_fields_fail() { for line in ["mystery: 1", "capacity: 200 L"] { assert!(parse(&SOURCE.replace("\n}", &format!("\n{line}\n}}"))).is_err()); } }
    #[test] fn no_defaults() { assert!(parse(&SOURCE.replace("start_delay: 0 s\n", "")).is_err()); }
    #[test] fn no_guessing_modalities() { for word in ["may", "not", "at", "maintain"] { assert!(parse(&SOURCE.replace("reach", word)).is_err()); } }
    #[test] fn impossible_bounds_fail() { assert!(parse(&SOURCE.replace("error: 1 L", "error: 80 L")).is_err()); }
    #[test] fn exact_resolution_is_enforced() { for number in ["-1 L", "NaN L", "1e3 L", "0.000001 mL", "1000000000000000 L"] { assert!(quantity(number, "volume").is_err()); } }
    #[test] fn uncertainty_is_not_nominal_truth() { assert!(parse(SOURCE).unwrap().oracle(10_000_000).contains("\"lowerPl\":\"119000000000000\"")); assert!(parse(SOURCE).unwrap().oracle(0).contains("\"guaranteedAtUs\":\"10200000\"")); }
    #[test] fn malformed_source_is_rejected() { for text in ["", "contract X", "contract X {\n}", "contract X {\n}\n}"] { assert!(parse(text).is_err()); } }
}
