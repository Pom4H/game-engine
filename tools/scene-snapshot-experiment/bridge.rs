//! Editor-only bridge. The production World compiler remains the authority.
#[path = "../../compiler/src/lib.rs"]
mod worldc;

use std::io::{self, Read};
use std::time::Instant;

fn json_string(value: &str) -> String {
    let mut output = String::from("\"");
    for ch in value.chars() {
        match ch {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            ch if ch < '\u{20}' => output.push_str(&format!("\\u{:04x}", ch as u32)),
            ch => output.push(ch),
        }
    }
    output.push('"');
    output
}

fn main() {
    // Build-time source identity detects a stale executable after Rust edits.
    // This is a freshness check, not a cryptographic trust boundary.
    let fingerprint = include_bytes!("../../compiler/src/lib.rs").iter().fold(
        0xcbf29ce484222325u64, |value, byte| (value ^ u64::from(*byte)).wrapping_mul(0x100000001b3),
    );
    let identity = format!("{fingerprint:016x}");
    let mut source = String::new();
    io::stdin().read_to_string(&mut source).expect("UTF-8 source on stdin");
    let repeat: usize = std::env::args().nth(1).map(|s| s.parse().expect("repeat count")).unwrap_or(1);
    assert!((1..=1000).contains(&repeat));
    let mut timings = Vec::with_capacity(repeat);
    let mut last = None;
    for _ in 0..repeat {
        let start = Instant::now();
        let result = worldc::compile(&source);
        timings.push(start.elapsed().as_nanos());
        last = Some(result);
    }
    let timing_json = timings.iter().map(u128::to_string).collect::<Vec<_>>().join(",");
    match last.unwrap() {
        Ok(bytes) => {
            let hex = bytes.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
            println!("{{\"ok\":true,\"compilerFingerprint\":\"{identity}\",\"bytesHex\":\"{hex}\",\"compileNanos\":[{timing_json}]}}");
        }
        Err(error) => println!(
            "{{\"ok\":false,\"compilerFingerprint\":\"{}\",\"at\":{},\"message\":{},\"located\":{},\"compileNanos\":[{}]}}",
            identity, error.at, json_string(&error.message), json_string(&error.located(&source)), timing_json,
        ),
    }
}
