use super::*;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomFieldOption {
  pub id: String,
  pub label: String,
  pub color: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomFieldDefinition {
  pub id: String,
  pub name: String,
  #[serde(rename = "type")]
  pub field_type: String,
  #[serde(default)]
  pub options: Vec<CustomFieldOption>,
  pub position: i64,
  #[serde(default = "default_show_in_table")]
  pub show_in_table: bool,
  pub archived_at: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperCustomFieldValue {
  pub paper_id: String,
  pub field_id: String,
  pub value: serde_json::Value,
  pub updated_at: String,
}

fn default_show_in_table() -> bool {
  true
}

const FIELD_TYPES: &[&str] = &["text", "number", "date", "url", "boolean", "select", "multiselect"];

fn normalize_field_type(field_type: &str) -> Result<String> {
  let field_type = field_type.trim().to_lowercase();
  if FIELD_TYPES.contains(&field_type.as_str()) {
    Ok(field_type)
  } else {
    Err(format!("不支持的字段类型：{field_type}"))
  }
}

fn row_definition(row: &sqlx::sqlite::SqliteRow) -> Result<CustomFieldDefinition> {
  Ok(CustomFieldDefinition {
    id: row.get("id"),
    name: row.get("name"),
    field_type: row.get("type"),
    options: serde_json::from_str(&row.get::<String, _>("options_json")).map_err(err)?,
    position: row.get("position"),
    show_in_table: row.get::<i64, _>("show_in_table") != 0,
    archived_at: row.get("archived_at"),
  })
}

pub async fn load_definitions(pool: &SqlitePool) -> Result<Vec<CustomFieldDefinition>> {
  sqlx::query("SELECT * FROM custom_field_definitions ORDER BY position, name")
    .fetch_all(pool)
    .await
    .map_err(err)?
    .iter()
    .map(row_definition)
    .collect()
}

pub async fn load_values(pool: &SqlitePool) -> Result<Vec<PaperCustomFieldValue>> {
  sqlx::query("SELECT paper_id, field_id, value_json, updated_at FROM paper_custom_field_values")
    .fetch_all(pool)
    .await
    .map_err(err)?
    .into_iter()
    .map(|row| {
      Ok(PaperCustomFieldValue {
        paper_id: row.get("paper_id"),
        field_id: row.get("field_id"),
        value: serde_json::from_str(&row.get::<String, _>("value_json")).map_err(err)?,
        updated_at: row.get("updated_at"),
      })
    })
    .collect()
}

pub async fn save_definition(pool: &SqlitePool, mut definition: CustomFieldDefinition) -> Result<CustomFieldDefinition> {
  definition.name = definition.name.trim().to_string();
  if definition.name.is_empty() {
    return Err("字段名称不能为空".into());
  }
  definition.field_type = normalize_field_type(&definition.field_type)?;
  if definition.id.trim().is_empty() {
    definition.id = Uuid::new_v4().to_string();
  }
  if definition.field_type == "select" || definition.field_type == "multiselect" {
    definition.options.retain(|option| !option.label.trim().is_empty());
    if definition.options.is_empty() {
      return Err("单选或多选字段至少需要一个选项".into());
    }
    for option in &mut definition.options {
      if option.id.trim().is_empty() {
        option.id = Uuid::new_v4().to_string();
      }
      option.label = option.label.trim().to_string();
      if option.color.trim().is_empty() {
        option.color = "#7867c6".into();
      }
    }
  } else {
    definition.options.clear();
  }
  if definition.position <= 0 {
    let max: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(position), 0) FROM custom_field_definitions")
      .fetch_one(pool)
      .await
      .map_err(err)?;
    definition.position = max + 1;
  }
  sqlx::query(
    "INSERT INTO custom_field_definitions(id,name,type,options_json,position,show_in_table,archived_at) VALUES(?,?,?,?,?,?,?) \
     ON CONFLICT(id) DO UPDATE SET name=excluded.name,type=excluded.type,options_json=excluded.options_json,position=excluded.position,show_in_table=excluded.show_in_table",
  )
  .bind(&definition.id)
  .bind(&definition.name)
  .bind(&definition.field_type)
  .bind(serde_json::to_string(&definition.options).map_err(err)?)
  .bind(definition.position)
  .bind(i64::from(definition.show_in_table))
  .bind(&definition.archived_at)
  .execute(pool)
  .await
  .map_err(err)?;
  Ok(definition)
}

pub async fn archive_definition(pool: &SqlitePool, field_id: &str) -> Result<i64> {
  let affected: i64 = sqlx::query_scalar("SELECT COUNT(DISTINCT paper_id) FROM paper_custom_field_values WHERE field_id=?")
    .bind(field_id)
    .fetch_one(pool)
    .await
    .map_err(err)?;
  let now = Utc::now().to_rfc3339();
  sqlx::query("UPDATE custom_field_definitions SET archived_at=? WHERE id=?")
    .bind(now)
    .bind(field_id)
    .execute(pool)
    .await
    .map_err(err)?;
  Ok(affected)
}

pub async fn save_paper_values(pool: &SqlitePool, paper_id: &str, values: Vec<PaperCustomFieldValue>) -> Result<()> {
  let exists: Option<String> = sqlx::query_scalar("SELECT id FROM papers WHERE id=? AND deleted_at IS NULL")
    .bind(paper_id)
    .fetch_optional(pool)
    .await
    .map_err(err)?;
  if exists.is_none() {
    return Err("论文不存在或已移入回收站".into());
  }
  let active: Vec<CustomFieldDefinition> = load_definitions(pool)
    .await?
    .into_iter()
    .filter(|definition| definition.archived_at.is_none())
    .collect();
  let allowed: std::collections::HashSet<String> = active.iter().map(|definition| definition.id.clone()).collect();
  for item in values {
    if item.paper_id != paper_id {
      return Err("字段值与论文 ID 不匹配".into());
    }
    if !allowed.contains(&item.field_id) {
      continue;
    }
    let definition = active.iter().find(|definition| definition.id == item.field_id).expect("field exists");
    if item.value.is_null() || is_empty_value(&item.value, &definition.field_type) {
      sqlx::query("DELETE FROM paper_custom_field_values WHERE paper_id=? AND field_id=?")
        .bind(paper_id)
        .bind(&item.field_id)
        .execute(pool)
        .await
        .map_err(err)?;
      continue;
    }
    validate_value(&item.value, definition)?;
    sqlx::query(
      "INSERT INTO paper_custom_field_values(paper_id,field_id,value_json,updated_at) VALUES(?,?,?,?) \
       ON CONFLICT(paper_id,field_id) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
    )
    .bind(paper_id)
    .bind(&item.field_id)
    .bind(serde_json::to_string(&item.value).map_err(err)?)
    .bind(&item.updated_at)
    .execute(pool)
    .await
    .map_err(err)?;
  }
  Ok(())
}

fn is_empty_value(value: &serde_json::Value, field_type: &str) -> bool {
  match field_type {
    "boolean" => value.as_bool().is_none(),
    "number" => value.as_f64().is_none(),
    "multiselect" => value.as_array().map(|items| items.is_empty()).unwrap_or(true),
    _ => value.as_str().map(|text| text.trim().is_empty()).unwrap_or(true),
  }
}

fn validate_value(value: &serde_json::Value, definition: &CustomFieldDefinition) -> Result<()> {
  match definition.field_type.as_str() {
    "text" => {
      if value.as_str().is_none() {
        return Err(format!("{} 需要文本值", definition.name));
      }
    }
    "number" => {
      if value.as_f64().is_none() {
        return Err(format!("{} 需要数字", definition.name));
      }
    }
    "date" | "url" => {
      if value.as_str().map(|text| text.trim().is_empty()).unwrap_or(true) {
        return Err(format!("{} 不能为空", definition.name));
      }
    }
    "boolean" => {
      if value.as_bool().is_none() {
        return Err(format!("{} 需要布尔值", definition.name));
      }
    }
    "select" => {
      let selected = value.as_str().ok_or_else(|| format!("{} 需要单选值", definition.name))?;
      if !definition.options.iter().any(|option| option.id == selected) {
        return Err(format!("{} 的选项无效", definition.name));
      }
    }
    "multiselect" => {
      let items = value.as_array().ok_or_else(|| format!("{} 需要多选值", definition.name))?;
      for selected in items {
        let selected = selected.as_str().ok_or_else(|| format!("{} 的多选值无效", definition.name))?;
        if !definition.options.iter().any(|option| option.id == selected) {
          return Err(format!("{} 的选项无效", definition.name));
        }
      }
    }
    _ => return Err("未知字段类型".into()),
  }
  Ok(())
}
