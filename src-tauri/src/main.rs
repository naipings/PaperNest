// 安装包走 GUI 子系统，不弹出命令行。tauri dev 带 cfg(dev)，仍保留控制台。
#![cfg_attr(not(dev), windows_subsystem = "windows")]

fn main() {
  paper_reader_lib::run();
}
