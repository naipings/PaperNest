use super::*;
use crate::research_tools::{execute_mcp_tool, mcp_research_tool_names, mcp_tool_desc, react_tool_catalog};
use std::io::{BufRead, BufReader, Write};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInfo {
  pub command: String,
  pub library_path: String,
  pub tools: Vec<String>,
}

pub fn mcp_command_line(exe: &Path) -> String {
  let mcp_exe = exe.parent().map(|dir| {
    #[cfg(windows)]
    let name = "papernest-mcp.exe";
    #[cfg(not(windows))]
    let name = "papernest-mcp";
    dir.join(name)
  }).unwrap_or_else(|| exe.to_path_buf());
  format!("codex mcp add papernest -- \"{}\"", mcp_exe.display())
}

fn resolve_library_for_mcp() -> Result<PathBuf> {
  if let Ok(path) = env::var("PAPERNEST_LIBRARY") {
    let dir = PathBuf::from(path);
    if dir.join("library.db").exists() {
      return Ok(dir);
    }
    return Err(format!("PAPERNEST_LIBRARY 下没有 library.db：{}", dir.display()));
  }
  let config = env::var("APPDATA")
    .map(PathBuf::from)
    .map_err(|_| "无法读取 APPDATA，请设置 PAPERNEST_LIBRARY 环境变量".to_string())?
    .join("com.papernest.app")
    .join("library-location.json");
  if let Some(path) = read_library_location(&config) {
    if library_db_exists(&path) {
      return Ok(path);
    }
  }
  Err("未找到资料库。请先启动 PaperNest，或设置 PAPERNEST_LIBRARY 指向 PaperNestLibrary 目录".into())
}

#[tauri::command]
pub async fn mcp_get_info(state: State<'_, AppState>) -> Result<McpInfo> {
  let exe = env::current_exe().map_err(err)?;
  Ok(McpInfo {
    command: mcp_command_line(&exe),
    library_path: state.library_dir.to_string_lossy().into_owned(),
    tools: mcp_research_tool_names()
      .into_iter()
      .map(str::to_string)
      .collect(),
  })
}

pub fn run_stdio() -> Result<()> {
  let library_dir = resolve_library_for_mcp()?;
  let runtime = tokio::runtime::Builder::new_current_thread()
    .enable_all()
    .build()
    .map_err(err)?;
  let stdin = BufReader::new(std::io::stdin());
  let mut stdout = std::io::stdout();
  for line in stdin.lines() {
    let line = line.map_err(err)?;
    if line.trim().is_empty() {
      continue;
    }
    let request: serde_json::Value = serde_json::from_str(&line).map_err(err)?;
    let id = request.get("id").cloned().unwrap_or(serde_json::Value::Null);
    let method = request.get("method").and_then(|v| v.as_str()).unwrap_or("");
    let result = runtime.block_on(handle_mcp_request(&library_dir, method, request.get("params")));
    let response = serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": result });
    writeln!(stdout, "{}", response).map_err(err)?;
    stdout.flush().map_err(err)?;
  }
  Ok(())
}

async fn handle_mcp_request(
  library_dir: &Path,
  method: &str,
  params: Option<&serde_json::Value>,
) -> serde_json::Value {
  match method {
    "initialize" => serde_json::json!({
      "protocolVersion": "2024-11-05",
      "capabilities": { "tools": {} },
      "serverInfo": { "name": "papernest", "version": "0.2.15" }
    }),
    "tools/list" => {
      let mut tools: Vec<serde_json::Value> = react_tool_catalog(true)
        .into_iter()
        .map(|spec| mcp_tool_desc(&spec))
        .collect();
      tools.push(mcp_tool_desc(&crate::research_tools::ToolSpec {
        name: "list_research_sessions",
        description: "列出文献调研任务",
        parameters: serde_json::json!({ "type": "object", "properties": {} }),
      }));
      tools.push(mcp_tool_desc(&crate::research_tools::ToolSpec {
        name: "get_research_report",
        description: "读取调研 report.md",
        parameters: serde_json::json!({
          "type": "object",
          "properties": { "sessionId": { "type": "string" } },
          "required": ["sessionId"]
        }),
      }));
      serde_json::json!({ "tools": tools })
    }
    "tools/call" => {
      let name = params
        .and_then(|p| p.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
      let args = params
        .and_then(|p| p.get("arguments"))
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
      match execute_mcp_tool(library_dir, name, &args).await {
        Ok(text) => serde_json::json!({
          "content": [{ "type": "text", "text": text }],
          "isError": false
        }),
        Err(error) => serde_json::json!({
          "content": [{ "type": "text", "text": error }],
          "isError": true
        }),
      }
    }
    _ => serde_json::json!({}),
  }
}
