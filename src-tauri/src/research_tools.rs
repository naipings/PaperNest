use super::*;
use crate::research::{append_source, read_sources, ResearchSource};
use std::collections::HashSet;

#[derive(Clone, Debug)]
pub struct ToolSpec {
  pub name: &'static str,
  pub description: &'static str,
  pub parameters: serde_json::Value,
}

pub struct SourceCollector {
  sources: Vec<ResearchSource>,
  seen_urls: HashSet<String>,
  next_id: i64,
}

impl SourceCollector {
  pub fn from_workspace(workspace: &Path) -> Result<Self> {
    let sources = read_sources(workspace)?;
    let seen_urls = sources.iter().filter_map(|s| s.url.clone()).collect();
    let next_id = sources.len() as i64 + 1;
    Ok(Self {
      sources,
      seen_urls,
      next_id,
    })
  }

  pub fn sources(&self) -> &[ResearchSource] {
    &self.sources
  }

  pub fn into_sources(self) -> Vec<ResearchSource> {
    self.sources
  }

  fn next_source_id(&mut self) -> String {
    let id = format!("src-{:03}", self.next_id);
    self.next_id += 1;
    id
  }

  fn push_source(&mut self, workspace: &Path, source: ResearchSource) -> Result<()> {
    append_source(workspace, &source)?;
    self.sources.push(source);
    Ok(())
  }

  /// 返回论文对应的来源条目，以及它是否为本次新增。已登记的论文同样返回条目，
  /// 让工具观察值始终带上 [src-xxx] 与元数据。
  pub fn add_local_hit(
    &mut self,
    workspace: &Path,
    now: &str,
    paper_id: &str,
    title: &str,
    snippet: &str,
    page: Option<i64>,
  ) -> Result<(ResearchSource, bool)> {
    if let Some(existing) = self
      .sources
      .iter()
      .find(|item| item.local_paper_id.as_deref() == Some(paper_id))
    {
      return Ok((existing.clone(), false));
    }
    let source = ResearchSource {
      id: self.next_source_id(),
      kind: "local".into(),
      url: None,
      title: title.to_string(),
      accessed_at: now.to_string(),
      excerpt: snippet.to_string(),
      local_paper_id: Some(paper_id.to_string()),
      page,
      stored_locally: true,
    };
    self.push_source(workspace, source.clone())?;
    Ok((source, true))
  }

  pub fn add_arxiv_brief(
    &mut self,
    workspace: &Path,
    now: &str,
    abs_url: &str,
    title: &str,
    abstract_text: &str,
  ) -> Result<Option<ResearchSource>> {
    if self.seen_urls.contains(abs_url) {
      return Ok(None);
    }
    self.seen_urls.insert(abs_url.to_string());
    let source = ResearchSource {
      id: self.next_source_id(),
      kind: "arxiv".into(),
      url: Some(abs_url.to_string()),
      title: title.to_string(),
      accessed_at: now.to_string(),
      excerpt: abstract_text.to_string(),
      local_paper_id: None,
      page: None,
      stored_locally: false,
    };
    self.push_source(workspace, source.clone())?;
    Ok(Some(source))
  }

  pub fn add_web_brief(
    &mut self,
    workspace: &Path,
    now: &str,
    url: &str,
    title: &str,
    excerpt: &str,
    kind: &str,
  ) -> Result<Option<ResearchSource>> {
    if self.seen_urls.contains(url) {
      return Ok(None);
    }
    self.seen_urls.insert(url.to_string());
    let source = ResearchSource {
      id: self.next_source_id(),
      kind: kind.to_string(),
      url: Some(url.to_string()),
      title: title.to_string(),
      accessed_at: now.to_string(),
      excerpt: excerpt.to_string(),
      local_paper_id: None,
      page: None,
      stored_locally: false,
    };
    self.push_source(workspace, source.clone())?;
    Ok(Some(source))
  }

  /// 无结构化链接时，将本次 LLM 联网综述登记为可引用来源。
  pub fn add_llm_web_memo(
    &mut self,
    workspace: &Path,
    now: &str,
    query: &str,
    summary: &str,
  ) -> Result<ResearchSource> {
    let memo_url = format!("llm-web-memo://{}", query.trim());
    if let Some(existing) = self
      .sources
      .iter()
      .find(|item| item.url.as_deref() == Some(memo_url.as_str()))
    {
      return Ok(existing.clone());
    }
    self.seen_urls.insert(memo_url.clone());
    let title = format!(
      "LLM联网综述：{}",
      query.chars().take(80).collect::<String>()
    );
    let excerpt = summary.chars().take(800).collect::<String>();
    let source = ResearchSource {
      id: self.next_source_id(),
      kind: "llm_web".into(),
      url: Some(memo_url),
      title,
      accessed_at: now.to_string(),
      excerpt,
      local_paper_id: None,
      page: None,
      stored_locally: false,
    };
    self.push_source(workspace, source.clone())?;
    Ok(source)
  }

  pub fn add_annotation(
    &mut self,
    workspace: &Path,
    now: &str,
    paper_id: &str,
    paper_title: &str,
    page: Option<i64>,
    quote: &str,
    comment: &str,
  ) -> Result<ResearchSource> {
    let excerpt = format!(
      "p.{page} | {quote} | {comment}",
      page = page.map(|v| v.to_string()).unwrap_or_else(|| "?".into()),
      quote = quote.chars().take(160).collect::<String>(),
      comment = comment.chars().take(120).collect::<String>()
    );
    let source = ResearchSource {
      id: self.next_source_id(),
      kind: "annotation".into(),
      url: None,
      title: format!("批注：{paper_title}"),
      accessed_at: now.to_string(),
      excerpt,
      local_paper_id: Some(paper_id.to_string()),
      page,
      stored_locally: true,
    };
    self.push_source(workspace, source.clone())?;
    Ok(source)
  }

  pub fn add_excerpt(
    &mut self,
    workspace: &Path,
    now: &str,
    paper_id: &str,
    paper_title: &str,
    page: Option<i64>,
    text: &str,
    translation: &str,
  ) -> Result<ResearchSource> {
    let excerpt = format!(
      "{text} | {translation}",
      text = text.chars().take(160).collect::<String>(),
      translation = translation.chars().take(120).collect::<String>()
    );
    let source = ResearchSource {
      id: self.next_source_id(),
      kind: "excerpt".into(),
      url: None,
      title: format!("摘录：{paper_title}"),
      accessed_at: now.to_string(),
      excerpt,
      local_paper_id: Some(paper_id.to_string()),
      page,
      stored_locally: true,
    };
    self.push_source(workspace, source.clone())?;
    Ok(source)
  }
}

pub struct ToolContext<'a> {
  pub library_pool: &'a SqlitePool,
  pub workspace: &'a Path,
  pub allow_web: bool,
  pub research_settings: Option<&'a crate::research::ResearchLlmSettings>,
  pub collector: &'a mut SourceCollector,
  pub now: &'a str,
  pub allow_subtopic: bool,
}

pub fn react_tool_catalog(settings: &crate::research::ResearchLlmSettings) -> Vec<ToolSpec> {
  let allow_web = settings.allow_web_search;
  let mut tools = vec![
    tool(
      "search_library",
      "全文检索本地论文库。返回带 [src-xxx] 编号的命中摘要。",
      serde_json::json!({
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "检索词" },
          "limit": { "type": "integer", "description": "最多返回条数，默认 6" }
        },
        "required": ["query"]
      }),
    ),
    tool(
      "get_paper",
      "读取论文元数据与摘要。paperId 为 search_library 行内 paper: 后的 ID，或传入 [src-xxx]（本地与外网来源均可返回已登记摘要）。",
      serde_json::json!({
        "type": "object",
        "properties": {
          "paperId": { "type": "string", "description": "本地 papers.id，或 src-xxx 来源编号" },
          "sourceId": { "type": "string", "description": "同 paperId，可传 src-xxx" }
        }
      }),
    ),
    tool(
      "search_annotations",
      "检索批注 quote/comment。",
      serde_json::json!({
        "type": "object",
        "properties": {
          "query": { "type": "string" },
          "limit": { "type": "integer" }
        },
        "required": ["query"]
      }),
    ),
    tool(
      "search_excerpts",
      "检索写作摘录（原句与译文）。",
      serde_json::json!({
        "type": "object",
        "properties": {
          "query": { "type": "string" },
          "limit": { "type": "integer" }
        },
        "required": ["query"]
      }),
    ),
    tool(
      "update_outline",
      "更新 outline.md（Markdown 章节骨架）。",
      serde_json::json!({
        "type": "object",
        "properties": { "outline": { "type": "string" } },
        "required": ["outline"]
      }),
    ),
    tool(
      "finish_research",
      "证据已足够时结束调研循环。参数 summary 为给 Writer 的研究备忘。",
      serde_json::json!({
        "type": "object",
        "properties": { "summary": { "type": "string" } },
        "required": ["summary"]
      }),
    ),
    tool(
      "research_subtopic",
      "委派 1～2 个子问题给并行子 Agent 深入检索。",
      serde_json::json!({
        "type": "object",
        "properties": {
          "subtopics": {
            "type": "array",
            "items": { "type": "string" },
            "description": "1～2 个聚焦子问题"
          }
        },
        "required": ["subtopics"]
      }),
    ),
  ];
  if allow_web {
    tools.insert(
      1,
      tool(
        "search_arxiv",
        "检索 arXiv 预印本元数据，按投稿时间由新到旧返回（仅链接与摘要，不下载 PDF）。",
        serde_json::json!({
          "type": "object",
          "properties": {
            "query": {
              "type": "string",
              "description": "2～5 个英文主题词，按重要度排序；所有词按 AND 组合，词越多越精准"
            },
            "limit": { "type": "integer" }
          },
          "required": ["query"]
        }),
      ),
    );
    tools.insert(
      2,
      tool(
        "search_web",
        "检索外网学术与技术来源：OpenAlex（含 IEEE/ACM 等 DOI 论文）、Crossref、GitHub 仓库。返回链接与摘要，不下载 PDF。",
        serde_json::json!({
          "type": "object",
          "properties": {
            "query": { "type": "string", "description": "2～5 个英文主题词，按重要度排序" },
            "limit": { "type": "integer" },
            "fromYear": {
              "type": "integer",
              "description": "只要该年（含）以后的论文；调研「最新进展」时必填，例如 2024"
            }
          },
          "required": ["query"]
        }),
      ),
    );
    tools.push(tool(
      "fetch_url",
      "抓取指定网页正文并登记为来源。用户在提问里给出链接时用它读取内容。",
      serde_json::json!({
        "type": "object",
        "properties": {
          "url": { "type": "string", "description": "http/https 链接" }
        },
        "required": ["url"]
      }),
    ));
    if crate::research_llm_web::native_web_search_enabled(settings) {
      tools.insert(
        3,
        tool(
          "llm_web_search",
          "通过调研 LLM 内置联网能力检索博客、新闻、技术综述等通用网页（与 search_web 学术元数据互补）。返回综述与可登记来源。",
          serde_json::json!({
            "type": "object",
            "properties": {
              "query": { "type": "string", "description": "检索问题或 2～6 个关键词" }
            },
            "required": ["query"]
          }),
        ),
      );
    }
  }
  tools
}

pub fn mcp_research_tool_names() -> Vec<&'static str> {
  vec![
    "search_library",
    "get_paper",
    "search_annotations",
    "search_excerpts",
    "list_research_sessions",
    "get_research_report",
  ]
}

pub fn tool_openai_schema(spec: &ToolSpec) -> serde_json::Value {
  serde_json::json!({
    "type": "function",
    "function": {
      "name": spec.name,
      "description": spec.description,
      "parameters": spec.parameters
    }
  })
}

pub fn mcp_tool_desc(spec: &ToolSpec) -> serde_json::Value {
  serde_json::json!({
    "name": spec.name,
    "description": spec.description,
    "inputSchema": spec.parameters
  })
}

fn tool(name: &'static str, description: &'static str, parameters: serde_json::Value) -> ToolSpec {
  ToolSpec {
    name,
    description,
    parameters,
  }
}

/// 工具输出把来源编号显示成 [src-001]，LLM 会照抄方括号，这里统一剥掉。
fn normalize_source_ref(raw: &str) -> String {
  raw.trim().trim_start_matches('[').trim_end_matches(']').trim().to_string()
}

fn resolve_local_paper_id(collector: &SourceCollector, raw: &str) -> Option<String> {
  if raw.starts_with("src-") {
    collector
      .sources()
      .iter()
      .find(|s| s.id == raw)
      .and_then(|s| s.local_paper_id.clone())
  } else {
    Some(raw.to_string())
  }
}

pub enum ToolOutcome {
  Continue { observation: String, new_source_ids: Vec<String> },
  Finished { summary: String },
  Subtopics { questions: Vec<String> },
}

pub async fn execute_react_tool(ctx: &mut ToolContext<'_>, name: &str, args: &serde_json::Value) -> Result<ToolOutcome> {
  match name {
    "finish_research" => {
      let summary = args
        .get("summary")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
      if summary.is_empty() {
        let brief = auto_research_brief(ctx.collector.sources());
        if brief.is_empty() {
          return Ok(ToolOutcome::Continue {
            observation: "finish_research 的 summary 不能为空。请先检索来源，或写一段关键证据与结论摘要。".into(),
            new_source_ids: vec![],
          });
        }
        return Ok(ToolOutcome::Finished { summary: brief });
      }
      Ok(ToolOutcome::Finished { summary })
    }
    "search_library" => {
      let query = arg_str(args, "query")?;
      let limit = arg_limit(args, 6);
      let hits = search_library_rows(ctx.library_pool, &query).await?;
      let mut lines = Vec::new();
      let mut new_ids = Vec::new();
      for hit in hits.into_iter().take(limit) {
        let (source, is_new) = ctx.collector.add_local_hit(
          ctx.workspace,
          ctx.now,
          &hit.paper_id,
          &hit.title,
          &hit.snippet,
          hit.page,
        )?;
        if is_new {
          new_ids.push(source.id.clone());
        }
        lines.push(format!(
          "[{}] paper:{} | {} | {} | {}",
          source.id,
          hit.paper_id,
          source.title,
          hit.kind,
          source.excerpt.chars().take(200).collect::<String>()
        ));
      }
      let observation = if lines.is_empty() {
        format!("未找到与「{query}」相关的本地论文。请改用更短关键词（如「冷启动」「推荐系统」）重试。")
      } else {
        format!(
          "本地命中 {} 条（新增 {} 条）：\n{}",
          lines.len(),
          new_ids.len(),
          lines.join("\n")
        )
      };
      Ok(ToolOutcome::Continue {
        observation,
        new_source_ids: new_ids,
      })
    }
    "search_arxiv" => {
      if !ctx.allow_web {
        return Err("未启用 arXiv 检索".into());
      }
      let query = arg_str(args, "query")?;
      let limit = arg_limit(args, 8);
      let from_year = arg_from_year(args);
      let mut lines = Vec::new();
      let mut new_ids = Vec::new();
      match radar::search_arxiv_briefs(&query, limit as i64).await {
        Ok(briefs) => {
          for brief in briefs {
            if let Some(source) = ctx.collector.add_arxiv_brief(
              ctx.workspace,
              ctx.now,
              &brief.abs_url,
              &brief.title,
              &brief.abstract_text,
            )? {
              new_ids.push(source.id.clone());
              lines.push(format!(
                "[{}] {} | {} | {}",
                source.id,
                source.title,
                brief.abs_url,
                source.excerpt.chars().take(200).collect::<String>()
              ));
            }
          }
        }
        Err(arxiv_error) => match crate::research_web::search_web_sources(&query, limit as i64, from_year).await {
          Ok(web_briefs) => {
            lines.push(format!(
              "arXiv 暂时不可用（{arxiv_error}），已改用 OpenAlex/Crossref："
            ));
            for brief in web_briefs {
              if let Some(source) = ctx.collector.add_web_brief(
                ctx.workspace,
                ctx.now,
                &brief.url,
                &brief.title,
                &brief.excerpt,
                &brief.kind,
              )? {
                new_ids.push(source.id.clone());
                lines.push(format!(
                  "[{}] {} | {} | {}",
                  source.id,
                  source.title,
                  brief.url,
                  source.excerpt.chars().take(200).collect::<String>()
                ));
              }
            }
          }
          Err(web_error) => {
            return Ok(ToolOutcome::Continue {
              observation: format!(
                "arXiv 与外网检索均不可用（arXiv: {arxiv_error}; 外网: {web_error}）。请基于已有来源 finish_research。"
              ),
              new_source_ids: vec![],
            });
          }
        },
      }
      let observation = if lines.is_empty() {
        format!("arXiv 未返回与「{query}」相关的结果。")
      } else {
        lines.join("\n")
      };
      Ok(ToolOutcome::Continue {
        observation,
        new_source_ids: new_ids,
      })
    }
    "search_web" => {
      if !ctx.allow_web {
        return Err("未启用外网检索".into());
      }
      let query = arg_str(args, "query")?;
      let limit = arg_limit(args, 8);
      let from_year = arg_from_year(args);
      let briefs = match crate::research_web::search_web_sources(&query, limit as i64, from_year).await {
        Ok(briefs) => briefs,
        Err(error) => {
          return Ok(ToolOutcome::Continue {
            observation: format!(
              "外网检索暂时不可用（{error}）。请优先 search_library，或改用 search_arxiv。"
            ),
            new_source_ids: vec![],
          });
        }
      };
      let mut lines = Vec::new();
      let mut new_ids = Vec::new();
      for brief in briefs {
        if let Some(source) = ctx.collector.add_web_brief(
          ctx.workspace,
          ctx.now,
          &brief.url,
          &brief.title,
          &brief.excerpt,
          &brief.kind,
        )? {
          new_ids.push(source.id.clone());
          lines.push(format!(
            "[{}] {} | {} | {}",
            source.id,
            source.title,
            brief.url,
            source.excerpt.chars().take(200).collect::<String>()
          ));
        }
      }
      let observation = if lines.is_empty() {
        format!("外网未返回与「{query}」相关的学术/技术来源。请缩短关键词或换用英文检索。")
      } else {
        lines.join("\n")
      };
      Ok(ToolOutcome::Continue {
        observation,
        new_source_ids: new_ids,
      })
    }
    "fetch_url" => {
      if !ctx.allow_web {
        return Err("未启用外网检索".into());
      }
      let url = arg_str(args, "url")?;
      let (title, text) = match crate::research_web::fetch_url_text(&url, 4000).await {
        Ok(result) => result,
        Err(error) => {
          return Ok(ToolOutcome::Continue {
            observation: format!("抓取 {url} 失败（{error}）。"),
            new_source_ids: vec![],
          });
        }
      };
      let source = ctx
        .collector
        .add_web_brief(ctx.workspace, ctx.now, &url, &title, &text, "web")?;
      let observation = match &source {
        Some(source) => format!("[{}] {}\n{}", source.id, title, text),
        None => format!("该链接已登记过。\n{title}\n{text}"),
      };
      Ok(ToolOutcome::Continue {
        observation,
        new_source_ids: source.map(|s| vec![s.id]).unwrap_or_default(),
      })
    }
    "llm_web_search" => {
      if !ctx.allow_web {
        return Err("未启用外网检索".into());
      }
      let settings = ctx.research_settings.ok_or_else(|| "llm_web_search 需要调研 LLM 设置".to_string())?;
      let query = arg_str(args, "query")?;
      let result = match crate::research_llm_web::llm_web_search(settings, &query).await {
        Ok(result) => result,
        Err(error) => {
          return Ok(ToolOutcome::Continue {
            observation: format!(
              "LLM 内置联网检索失败（{error}）。请改用 search_web / search_arxiv，或对已知链接使用 fetch_url。"
            ),
            new_source_ids: vec![],
          });
        }
      };
      let mut lines = vec![format!(
        "LLM 内置联网（{}）综述：\n{}",
        crate::research_llm_web::provider_label(result.provider),
        result.summary.chars().take(1200).collect::<String>()
      )];
      let mut hits =
        crate::research_llm_web::enrich_llm_web_hits(result.hits).await;
      if hits.is_empty() && !result.summary.trim().is_empty() {
        hits = crate::research_llm_web::supplement_hits_from_query(&query).await;
      }
      let mut new_ids = Vec::new();
      for hit in hits.iter().take(8) {
        if let Some(source) = ctx.collector.add_web_brief(
          ctx.workspace,
          ctx.now,
          &hit.url,
          &hit.title,
          &hit.snippet,
          "llm_web",
        )? {
          new_ids.push(source.id.clone());
          lines.push(format!(
            "[{}] {} | {} | {}",
            source.id,
            hit.title,
            hit.url,
            hit.snippet.chars().take(200).collect::<String>()
          ));
        }
      }
      if !hits.is_empty() {
        lines.push(format!(
          "链接 {} 条，新登记 {} 条。",
          hits.len(),
          new_ids.len()
        ));
      } else if !result.summary.trim().is_empty() {
        let source = ctx.collector.add_llm_web_memo(
          ctx.workspace,
          ctx.now,
          &query,
          &result.summary,
        )?;
        new_ids.push(source.id.clone());
        lines.push(format!(
          "[{}] {}（无结构化链接，已登记综述备忘）",
          source.id, source.title
        ));
      }
      Ok(ToolOutcome::Continue {
        observation: lines.join("\n"),
        new_source_ids: new_ids,
      })
    }
    "get_paper" => {
      let raw_id = args
        .get("paperId")
        .or_else(|| args.get("paper_id"))
        .or_else(|| args.get("sourceId"))
        .or_else(|| args.get("source_id"))
        .and_then(|v| v.as_str())
        .map(normalize_source_ref)
        .unwrap_or_default();
      if raw_id.is_empty() {
        return Ok(ToolOutcome::Continue {
          observation: "get_paper 需要 paperId（search_library 结果中 paper: 后的 ID）或 sourceId（[src-xxx]）。".into(),
          new_source_ids: vec![],
        });
      }
      let paper_id = resolve_local_paper_id(ctx.collector, &raw_id).unwrap_or_else(|| raw_id.clone());
      let row = match sqlx::query("SELECT * FROM papers WHERE id=? AND deleted_at IS NULL")
        .bind(&paper_id)
        .fetch_optional(ctx.library_pool)
        .await
        .map_err(err)?
      {
        Some(row) => row,
        None => {
          if raw_id.starts_with("src-") {
            if let Some(source) = ctx.collector.sources().iter().find(|s| s.id == raw_id) {
              let observation = serde_json::to_string_pretty(&serde_json::json!({
                "sourceId": source.id,
                "kind": source.kind,
                "title": source.title,
                "url": source.url,
                "excerpt": source.excerpt.chars().take(800).collect::<String>(),
              }))
              .map_err(err)?;
              return Ok(ToolOutcome::Continue {
                observation,
                new_source_ids: vec![],
              });
            }
            return Ok(ToolOutcome::Continue {
              observation: format!("来源 {raw_id} 尚未登记，请先通过 search_library / search_arxiv / search_web 检索。"),
              new_source_ids: vec![],
            });
          }
          return Ok(ToolOutcome::Continue {
            observation: format!(
              "本地库中不存在论文 {paper_id}。请仅使用 search_library 返回的 paper: 后 ID，勿编造编号。"
            ),
            new_source_ids: vec![],
          });
        }
      };
      let paper = row_paper(row)?;
      let excerpt = paper
        .abstract_en
        .clone()
        .or(paper.summary.clone())
        .unwrap_or_default();
      let (source, is_new) = ctx.collector.add_local_hit(
        ctx.workspace,
        ctx.now,
        &paper.id,
        &paper.title_en,
        &excerpt,
        None,
      )?;
      let observation = serde_json::to_string_pretty(&serde_json::json!({
        "sourceId": source.id,
        "title": paper.title_en,
        "titleZh": paper.title_zh,
        "venue": paper.venue,
        "publicationDate": paper.publication_date,
        "abstract": excerpt.chars().take(800).collect::<String>(),
        "arxivId": paper.arxiv_id,
        "doi": paper.doi,
      }))
      .map_err(err)?;
      Ok(ToolOutcome::Continue {
        observation,
        new_source_ids: if is_new { vec![source.id] } else { vec![] },
      })
    }
    "search_annotations" => {
      let query = arg_str(args, "query")?;
      let limit = arg_limit(args, 8);
      let pattern = format!("%{query}%");
      let rows = sqlx::query(
        "SELECT a.paper_id, a.page, a.quote, a.comment, p.title_en
         FROM annotations a
         JOIN papers p ON p.id = a.paper_id
         WHERE p.deleted_at IS NULL
           AND (a.quote LIKE ? OR a.comment LIKE ?)
         ORDER BY a.updated_at DESC
         LIMIT ?",
      )
      .bind(&pattern)
      .bind(&pattern)
      .bind(limit as i64)
      .fetch_all(ctx.library_pool)
      .await
      .map_err(err)?;
      let mut lines = Vec::new();
      let mut new_ids = Vec::new();
      for row in rows {
        let paper_id: String = row.get("paper_id");
        let title: String = row.get("title_en");
        let page: Option<i64> = row.get("page");
        let quote: Option<String> = row.get("quote");
        let comment: Option<String> = row.get("comment");
        let source = ctx.collector.add_annotation(
          ctx.workspace,
          ctx.now,
          &paper_id,
          &title,
          page,
          quote.as_deref().unwrap_or(""),
          comment.as_deref().unwrap_or(""),
        )?;
        new_ids.push(source.id.clone());
        lines.push(format!("[{}] {} | {}", source.id, source.title, source.excerpt));
      }
      let observation = if lines.is_empty() {
        format!("未找到与「{query}」相关的批注。")
      } else {
        lines.join("\n")
      };
      Ok(ToolOutcome::Continue {
        observation,
        new_source_ids: new_ids,
      })
    }
    "search_excerpts" => {
      let query = arg_str(args, "query")?;
      let limit = arg_limit(args, 8);
      let pattern = format!("%{query}%");
      let rows = sqlx::query(
        "SELECT e.paper_id, e.page, e.source_text, e.translation_zh, p.title_en
         FROM excerpts e
         JOIN papers p ON p.id = e.paper_id
         WHERE p.deleted_at IS NULL
           AND (e.source_text LIKE ? OR e.translation_zh LIKE ? OR e.personal_rewrite LIKE ?)
         ORDER BY e.created_at DESC
         LIMIT ?",
      )
      .bind(&pattern)
      .bind(&pattern)
      .bind(&pattern)
      .bind(limit as i64)
      .fetch_all(ctx.library_pool)
      .await
      .map_err(err)?;
      let mut lines = Vec::new();
      let mut new_ids = Vec::new();
      for row in rows {
        let paper_id: String = row.get("paper_id");
        let title: String = row.get("title_en");
        let page: Option<i64> = row.get("page");
        let source_text: String = row.get("source_text");
        let translation: Option<String> = row.get("translation_zh");
        let source = ctx.collector.add_excerpt(
          ctx.workspace,
          ctx.now,
          &paper_id,
          &title,
          page,
          &source_text,
          translation.as_deref().unwrap_or(""),
        )?;
        new_ids.push(source.id.clone());
        lines.push(format!("[{}] {} | {}", source.id, source.title, source.excerpt));
      }
      let observation = if lines.is_empty() {
        format!("未找到与「{query}」相关的摘录。")
      } else {
        lines.join("\n")
      };
      Ok(ToolOutcome::Continue {
        observation,
        new_source_ids: new_ids,
      })
    }
    "update_outline" => {
      let outline = args
        .get("outline")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
      fs::write(ctx.workspace.join("outline.md"), &outline).map_err(err)?;
      Ok(ToolOutcome::Continue {
        observation: "outline.md 已更新。".into(),
        new_source_ids: vec![],
      })
    }
    "research_subtopic" => {
      if !ctx.allow_subtopic {
        return Err("当前上下文不允许 research_subtopic".into());
      }
      if ctx.collector.sources().len() >= 30 {
        return Ok(ToolOutcome::Continue {
          observation: format!(
            "已登记 {} 条来源，足够撰写报告。请直接 finish_research，无需再委派子 Agent。",
            ctx.collector.sources().len()
          ),
          new_source_ids: vec![],
        });
      }
      let questions: Vec<String> = args
        .get("subtopics")
        .and_then(|v| v.as_array())
        .map(|items| {
          items
            .iter()
            .filter_map(|v| v.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string))
            .take(2)
            .collect()
        })
        .unwrap_or_default();
      if questions.is_empty() {
        return Err("subtopics 需要 1～2 个非空字符串".into());
      }
      Ok(ToolOutcome::Subtopics { questions })
    }
    _ => Err(format!("未知工具：{name}")),
  }
}

pub async fn pipeline_invoke(
  library_pool: &SqlitePool,
  workspace: &Path,
  settings: &crate::research::ResearchLlmSettings,
  collector: &mut SourceCollector,
  now: &str,
  tool: &str,
  args: serde_json::Value,
) -> Result<ToolOutcome> {
  let mut ctx = ToolContext {
    library_pool,
    workspace,
    allow_web: settings.allow_web_search,
    research_settings: Some(settings),
    collector,
    now,
    allow_subtopic: false,
  };
  execute_react_tool(&mut ctx, tool, &args).await
}

pub async fn execute_mcp_tool(library_dir: &Path, name: &str, args: &serde_json::Value) -> Result<String> {
  match name {
    "list_research_sessions" => {
      let pool = crate::research::open_research_pool_public(library_dir).await?;
      let sessions = crate::research::list_sessions_public(&pool).await?;
      pool.close().await;
      Ok(serde_json::to_string_pretty(&sessions).map_err(err)?)
    }
    "get_research_report" => {
      let session_id = args
        .get("sessionId")
        .or_else(|| args.get("session_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
      if session_id.is_empty() {
        return Err("sessionId 不能为空".into());
      }
      let pool = crate::research::open_research_pool_public(library_dir).await?;
      let session = crate::research::get_session_public(&pool, session_id).await?;
      pool.close().await;
      fs::read_to_string(&session.report_path).map_err(err)
    }
    _ => {
      let pool = open_pool(library_dir).await?;
      let workspace = library_dir.join("research").join("_mcp_scratch");
      fs::create_dir_all(&workspace).map_err(err)?;
      let now = Utc::now().to_rfc3339();
      let mut collector = SourceCollector::from_workspace(&workspace)?;
      let allow_web = true;
      let mut ctx = ToolContext {
        library_pool: &pool,
        workspace: &workspace,
        allow_web,
        research_settings: None,
        collector: &mut collector,
        now: &now,
        allow_subtopic: false,
      };
      let outcome = execute_react_tool(&mut ctx, name, args).await?;
      pool.close().await;
      match outcome {
        ToolOutcome::Continue { observation, .. } => Ok(observation),
        ToolOutcome::Finished { summary } => Ok(summary),
        ToolOutcome::Subtopics { .. } => Err("MCP 不支持 research_subtopic".into()),
      }
    }
  }
}

fn arg_str(args: &serde_json::Value, key: &str) -> Result<String> {
  let value = args.get(key).and_then(|v| v.as_str()).unwrap_or("").trim();
  if value.is_empty() {
    return Err(format!("{key} 不能为空"));
  }
  Ok(value.to_string())
}

fn arg_limit(args: &serde_json::Value, default: usize) -> usize {
  args.get("limit")
    .and_then(|v| v.as_u64())
    .map(|v| v.clamp(1, 20) as usize)
    .unwrap_or(default)
}

fn arg_from_year(args: &serde_json::Value) -> Option<i64> {
  args
    .get("fromYear")
    .or_else(|| args.get("from_year"))
    .and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.trim().parse().ok())))
    .filter(|year| (1900..=2100).contains(year))
}

/// finish_research 未带 summary 时，从已登记来源拼 Writer 备忘。
fn auto_research_brief(sources: &[ResearchSource]) -> String {
  if sources.is_empty() {
    return String::new();
  }
  let lines: Vec<String> = sources
    .iter()
    .rev()
    .take(20)
    .map(|source| {
      format!(
        "[{}] {} — {}",
        source.id,
        source.title,
        source.excerpt.chars().take(120).collect::<String>()
      )
    })
    .collect();
  format!(
    "以下是从已登记来源自动整理的调研备忘：\n{}",
    lines.join("\n")
  )
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn auto_brief_lists_recent_sources() {
    let sources = vec![
      ResearchSource {
        id: "src-001".into(),
        kind: "local".into(),
        url: None,
        title: "Paper A".into(),
        accessed_at: "t".into(),
        excerpt: "abstract a".into(),
        local_paper_id: None,
        page: None,
        stored_locally: true,
      },
      ResearchSource {
        id: "src-002".into(),
        kind: "arxiv".into(),
        url: Some("https://arxiv.org/abs/1".into()),
        title: "Paper B".into(),
        accessed_at: "t".into(),
        excerpt: "abstract b".into(),
        local_paper_id: None,
        page: None,
        stored_locally: false,
      },
    ];
    let brief = auto_research_brief(&sources);
    assert!(brief.contains("src-002"));
    assert!(brief.contains("Paper B"));
  }

  #[test]
  fn source_ref_drops_citation_brackets() {
    assert_eq!(normalize_source_ref("[src-001]"), "src-001");
    assert_eq!(normalize_source_ref(" src-002 "), "src-002");
    assert_eq!(
      normalize_source_ref("0fa2f4b2-def5-4a01-95af-9521c0d15ece"),
      "0fa2f4b2-def5-4a01-95af-9521c0d15ece"
    );
  }

  #[test]
  fn catalog_registers_llm_web_search_when_enabled() {
    let settings = crate::research::catalog_settings(true, "auto");
    let names: Vec<_> = react_tool_catalog(&settings).into_iter().map(|t| t.name).collect();
    assert!(names.contains(&"llm_web_search"));
    let off = crate::research::catalog_settings(true, "off");
    let off_names: Vec<_> = react_tool_catalog(&off).into_iter().map(|t| t.name).collect();
    assert!(!off_names.contains(&"llm_web_search"));
  }

  #[test]
  fn collector_registers_llm_web_memo() {
    let dir = std::env::temp_dir().join(format!("pn-memo-{}", Uuid::new_v4()));
    fs::create_dir_all(dir.join("steps")).unwrap();
    fs::write(dir.join("sources.jsonl"), "").unwrap();
    let mut collector = SourceCollector::from_workspace(&dir).unwrap();
    let now = "2026-01-01T00:00:00Z";
    let first = collector
      .add_llm_web_memo(&dir, now, "AI agent survey", "summary text")
      .unwrap();
    let second = collector
      .add_llm_web_memo(&dir, now, "AI agent survey", "other")
      .unwrap();
    assert_eq!(first.id, second.id);
    assert_eq!(collector.sources().len(), 1);
    let _ = fs::remove_dir_all(dir);
  }

  #[test]
  fn collector_reuses_source_id_for_duplicate_local() {
    let dir = std::env::temp_dir().join(format!("pn-collector-{}", Uuid::new_v4()));
    fs::create_dir_all(dir.join("steps")).unwrap();
    fs::write(dir.join("sources.jsonl"), "").unwrap();
    let mut collector = SourceCollector::from_workspace(&dir).unwrap();
    let now = "2026-01-01T00:00:00Z";
    let (first, first_is_new) = collector
      .add_local_hit(&dir, now, "p1", "Title", "snippet", None)
      .unwrap();
    assert!(first_is_new);
    let (second, second_is_new) = collector
      .add_local_hit(&dir, now, "p1", "Title", "snippet", None)
      .unwrap();
    assert!(!second_is_new);
    assert_eq!(first.id, second.id);
    assert_eq!(collector.sources().len(), 1);
    let _ = fs::remove_dir_all(dir);
  }
}
