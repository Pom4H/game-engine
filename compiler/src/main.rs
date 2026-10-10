use std::env;
use std::fs;
use std::path::PathBuf;

fn usage() -> &'static str {
    "Usage: worldc compile <input.world> [-o output.wscn]\n       worldc check <input.world>"
}
fn run() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let command = args.next().ok_or_else(|| usage().to_string())?;
    if command != "compile" && command != "check" {
        return Err(usage().to_string());
    }
    let input = PathBuf::from(args.next().ok_or_else(|| usage().to_string())?);
    let mut output = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "-o" | "--output" if command == "compile" && output.is_none() => {
                output = Some(PathBuf::from(args.next().ok_or_else(|| usage().to_string())?));
            }
            _ => return Err(format!("unknown argument {arg}\n{}", usage())),
        }
    }
    let source = fs::read_to_string(&input)
        .map_err(|err| format!("{}: {err}", input.display()))?;
    let bytes = worldc::compile(&source)
        .map_err(|err| format!("{}:{}", input.display(), err.located(&source)))?;
    if command == "compile" {
        let output = output.unwrap_or_else(|| input.with_extension("wscn"));
        fs::write(&output, &bytes).map_err(|err| format!("{}: {err}", output.display()))?;
        println!("{} ({} bytes)", output.display(), bytes.len());
    } else {
        println!("{}: valid World scene", input.display());
    }
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
