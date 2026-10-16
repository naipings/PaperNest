use std::collections::HashSet;

/// 将用户/LLM 检索词拆成若干 token，避免整句短语匹配导致零结果。
pub fn search_tokenize(query: &str) -> Vec<String> {
  let mut tokens = Vec::new();
  for part in query.split(is_query_delimiter) {
    let part = part.trim();
    if part.is_empty() || is_search_stopword(part) {
      continue;
    }
    let char_count = part.chars().count();
    if char_count < 2 && !part.chars().any(|c| c.is_ascii_alphanumeric()) {
      continue;
    }
    tokens.push(part.to_string());
  }
  let mut seen = HashSet::new();
  tokens.retain(|token| seen.insert(token.to_lowercase()));
  tokens
}

fn is_query_delimiter(c: char) -> bool {
  c.is_whitespace() || "，、,;；/|()（）[]【】\"'".contains(c)
}

fn is_search_stopword(word: &str) -> bool {
  matches!(
    word.to_ascii_lowercase().as_str(),
    "的"
      | "与"
      | "及"
      | "和"
      | "在"
      | "等"
      | "关于"
      | "方向"
      | "研究"
      | "最新"
      | "进展"
      | "for"
      | "the"
      | "a"
      | "an"
      | "of"
      | "and"
      | "or"
      | "to"
      | "in"
      | "on"
      | "with"
  ) || matches!(word, "的" | "与" | "及" | "和" | "在" | "等" | "关于" | "方向" | "研究" | "最新" | "进展")
}

pub fn fts_phrase(term: &str) -> String {
  format!("\"{}\"", term.replace('"', "\"\""))
}

/// FTS5 查询：多词用 OR 连接，提高召回；单词仍用短语匹配。
pub fn fts_query(query: &str) -> String {
  let tokens = search_tokenize(query);
  match tokens.len() {
    0 => {
      let trimmed = query.trim();
      if trimmed.is_empty() {
        String::new()
      } else {
        fts_phrase(trimmed)
      }
    }
    1 => fts_phrase(&tokens[0]),
    _ => tokens.iter().map(|t| fts_phrase(t)).collect::<Vec<_>>().join(" OR "),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn tokenize_splits_mixed_query() {
    let tokens = search_tokenize("心力衰竭 SGLT2 heart failure");
    assert!(tokens.iter().any(|t| t.contains("心力衰竭")));
    assert!(tokens.iter().any(|t| t.contains("heart")));
  }

  #[test]
  fn fts_query_uses_or_for_multiple_terms() {
    let q = fts_query("心力衰竭 SGLT2 heart failure");
    assert!(q.contains(" OR "));
    assert!(!q.contains("心力衰竭 SGLT2 heart failure"));
  }
}
