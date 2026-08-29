use super::*;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use std::io::Write;

/// 单条附件在磁盘上的落地形态。图片保留原始字节供多模态调用，文档只保留前端提取出的纯文本。
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ResearchAttachment {
  pub name: String,
  pub kind: String,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub mime: Option<String>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub path: Option<String>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub url: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ResearchTurn {
  pub turn: i64,
  pub question: String,
  #[serde(default)]
  pub attachments: Vec<ResearchAttachment>,
  pub answer_path: String,
  pub status: String,
  pub created_at: String,
  pub updated_at: String,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub error: Option<String>,
}

/// 前端提交的附件：文本类已在前端提取完成，图片类走 base64，链接只带 URL。
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInput {
  pub name: String,
  pub kind: String,
  pub mime: Option<String>,
  pub text: Option<String>,
  pub data_base64: Option<String>,
  pub url: Option<String>,
}

const MAX_ATTACHMENT_CHARS: usize = 8000;

fn turns_path(workspace: &Path) -> PathBuf {
  workspace.join("turns.jsonl")
}

pub fn read_turns(workspace: &Path) -> Result<Vec<ResearchTurn>> {
  let path = turns_path(workspace);
  if !path.exists() {
    return Ok(vec![]);
  }
  let text = fs::read_to_string(path).map_err(err)?;
  let mut out = Vec::new();
  for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
    out.push(serde_json::from_str::<ResearchTurn>(line).map_err(err)?);
  }
  Ok(out)
}

pub fn append_turn(workspace: &Path, turn: &ResearchTurn) -> Result<()> {
  let mut file = fs::OpenOptions::new()
    .create(true)
    .append(true)
    .open(turns_path(workspace))
    .map_err(err)?;
  writeln!(file, "{}", serde_json::to_string(turn).map_err(err)?).map_err(err)
}

fn write_turns(workspace: &Path, turns: &[ResearchTurn]) -> Result<()> {
  let mut body = String::new();
  for turn in turns {
    body.push_str(&serde_json::to_string(turn).map_err(err)?);
    body.push('\n');
  }
  fs::write(turns_path(workspace), body).map_err(err)
}

/// 运行结束后把最后一轮标记成终态。轮次记录是 UI 展示会话流的唯一依据，状态必须跟着 session 走。
pub fn finish_last_turn(workspace: &Path, status: &str, error: Option<&str>) -> Result<()> {
  let mut turns = read_turns(workspace)?;
  let Some(last) = turns.last_mut() else { return Ok(()) };
  last.status = status.to_string();
  last.error = error.map(str::to_string);
  last.updated_at = Utc::now().to_rfc3339();
  write_turns(workspace, &turns)
}

pub fn answer_path_for(turn: i64) -> String {
  if turn <= 1 {
    "report.md".into()
  } else {
    format!("turns/{turn:03}.md")
  }
}

pub fn read_answer(workspace: &Path, answer_path: &str) -> String {
  fs::read_to_string(workspace.join(answer_path)).unwrap_or_default()
}

pub fn store_attachments(
  workspace: &Path,
  turn: i64,
  inputs: &[AttachmentInput],
) -> Result<Vec<ResearchAttachment>> {
  if inputs.is_empty() {
    return Ok(vec![]);
  }
  let dir = workspace.join("attachments");
  fs::create_dir_all(&dir).map_err(err)?;
  let mut out = Vec::new();
  for (index, input) in inputs.iter().enumerate() {
    let stem = format!("t{turn:03}-{index:02}-{}", sanitize_name(&input.name));
    let stored = match input.kind.as_str() {
      "image" => {
        let data = input
          .data_base64
          .as_deref()
          .ok_or_else(|| format!("附件「{}」缺少图片数据", input.name))?;
        let bytes = BASE64.decode(data.trim()).map_err(err)?;
        fs::write(dir.join(&stem), bytes).map_err(err)?;
        Some(format!("attachments/{stem}"))
      }
      "text" => {
        let text = input
          .text
          .as_deref()
          .ok_or_else(|| format!("附件「{}」没有可用文本", input.name))?;
        let name = format!("{stem}.txt");
        fs::write(dir.join(&name), text).map_err(err)?;
        Some(format!("attachments/{name}"))
      }
      "link" => None,
      other => return Err(format!("不支持的附件类型：{other}")),
    };
    out.push(ResearchAttachment {
      name: input.name.clone(),
      kind: input.kind.clone(),
      mime: input.mime.clone(),
      path: stored,
      url: input.url.clone(),
    });
  }
  Ok(out)
}

fn sanitize_name(name: &str) -> String {
  name
    .chars()
    .map(|c| if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
    .collect()
}

/// 附件正文与链接以纯文本形式拼进用户消息；图片另走多模态块。
pub fn attachment_text_block(workspace: &Path, attachments: &[ResearchAttachment]) -> String {
  let mut parts = Vec::new();
  for item in attachments {
    match item.kind.as_str() {
      "link" => {
        if let Some(url) = item.url.as_deref() {
          parts.push(format!("链接：{url}（需要正文时调用 fetch_url）"));
        }
      }
      "text" => {
        let body = item
          .path
          .as_deref()
          .map(|path| read_answer(workspace, path))
          .unwrap_or_default();
        let clipped: String = body.chars().take(MAX_ATTACHMENT_CHARS).collect();
        parts.push(format!("附件《{}》内容：\n{}", item.name, clipped));
      }
      "image" => parts.push(format!("附件《{}》为图片，已随本条消息发送。", item.name)),
      _ => {}
    }
  }
  if parts.is_empty() {
    String::new()
  } else {
    format!("\n\n--- 附件 ---\n{}", parts.join("\n\n"))
  }
}

/// 没有图片时保持 content 为字符串，避免给不支持多模态的模型送数组。
pub fn user_message_value(text: String, images: Vec<serde_json::Value>) -> serde_json::Value {
  if images.is_empty() {
    return serde_json::json!({ "role": "user", "content": text });
  }
  let mut blocks = vec![serde_json::json!({ "type": "text", "text": text })];
  blocks.extend(images);
  serde_json::json!({ "role": "user", "content": blocks })
}

pub fn attachment_image_blocks(
  workspace: &Path,
  attachments: &[ResearchAttachment],
) -> Result<Vec<serde_json::Value>> {
  let mut out = Vec::new();
  for item in attachments.iter().filter(|item| item.kind == "image") {
    let Some(path) = item.path.as_deref() else { continue };
    let bytes = fs::read(workspace.join(path)).map_err(err)?;
    let mime = item.mime.as_deref().unwrap_or("image/png");
    out.push(serde_json::json!({
      "type": "image_url",
      "image_url": { "url": format!("data:{};base64,{}", mime, BASE64.encode(bytes)) }
    }));
  }
  Ok(out)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("pn-turns-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  #[test]
  fn answer_paths_split_first_turn_from_followups() {
    assert_eq!(answer_path_for(1), "report.md");
    assert_eq!(answer_path_for(2), "turns/002.md");
    assert_eq!(answer_path_for(12), "turns/012.md");
  }

  #[test]
  fn turns_roundtrip_and_finish_updates_last() {
    let dir = temp_dir();
    for turn in 1..=2 {
      append_turn(
        &dir,
        &ResearchTurn {
          turn,
          question: format!("q{turn}"),
          attachments: vec![],
          answer_path: answer_path_for(turn),
          status: "running".into(),
          created_at: "t".into(),
          updated_at: "t".into(),
          error: None,
        },
      )
      .unwrap();
    }
    finish_last_turn(&dir, "completed", None).unwrap();
    let turns = read_turns(&dir).unwrap();
    assert_eq!(turns.len(), 2);
    assert_eq!(turns[0].status, "running");
    assert_eq!(turns[1].status, "completed");
    assert_eq!(turns[1].answer_path, "turns/002.md");
    let _ = fs::remove_dir_all(dir);
  }

  #[test]
  fn text_attachment_lands_on_disk_and_in_prompt() {
    let dir = temp_dir();
    let stored = store_attachments(
      &dir,
      1,
      &[AttachmentInput {
        name: "note.pdf".into(),
        kind: "text".into(),
        mime: Some("application/pdf".into()),
        text: Some("冷启动实验结论".into()),
        data_base64: None,
        url: None,
      }],
    )
    .unwrap();
    assert_eq!(stored.len(), 1);
    let block = attachment_text_block(&dir, &stored);
    assert!(block.contains("note.pdf"));
    assert!(block.contains("冷启动实验结论"));
    let _ = fs::remove_dir_all(dir);
  }

  #[test]
  fn image_attachment_becomes_data_url_block() {
    let dir = temp_dir();
    let stored = store_attachments(
      &dir,
      2,
      &[AttachmentInput {
        name: "fig.png".into(),
        kind: "image".into(),
        mime: Some("image/png".into()),
        text: None,
        data_base64: Some(BASE64.encode([1u8, 2, 3])),
        url: None,
      }],
    )
    .unwrap();
    let blocks = attachment_image_blocks(&dir, &stored).unwrap();
    assert_eq!(blocks.len(), 1);
    assert!(blocks[0]["image_url"]["url"]
      .as_str()
      .unwrap()
      .starts_with("data:image/png;base64,"));
    let _ = fs::remove_dir_all(dir);
  }

  #[test]
  fn link_attachment_only_carries_url() {
    let dir = temp_dir();
    let stored = store_attachments(
      &dir,
      1,
      &[AttachmentInput {
        name: "arxiv".into(),
        kind: "link".into(),
        mime: None,
        text: None,
        data_base64: None,
        url: Some("https://arxiv.org/abs/2601.00001".into()),
      }],
    )
    .unwrap();
    assert!(stored[0].path.is_none());
    assert!(attachment_text_block(&dir, &stored).contains("fetch_url"));
    let _ = fs::remove_dir_all(dir);
  }
}
