// 发布版使用 Windows GUI 子系统，避免弹出黑色命令行窗口；调试版仍保留控制台便于看日志。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  paper_reader_lib::run();
}
