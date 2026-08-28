fn main() {
  if let Err(error) = paper_reader_lib::mcp_server::run_stdio() {
    eprintln!("{error}");
    std::process::exit(1);
  }
}
