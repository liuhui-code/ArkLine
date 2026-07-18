fn main() {
    if let Err(error) = arkline_lib::indexer_sidecar::run_stdio() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
