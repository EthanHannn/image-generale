use base64::{engine::general_purpose::STANDARD, Engine as _};
use rfd::FileDialog;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, process::Command, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ProviderConfig {
  id: String,
  name: String,
  api_url: String,
  api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct UpscaleConfig {
  api_url: String,
  api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
  providers: Vec<ProviderConfig>,
  current_provider_id: String,
  upscale_config: UpscaleConfig,
  theme: String,
  history_root_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestParams {
  n: i64,
  size: String,
  quality: String,
  auto_prompt: String,
  translate: String,
  resolution: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryRecordPayload {
  id: Option<i64>,
  timestamp: i64,
  provider_id: String,
  provider_name: String,
  mode: String,
  model_id: String,
  model_name: String,
  prompt: String,
  params: RequestParams,
  images_base64: Vec<String>,
  image_count: i64,
  duration: String,
  request_json: String,
  total_size: i64,
}

impl Default for AppConfig {
  fn default() -> Self {
    Self {
      providers: Vec::new(),
      current_provider_id: String::new(),
      upscale_config: UpscaleConfig::default(),
      theme: String::from("dark"),
      history_root_dir: String::new(),
    }
  }
}

fn default_history_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(app
    .path()
    .document_dir()
    .map_err(|error| error.to_string())?
    .join("ImageGenerator")
    .join("history-data"))
}

fn history_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let config = load_app_config(app.clone())?.unwrap_or_default();
  let dir = if config.history_root_dir.trim().is_empty() {
    default_history_root_dir(app)?
  } else {
    PathBuf::from(config.history_root_dir)
  };
  fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
  Ok(dir)
}

fn config_file_path(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_config_dir()
    .map_err(|error| error.to_string())?;

  fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
  Ok(dir.join("config.json"))
}

fn history_db_path(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(history_root_dir(app)?.join("history.db"))
}

fn history_images_dir(app: &AppHandle, timestamp: i64) -> Result<PathBuf, String> {
  let seconds = if timestamp > 0 { timestamp / 1000 } else { 0 };
  let bucket = 60 * 60 * 24 * 30;
  let month_key = format!("month-{}", seconds / bucket);
  let dir = history_root_dir(app)?.join("images").join(month_key);
  fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
  Ok(dir)
}

fn open_history_db(app: &AppHandle) -> Result<Connection, String> {
  let db_path = history_db_path(app)?;
  let connection = Connection::open(db_path).map_err(|error| error.to_string())?;
  connection
    .execute_batch(
      "
      CREATE TABLE IF NOT EXISTS history_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        provider_id TEXT NOT NULL,
        provider_name TEXT NOT NULL,
        mode TEXT NOT NULL,
        model_id TEXT NOT NULL,
        model_name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        params_json TEXT NOT NULL,
        images_json TEXT NOT NULL,
        image_count INTEGER NOT NULL,
        duration TEXT NOT NULL,
        request_json TEXT NOT NULL,
        total_size INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history_records(timestamp);
      CREATE INDEX IF NOT EXISTS idx_history_model_id ON history_records(model_id);
      ",
    )
    .map_err(|error| error.to_string())?;

  Ok(connection)
}

fn now_millis() -> i128 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|value| value.as_millis() as i128)
    .unwrap_or(0)
}

fn save_history_images(app: &AppHandle, timestamp: i64, images_base64: &[String]) -> Result<Vec<String>, String> {
  let image_dir = history_images_dir(app, timestamp)?;
  let token = now_millis();
  let mut relative_paths = Vec::with_capacity(images_base64.len());

  for (index, image_base64) in images_base64.iter().enumerate() {
    let bytes = STANDARD.decode(image_base64).map_err(|error| error.to_string())?;
    let file_name = format!("{}_{}_{}.png", timestamp, token, index + 1);
    let relative_path = format!("images/{}/{}", image_dir.file_name().and_then(|value| value.to_str()).unwrap_or("default"), file_name);
    let absolute_path = image_dir.join(&file_name);
    fs::write(&absolute_path, bytes).map_err(|error| error.to_string())?;
    relative_paths.push(relative_path.replace('\\', "/"));
  }

  Ok(relative_paths)
}

fn delete_history_images(app: &AppHandle, images_json: &str) -> Result<(), String> {
  let relative_paths: Vec<String> = serde_json::from_str(images_json).unwrap_or_default();
  let root_dir = history_root_dir(app)?;
  for relative_path in relative_paths {
    let absolute_path = root_dir.join(relative_path);
    if absolute_path.exists() {
      fs::remove_file(&absolute_path).map_err(|error| error.to_string())?;
    }
  }
  Ok(())
}

fn read_history_images(app: &AppHandle, images_json: &str) -> Result<Vec<String>, String> {
  let relative_paths: Vec<String> = serde_json::from_str(images_json).unwrap_or_default();
  let root_dir = history_root_dir(app)?;
  let mut images_base64 = Vec::with_capacity(relative_paths.len());

  for relative_path in relative_paths {
    let absolute_path = root_dir.join(relative_path);
    let bytes = fs::read(&absolute_path).map_err(|error| error.to_string())?;
    images_base64.push(STANDARD.encode(bytes));
  }

  Ok(images_base64)
}

fn row_to_history_payload(app: &AppHandle, row: &rusqlite::Row<'_>) -> Result<HistoryRecordPayload, String> {
  let params_json: String = row.get("params_json").map_err(|error| error.to_string())?;
  let images_json: String = row.get("images_json").map_err(|error| error.to_string())?;
  let params = serde_json::from_str::<RequestParams>(&params_json).map_err(|error| error.to_string())?;
  let images_base64 = read_history_images(app, &images_json)?;

  Ok(HistoryRecordPayload {
    id: row.get("id").map_err(|error| error.to_string())?,
    timestamp: row.get("timestamp").map_err(|error| error.to_string())?,
    provider_id: row.get("provider_id").map_err(|error| error.to_string())?,
    provider_name: row.get("provider_name").map_err(|error| error.to_string())?,
    mode: row.get("mode").map_err(|error| error.to_string())?,
    model_id: row.get("model_id").map_err(|error| error.to_string())?,
    model_name: row.get("model_name").map_err(|error| error.to_string())?,
    prompt: row.get("prompt").map_err(|error| error.to_string())?,
    params,
    images_base64,
    image_count: row.get("image_count").map_err(|error| error.to_string())?,
    duration: row.get("duration").map_err(|error| error.to_string())?,
    request_json: row.get("request_json").map_err(|error| error.to_string())?,
    total_size: row.get("total_size").map_err(|error| error.to_string())?,
  })
}

#[tauri::command]
fn load_app_config(app: AppHandle) -> Result<Option<AppConfig>, String> {
  let path = config_file_path(&app)?;
  if !path.exists() {
    return Ok(None);
  }

  let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
  let config = serde_json::from_str::<AppConfig>(&text).map_err(|error| error.to_string())?;
  Ok(Some(config))
}

#[tauri::command]
fn save_app_config(app: AppHandle, config: AppConfig) -> Result<(), String> {
  let path = config_file_path(&app)?;
  let text = serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?;
  fs::write(path, text).map_err(|error| error.to_string())
}

#[tauri::command]
fn select_history_directory(app: AppHandle) -> Result<Option<String>, String> {
  let current_dir = history_root_dir(&app).ok();
  let mut dialog = FileDialog::new();
  if let Some(dir) = current_dir {
    dialog = dialog.set_directory(dir);
  }

  let selected = dialog.pick_folder();
  Ok(selected.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn open_history_directory(app: AppHandle) -> Result<(), String> {
  let dir = history_root_dir(&app)?;
  Command::new("explorer")
    .arg(dir)
    .spawn()
    .map_err(|error| error.to_string())?;
  Ok(())
}

#[tauri::command]
fn get_history_root_dir(app: AppHandle) -> Result<String, String> {
  Ok(history_root_dir(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
fn add_history_record(app: AppHandle, record: HistoryRecordPayload) -> Result<i64, String> {
  let connection = open_history_db(&app)?;
  let image_paths = save_history_images(&app, record.timestamp, &record.images_base64)?;
  let params_json = serde_json::to_string(&record.params).map_err(|error| error.to_string())?;
  let images_json = serde_json::to_string(&image_paths).map_err(|error| error.to_string())?;

  connection
    .execute(
      "
      INSERT INTO history_records (
        timestamp, provider_id, provider_name, mode, model_id, model_name,
        prompt, params_json, images_json, image_count, duration, request_json, total_size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ",
      params![
        record.timestamp,
        record.provider_id,
        record.provider_name,
        record.mode,
        record.model_id,
        record.model_name,
        record.prompt,
        params_json,
        images_json,
        record.image_count,
        record.duration,
        record.request_json,
        record.total_size,
      ],
    )
    .map_err(|error| error.to_string())?;

  Ok(connection.last_insert_rowid())
}

#[tauri::command]
fn list_history_records(app: AppHandle, descending: bool) -> Result<Vec<HistoryRecordPayload>, String> {
  let connection = open_history_db(&app)?;
  let mut statement = connection
    .prepare(if descending {
      "SELECT * FROM history_records ORDER BY timestamp DESC"
    } else {
      "SELECT * FROM history_records ORDER BY timestamp ASC"
    })
    .map_err(|error| error.to_string())?;

  let rows = statement
    .query_map([], |row| Ok(row_to_history_payload(&app, row)))
    .map_err(|error| error.to_string())?;

  let mut records = Vec::new();
  for row in rows {
    records.push(row.map_err(|error| error.to_string())??);
  }
  Ok(records)
}

#[tauri::command]
fn get_history_record(app: AppHandle, id: i64) -> Result<Option<HistoryRecordPayload>, String> {
  let connection = open_history_db(&app)?;
  let mut statement = connection
    .prepare("SELECT * FROM history_records WHERE id = ? LIMIT 1")
    .map_err(|error| error.to_string())?;

  let mut rows = statement.query(params![id]).map_err(|error| error.to_string())?;
  if let Some(row) = rows.next().map_err(|error| error.to_string())? {
    return Ok(Some(row_to_history_payload(&app, row)?));
  }

  Ok(None)
}

#[tauri::command]
fn delete_history_record(app: AppHandle, id: i64) -> Result<(), String> {
  let connection = open_history_db(&app)?;
  let mut statement = connection
    .prepare("SELECT images_json FROM history_records WHERE id = ? LIMIT 1")
    .map_err(|error| error.to_string())?;
  let images_json = statement
    .query_row(params![id], |row| row.get::<_, String>(0))
    .optional()
    .map_err(|error| error.to_string())?;

  connection
    .execute("DELETE FROM history_records WHERE id = ?", params![id])
    .map_err(|error| error.to_string())?;

  if let Some(images_json) = images_json {
    delete_history_images(&app, &images_json)?;
  }

  Ok(())
}

#[tauri::command]
fn clear_history_records(app: AppHandle) -> Result<(), String> {
  let connection = open_history_db(&app)?;
  let mut statement = connection
    .prepare("SELECT images_json FROM history_records")
    .map_err(|error| error.to_string())?;
  let rows = statement
    .query_map([], |row| row.get::<_, String>(0))
    .map_err(|error| error.to_string())?;

  for row in rows {
    delete_history_images(&app, &row.map_err(|error| error.to_string())?)?;
  }

  connection
    .execute("DELETE FROM history_records", [])
    .map_err(|error| error.to_string())?;

  Ok(())
}

#[tauri::command]
fn get_history_storage_usage(app: AppHandle) -> Result<i64, String> {
  let connection = open_history_db(&app)?;
  let total = connection
    .query_row(
      "SELECT COALESCE(SUM(total_size), 0) FROM history_records",
      [],
      |row| row.get::<_, i64>(0),
    )
    .map_err(|error| error.to_string())?;
  Ok(total)
}

#[tauri::command]
fn enforce_history_storage_limit(app: AppHandle, max_storage: i64) -> Result<(), String> {
  let mut total = get_history_storage_usage(app.clone())?;
  if total <= max_storage {
    return Ok(());
  }

  let connection = open_history_db(&app)?;
  let mut statement = connection
    .prepare("SELECT id, total_size FROM history_records ORDER BY timestamp ASC")
    .map_err(|error| error.to_string())?;
  let rows = statement
    .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))
    .map_err(|error| error.to_string())?;

  for row in rows {
    let (id, size) = row.map_err(|error| error.to_string())?;
    if total <= max_storage {
      break;
    }
    delete_history_record(app.clone(), id)?;
    total -= size;
  }

  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      load_app_config,
      save_app_config,
      select_history_directory,
      open_history_directory,
      get_history_root_dir,
      add_history_record,
      list_history_records,
      get_history_record,
      delete_history_record,
      clear_history_records,
      get_history_storage_usage,
      enforce_history_storage_limit
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
