use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::Utc;
use hmac::{Hmac, Mac};
use rfd::FileDialog;
use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::{
    collections::BTreeMap,
    fs,
    path::{Component, Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use tokio::time::{sleep, Duration};
use uuid::Uuid;

type HmacSha1 = Hmac<Sha1>;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ProviderConfig {
    id: String,
    name: String,
    api_url: String,
    api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "provider", rename_all = "camelCase")]
enum UpscaleConfig {
    #[serde(rename = "aliyun")]
    Aliyun {
        access_key_id: String,
        access_key_secret: String,
    },
    #[serde(rename = "custom")]
    Custom { api_url: String, api_key: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct UpscaleProviderConfig {
    id: String,
    name: String,
    provider: String,
    access_key_id: String,
    access_key_secret: String,
    api_url: String,
    api_key: String,
}

impl Default for UpscaleConfig {
    fn default() -> Self {
        Self::Custom {
            api_url: String::new(),
            api_key: String::new(),
        }
    }
}

// 兼容旧格式（无 provider 字段）的反序列化
fn deserialize_upscale_config<'de, D>(deserializer: D) -> Result<UpscaleConfig, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)
        .unwrap_or_else(|_| serde_json::Value::Object(serde_json::Map::new()));
    let provider = value
        .get("provider")
        .and_then(|v| v.as_str())
        .unwrap_or("custom");
    match provider {
        "aliyun" => Ok(UpscaleConfig::Aliyun {
            access_key_id: value
                .get("accessKeyId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            access_key_secret: value
                .get("accessKeySecret")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        }),
        _ => Ok(UpscaleConfig::Custom {
            api_url: value
                .get("apiUrl")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            api_key: value
                .get("apiKey")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        }),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryStoragePolicy {
    limit_mode: String,
    limit_bytes: Option<i64>,
}

impl Default for HistoryStoragePolicy {
    fn default() -> Self {
        Self {
            limit_mode: String::from("unlimited"),
            limit_bytes: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    providers: Vec<ProviderConfig>,
    current_provider_id: String,
    #[serde(default, deserialize_with = "deserialize_upscale_config")]
    upscale_config: UpscaleConfig,
    #[serde(default)]
    upscale_providers: Vec<UpscaleProviderConfig>,
    #[serde(default)]
    current_upscale_provider_id: String,
    theme: String,
    history_root_dir: String,
    #[serde(default)]
    history_storage_policy: HistoryStoragePolicy,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveImageFileResult {
    status: String,
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveImageBatchItem {
    image_base64: String,
    filename: String,
    mime_type: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveImageBatchResult {
    status: String,
    directory: Option<String>,
    saved_count: usize,
    failed_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageCleanupResult {
    deleted_count: i64,
    freed_bytes: i64,
    remaining_bytes: i64,
    limit_reached: bool,
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
    target_size_mode: Option<String>,
    target_ratio: Option<String>,
    target_width: Option<i64>,
    target_height: Option<i64>,
    generation_width: Option<i64>,
    generation_height: Option<i64>,
    auto_upscale: Option<bool>,
    auto_upscale_factor: Option<i64>,
    standalone_upscale: Option<bool>,
    source_file_name: Option<String>,
    source_file_size: Option<i64>,
    source_mime_type: Option<String>,
    source_width: Option<i64>,
    source_height: Option<i64>,
    upscale_provider_id: Option<String>,
    upscale_provider_name: Option<String>,
    upscale_factor: Option<i64>,
    output_width: Option<i64>,
    output_height: Option<i64>,
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
    #[serde(default)]
    thumbnail_base64: Vec<String>,
    image_count: i64,
    duration: String,
    request_json: String,
    total_size: i64,
    #[serde(default)]
    upscale_images_base64: BTreeMap<String, BTreeMap<String, String>>,
    #[serde(default)]
    reference_images_base64: BTreeMap<String, HistoryReferenceImagePayload>,
    #[serde(default)]
    is_favorite: bool,
    #[serde(default)]
    favorited_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryReferenceImagePayload {
    data: String,
    mime_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredHistoryReferenceImage {
    path: String,
    mime_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryPagePayload {
    records: Vec<HistoryRecordPayload>,
    total_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryOverviewPayload {
    total_count: i64,
    total_images: i64,
    favorite_count: i64,
    model_ids: Vec<String>,
    latest_record: Option<HistoryRecordPayload>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            providers: Vec::new(),
            current_provider_id: String::new(),
            upscale_config: UpscaleConfig::default(),
            upscale_providers: Vec::new(),
            current_upscale_provider_id: String::new(),
            theme: String::from("dark"),
            history_root_dir: String::new(),
            history_storage_policy: HistoryStoragePolicy::default(),
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

fn history_thumbnails_dir(app: &AppHandle, timestamp: i64) -> Result<PathBuf, String> {
    let seconds = if timestamp > 0 { timestamp / 1000 } else { 0 };
    let bucket = 60 * 60 * 24 * 30;
    let month_key = format!("month-{}", seconds / bucket);
    let dir = history_root_dir(app)?.join("thumbnails").join(month_key);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn directory_size(path: &Path) -> Result<i64, String> {
    if !path.exists() {
        return Ok(0);
    }

    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if metadata.is_file() {
        return Ok(metadata.len() as i64);
    }
    if !metadata.is_dir() {
        return Ok(0);
    }

    let mut total = 0i64;
    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        total += directory_size(&entry.path())?;
    }
    Ok(total)
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
      CREATE INDEX IF NOT EXISTS idx_history_mode ON history_records(mode);
      ",
        )
        .map_err(|error| error.to_string())?;
    add_history_column(
        &connection,
        "ALTER TABLE history_records ADD COLUMN upscale_images_json TEXT NOT NULL DEFAULT '{}'",
    )?;
    add_history_column(
        &connection,
        "ALTER TABLE history_records ADD COLUMN thumbnails_json TEXT NOT NULL DEFAULT '[]'",
    )?;
    add_history_column(
        &connection,
        "ALTER TABLE history_records ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0",
    )?;
    add_history_column(
        &connection,
        "ALTER TABLE history_records ADD COLUMN favorited_at INTEGER",
    )?;
    add_history_column(
        &connection,
        "ALTER TABLE history_records ADD COLUMN reference_images_json TEXT NOT NULL DEFAULT '{}'",
    )?;
    connection
        .execute(
            "CREATE INDEX IF NOT EXISTS idx_history_favorite ON history_records(is_favorite, favorited_at)",
            [],
        )
        .map_err(|error| error.to_string())?;

    Ok(connection)
}

fn add_history_column(connection: &Connection, sql: &str) -> Result<(), String> {
    match connection.execute(sql, []) {
        Ok(_) => Ok(()),
        Err(error) => {
            if error.to_string().contains("duplicate column name") {
                Ok(())
            } else {
                Err(error.to_string())
            }
        }
    }
}

fn now_millis() -> i128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i128)
        .unwrap_or(0)
}

fn save_history_images(
    app: &AppHandle,
    timestamp: i64,
    images_base64: &[String],
) -> Result<Vec<String>, String> {
    let image_dir = history_images_dir(app, timestamp)?;
    let token = now_millis();
    let mut relative_paths = Vec::with_capacity(images_base64.len());

    for (index, image_base64) in images_base64.iter().enumerate() {
        let bytes = STANDARD
            .decode(image_base64)
            .map_err(|error| error.to_string())?;
        let file_name = format!("{}_{}_{}.png", timestamp, token, index + 1);
        let relative_path = format!(
            "images/{}/{}",
            image_dir
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("default"),
            file_name
        );
        let absolute_path = image_dir.join(&file_name);
        fs::write(&absolute_path, bytes).map_err(|error| error.to_string())?;
        relative_paths.push(relative_path.replace('\\', "/"));
    }

    Ok(relative_paths)
}

fn save_history_thumbnail_files(
    app: &AppHandle,
    timestamp: i64,
    thumbnails_base64: &[String],
) -> Result<Vec<String>, String> {
    if thumbnails_base64.is_empty() {
        return Ok(Vec::new());
    }

    let thumbnail_dir = history_thumbnails_dir(app, timestamp)?;
    let dir_name = thumbnail_dir
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("default");
    let token = now_millis();
    let mut relative_paths = Vec::with_capacity(thumbnails_base64.len());

    for (index, thumbnail_base64) in thumbnails_base64.iter().enumerate() {
        let bytes = STANDARD
            .decode(thumbnail_base64)
            .map_err(|error| error.to_string())?;
        let file_name = format!("{}_{}_thumb_{}.webp", timestamp, token, index + 1);
        fs::write(thumbnail_dir.join(&file_name), bytes).map_err(|error| error.to_string())?;
        relative_paths.push(format!("thumbnails/{}/{}", dir_name, file_name).replace('\\', "/"));
    }

    Ok(relative_paths)
}

fn save_history_reference_images(
    app: &AppHandle,
    images_base64: &BTreeMap<String, HistoryReferenceImagePayload>,
) -> Result<BTreeMap<String, StoredHistoryReferenceImage>, String> {
    if images_base64.is_empty() {
        return Ok(BTreeMap::new());
    }

    let reference_dir = history_root_dir(app)?.join("references");
    fs::create_dir_all(&reference_dir).map_err(|error| error.to_string())?;
    let mut stored_images = BTreeMap::new();

    for (role, image) in images_base64 {
        let bytes = STANDARD
            .decode(&image.data)
            .map_err(|error| error.to_string())?;
        let hash = format!("{:x}", Sha1::digest(&bytes));
        let relative_path = format!("references/{}", hash);
        let absolute_path = reference_dir.join(&hash);
        if !absolute_path.exists() {
            fs::write(&absolute_path, bytes).map_err(|error| error.to_string())?;
        }
        stored_images.insert(
            role.clone(),
            StoredHistoryReferenceImage {
                path: relative_path,
                mime_type: if image.mime_type.trim().is_empty() {
                    "image/png".to_string()
                } else {
                    image.mime_type.clone()
                },
            },
        );
    }

    Ok(stored_images)
}

fn delete_history_images(app: &AppHandle, images_json: &str) -> Result<(), String> {
    let relative_paths: Vec<String> = serde_json::from_str(images_json).unwrap_or_default();
    delete_relative_paths(app, relative_paths)
}

fn delete_relative_paths(app: &AppHandle, relative_paths: Vec<String>) -> Result<(), String> {
    let root_dir = history_root_dir(app)?;
    for relative_path in relative_paths {
        let absolute_path = root_dir.join(relative_path);
        if absolute_path.exists() {
            fs::remove_file(&absolute_path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn upscale_paths_from_json(upscale_images_json: &str) -> Vec<String> {
    let variants: BTreeMap<String, BTreeMap<String, String>> =
        serde_json::from_str(upscale_images_json).unwrap_or_default();
    variants
        .values()
        .flat_map(|item| item.values().cloned())
        .collect()
}

fn normalize_relative_path(relative_path: &str) -> Option<String> {
    let path = Path::new(relative_path);
    if path.is_absolute() {
        return None;
    }
    if path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::Prefix(_) | Component::RootDir
        )
    }) {
        return None;
    }
    Some(relative_path.replace('\\', "/"))
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

fn read_history_thumbnails(app: &AppHandle, thumbnails_json: &str) -> Result<Vec<String>, String> {
    let relative_paths: Vec<String> = serde_json::from_str(thumbnails_json).unwrap_or_default();
    let root_dir = history_root_dir(app)?;
    let mut thumbnails_base64 = Vec::with_capacity(relative_paths.len());

    for relative_path in relative_paths {
        let absolute_path = root_dir.join(relative_path);
        if !absolute_path.exists() {
            continue;
        }
        let bytes = fs::read(&absolute_path).map_err(|error| error.to_string())?;
        thumbnails_base64.push(STANDARD.encode(bytes));
    }

    Ok(thumbnails_base64)
}

fn read_upscale_images(
    app: &AppHandle,
    upscale_images_json: &str,
) -> Result<BTreeMap<String, BTreeMap<String, String>>, String> {
    let relative_paths: BTreeMap<String, BTreeMap<String, String>> =
        serde_json::from_str(upscale_images_json).unwrap_or_default();
    let root_dir = history_root_dir(app)?;
    let mut images_base64 = BTreeMap::new();

    for (image_index, variants) in relative_paths {
        let mut base64_variants = BTreeMap::new();
        for (factor, relative_path) in variants {
            let absolute_path = root_dir.join(relative_path);
            let bytes = fs::read(&absolute_path).map_err(|error| error.to_string())?;
            base64_variants.insert(factor, STANDARD.encode(bytes));
        }
        images_base64.insert(image_index, base64_variants);
    }

    Ok(images_base64)
}

fn read_history_reference_images(
    app: &AppHandle,
    references_json: &str,
) -> Result<BTreeMap<String, HistoryReferenceImagePayload>, String> {
    let references: BTreeMap<String, StoredHistoryReferenceImage> =
        serde_json::from_str(references_json).unwrap_or_default();
    let root_dir = history_root_dir(app)?;
    let mut images = BTreeMap::new();

    for (role, reference) in references {
        let Some(relative_path) = normalize_relative_path(&reference.path) else {
            continue;
        };
        let absolute_path = root_dir.join(relative_path);
        if !absolute_path.exists() {
            continue;
        }
        let bytes = fs::read(&absolute_path).map_err(|error| error.to_string())?;
        images.insert(
            role,
            HistoryReferenceImagePayload {
                data: STANDARD.encode(bytes),
                mime_type: reference.mime_type,
            },
        );
    }

    Ok(images)
}

fn delete_unreferenced_history_reference_images(
    app: &AppHandle,
    connection: &Connection,
    references_json: &str,
) -> Result<(), String> {
    let deleted_references: BTreeMap<String, StoredHistoryReferenceImage> =
        serde_json::from_str(references_json).unwrap_or_default();
    if deleted_references.is_empty() {
        return Ok(());
    }

    let mut statement = connection
        .prepare("SELECT reference_images_json FROM history_records")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    let mut remaining_paths = Vec::new();
    for row in rows {
        let references: BTreeMap<String, StoredHistoryReferenceImage> =
            serde_json::from_str(&row.map_err(|error| error.to_string())?).unwrap_or_default();
        remaining_paths.extend(references.into_values().map(|reference| reference.path));
    }

    let root_dir = history_root_dir(app)?;
    for reference in deleted_references.into_values() {
        if remaining_paths.iter().any(|path| path == &reference.path) {
            continue;
        }
        if let Some(relative_path) = normalize_relative_path(&reference.path) {
            let absolute_path = root_dir.join(relative_path);
            if absolute_path.exists() {
                fs::remove_file(absolute_path).map_err(|error| error.to_string())?;
            }
        }
    }

    Ok(())
}

fn row_to_history_payload(
    app: &AppHandle,
    row: &rusqlite::Row<'_>,
    include_images: bool,
) -> Result<HistoryRecordPayload, String> {
    let params_json: String = row.get("params_json").map_err(|error| error.to_string())?;
    let images_json: String = row.get("images_json").map_err(|error| error.to_string())?;
    let thumbnails_json: String = row
        .get("thumbnails_json")
        .map_err(|error| error.to_string())?;
    let upscale_images_json: String = row
        .get("upscale_images_json")
        .map_err(|error| error.to_string())?;
    let reference_images_json: String = row
        .get("reference_images_json")
        .map_err(|error| error.to_string())?;
    let params =
        serde_json::from_str::<RequestParams>(&params_json).map_err(|error| error.to_string())?;
    let images_base64 = if include_images {
        read_history_images(app, &images_json)?
    } else {
        Vec::new()
    };
    let thumbnail_base64 = read_history_thumbnails(app, &thumbnails_json)?;
    let upscale_images_base64 = if include_images {
        read_upscale_images(app, &upscale_images_json)?
    } else {
        BTreeMap::new()
    };
    let reference_images_base64 = if include_images {
        read_history_reference_images(app, &reference_images_json)?
    } else {
        BTreeMap::new()
    };

    let is_favorite: i64 = row.get("is_favorite").map_err(|error| error.to_string())?;

    Ok(HistoryRecordPayload {
        id: row.get("id").map_err(|error| error.to_string())?,
        timestamp: row.get("timestamp").map_err(|error| error.to_string())?,
        provider_id: row.get("provider_id").map_err(|error| error.to_string())?,
        provider_name: row
            .get("provider_name")
            .map_err(|error| error.to_string())?,
        mode: row.get("mode").map_err(|error| error.to_string())?,
        model_id: row.get("model_id").map_err(|error| error.to_string())?,
        model_name: row.get("model_name").map_err(|error| error.to_string())?,
        prompt: row.get("prompt").map_err(|error| error.to_string())?,
        params,
        images_base64,
        thumbnail_base64,
        image_count: row.get("image_count").map_err(|error| error.to_string())?,
        duration: row.get("duration").map_err(|error| error.to_string())?,
        request_json: row.get("request_json").map_err(|error| error.to_string())?,
        total_size: row.get("total_size").map_err(|error| error.to_string())?,
        upscale_images_base64,
        reference_images_base64,
        is_favorite: is_favorite != 0,
        favorited_at: row.get("favorited_at").map_err(|error| error.to_string())?,
    })
}

fn history_query_parts(
    search: Option<String>,
    model_id: Option<String>,
    favorite_only: bool,
    mode_filter: Option<String>,
) -> (String, Vec<Value>) {
    let mut conditions: Vec<String> = Vec::new();
    let mut values: Vec<Value> = Vec::new();

    if let Some(search) = search.map(|value| value.trim().to_string()) {
        if !search.is_empty() {
            conditions.push("prompt LIKE ? COLLATE NOCASE".to_string());
            values.push(Value::Text(format!("%{}%", search)));
        }
    }

    if let Some(model_id) = model_id.map(|value| value.trim().to_string()) {
        if !model_id.is_empty() {
            conditions.push("model_id = ?".to_string());
            values.push(Value::Text(model_id));
        }
    }

    if favorite_only {
        conditions.push("is_favorite = 1".to_string());
    }

    if let Some(mode_filter) = mode_filter.map(|value| value.trim().to_string()) {
        if !mode_filter.is_empty() && mode_filter != "all" {
            conditions.push("mode = ?".to_string());
            values.push(Value::Text(mode_filter));
        }
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", conditions.join(" AND "))
    };

    (where_clause, values)
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

fn image_save_filter(mime_type: &str) -> (&'static str, &'static str, &'static [&'static str]) {
    match mime_type {
        "image/jpeg" => ("jpg", "JPEG Image", &["jpg", "jpeg"]),
        "image/webp" => ("webp", "WebP Image", &["webp"]),
        _ => ("png", "PNG Image", &["png"]),
    }
}

fn normalize_save_file_name(filename: &str, extension: &str) -> String {
    let raw_name = Path::new(filename.trim())
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("image");

    if Path::new(raw_name).extension().is_some() {
        return raw_name.to_string();
    }

    let stem = raw_name.trim_end_matches('.');
    let stem = if stem.is_empty() { "image" } else { stem };
    format!("{}.{}", stem, extension)
}

fn write_image_file(save_path: &Path, image_base64: &str) -> Result<(), String> {
    let bytes = STANDARD
        .decode(image_base64)
        .map_err(|error| format!("图片数据解码失败: {}", error))?;
    fs::write(save_path, bytes).map_err(|error| format!("保存图片失败: {}", error))
}

fn unique_save_path(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }

    let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("image");
    let extension = path.extension().and_then(|value| value.to_str());

    for index in 2..10000 {
        let file_name = match extension {
            Some(extension) => format!("{}_{}.{}", stem, index, extension),
            None => format!("{}_{}", stem, index),
        };
        let next_path = parent.join(file_name);
        if !next_path.exists() {
            return next_path;
        }
    }

    path
}

#[tauri::command]
fn save_image_file(
    app: AppHandle,
    image_base64: String,
    filename: String,
    mime_type: Option<String>,
) -> Result<SaveImageFileResult, String> {
    let mime_type = mime_type.unwrap_or_else(|| "image/png".to_string());
    let (extension, filter_name, extensions) = image_save_filter(&mime_type);
    let file_name = normalize_save_file_name(&filename, extension);
    let mut dialog = FileDialog::new()
        .set_file_name(file_name)
        .add_filter(filter_name, extensions);
    if let Ok(download_dir) = app.path().download_dir() {
        dialog = dialog.set_directory(download_dir);
    }

    let Some(selected_path) = dialog.save_file() else {
        return Ok(SaveImageFileResult {
            status: "cancelled".to_string(),
            path: None,
        });
    };

    let save_path = if selected_path.extension().is_none() {
        selected_path.with_extension(extension)
    } else {
        selected_path
    };
    write_image_file(&save_path, &image_base64)?;

    Ok(SaveImageFileResult {
        status: "saved".to_string(),
        path: Some(save_path.to_string_lossy().to_string()),
    })
}

#[tauri::command]
fn save_image_files_to_directory(
    app: AppHandle,
    images: Vec<SaveImageBatchItem>,
) -> Result<SaveImageBatchResult, String> {
    let mut dialog = FileDialog::new();
    if let Ok(download_dir) = app.path().download_dir() {
        dialog = dialog.set_directory(download_dir);
    }

    let Some(directory) = dialog.pick_folder() else {
        return Ok(SaveImageBatchResult {
            status: "cancelled".to_string(),
            directory: None,
            saved_count: 0,
            failed_count: 0,
        });
    };

    fs::create_dir_all(&directory).map_err(|error| format!("创建保存目录失败: {}", error))?;

    let mut saved_count = 0;
    let mut failed_count = 0;
    for image in images {
        let mime_type = image.mime_type.unwrap_or_else(|| "image/png".to_string());
        let (extension, _, _) = image_save_filter(&mime_type);
        let file_name = normalize_save_file_name(&image.filename, extension);
        let save_path = unique_save_path(directory.join(file_name));
        match write_image_file(&save_path, &image.image_base64) {
            Ok(()) => saved_count += 1,
            Err(_) => failed_count += 1,
        }
    }

    Ok(SaveImageBatchResult {
        status: "saved".to_string(),
        directory: Some(directory.to_string_lossy().to_string()),
        saved_count,
        failed_count,
    })
}

#[tauri::command]
fn add_history_record(app: AppHandle, record: HistoryRecordPayload) -> Result<i64, String> {
    let connection = open_history_db(&app)?;
    let image_paths = save_history_images(&app, record.timestamp, &record.images_base64)?;
    let thumbnail_paths =
        save_history_thumbnail_files(&app, record.timestamp, &record.thumbnail_base64)?;
    let reference_images = save_history_reference_images(&app, &record.reference_images_base64)?;
    let params_json = serde_json::to_string(&record.params).map_err(|error| error.to_string())?;
    let images_json = serde_json::to_string(&image_paths).map_err(|error| error.to_string())?;
    let thumbnails_json =
        serde_json::to_string(&thumbnail_paths).map_err(|error| error.to_string())?;
    let upscale_images_json =
        serde_json::to_string(&BTreeMap::<String, BTreeMap<String, String>>::new())
            .map_err(|error| error.to_string())?;
    let reference_images_json =
        serde_json::to_string(&reference_images).map_err(|error| error.to_string())?;

    connection
        .execute(
            "
      INSERT INTO history_records (
        timestamp, provider_id, provider_name, mode, model_id, model_name,
        prompt, params_json, images_json, image_count, duration, request_json, total_size,
        upscale_images_json, thumbnails_json, reference_images_json, is_favorite, favorited_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                upscale_images_json,
                thumbnails_json,
                reference_images_json,
                if record.is_favorite { 1 } else { 0 },
                record.favorited_at,
            ],
        )
        .map_err(|error| error.to_string())?;

    Ok(connection.last_insert_rowid())
}

#[tauri::command]
fn set_history_record_favorite(
    app: AppHandle,
    record_id: i64,
    is_favorite: bool,
    favorited_at: Option<i64>,
) -> Result<(), String> {
    let connection = open_history_db(&app)?;
    let next_favorited_at = if is_favorite { favorited_at } else { None };
    connection
        .execute(
            "UPDATE history_records SET is_favorite = ?, favorited_at = ? WHERE id = ?",
            params![
                if is_favorite { 1 } else { 0 },
                next_favorited_at,
                record_id
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_history_upscale_variant(
    app: AppHandle,
    record_id: i64,
    image_index: i64,
    factor: i64,
    image_base64: String,
    local_path: Option<String>,
) -> Result<(), String> {
    if !(2..=4).contains(&factor) {
        return Err("超分倍率必须为 2、3 或 4".into());
    }

    let connection = open_history_db(&app)?;
    let upscale_images_json = connection
        .query_row(
            "SELECT upscale_images_json FROM history_records WHERE id = ? LIMIT 1",
            params![record_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "历史记录不存在".to_string())?;

    let mut variants: BTreeMap<String, BTreeMap<String, String>> =
        serde_json::from_str(&upscale_images_json).unwrap_or_default();
    let root_dir = history_root_dir(&app)?;
    let existing_relative_path = local_path
        .as_deref()
        .and_then(normalize_relative_path)
        .filter(|relative_path| root_dir.join(relative_path).exists());
    let next_relative_path = if let Some(relative_path) = existing_relative_path {
        relative_path
    } else {
        let bytes = STANDARD
            .decode(&image_base64)
            .map_err(|error| error.to_string())?;
        let timestamp = now_millis() as i64;
        let image_dir = history_images_dir(&app, timestamp)?;
        let file_name = format!(
            "{}_record_{}_{}_{}x.png",
            timestamp,
            record_id,
            image_index + 1,
            factor
        );
        let dir_name = image_dir
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("default");
        let relative_path = format!("images/{}/{}", dir_name, file_name).replace('\\', "/");
        fs::write(image_dir.join(&file_name), bytes).map_err(|error| error.to_string())?;
        relative_path
    };

    let image_key = image_index.to_string();
    let factor_key = factor.to_string();
    let previous_path = variants
        .get(&image_key)
        .and_then(|item| item.get(&factor_key))
        .cloned();
    variants
        .entry(image_key)
        .or_default()
        .insert(factor_key, next_relative_path.clone());

    let next_json = serde_json::to_string(&variants).map_err(|error| error.to_string())?;
    connection
        .execute(
            "UPDATE history_records SET upscale_images_json = ? WHERE id = ?",
            params![next_json, record_id],
        )
        .map_err(|error| error.to_string())?;

    if let Some(previous_path) = previous_path {
        if previous_path != next_relative_path {
            delete_relative_paths(&app, vec![previous_path])?;
        }
    }

    Ok(())
}

#[tauri::command]
fn save_history_thumbnails(
    app: AppHandle,
    record_id: i64,
    thumbnails_base64: Vec<String>,
) -> Result<(), String> {
    let connection = open_history_db(&app)?;
    let (timestamp, thumbnails_json): (i64, String) = connection
        .query_row(
            "SELECT timestamp, thumbnails_json FROM history_records WHERE id = ? LIMIT 1",
            params![record_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "历史记录不存在".to_string())?;

    let previous_paths: Vec<String> = serde_json::from_str(&thumbnails_json).unwrap_or_default();
    let relative_paths = save_history_thumbnail_files(&app, timestamp, &thumbnails_base64)?;
    let next_json = serde_json::to_string(&relative_paths).map_err(|error| error.to_string())?;
    connection
        .execute(
            "UPDATE history_records SET thumbnails_json = ? WHERE id = ?",
            params![next_json, record_id],
        )
        .map_err(|error| error.to_string())?;

    delete_relative_paths(&app, previous_paths)?;
    Ok(())
}

#[tauri::command]
fn list_history_records(
    app: AppHandle,
    descending: bool,
) -> Result<Vec<HistoryRecordPayload>, String> {
    let connection = open_history_db(&app)?;
    let mut statement = connection
        .prepare(if descending {
            "SELECT * FROM history_records ORDER BY timestamp DESC"
        } else {
            "SELECT * FROM history_records ORDER BY timestamp ASC"
        })
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| Ok(row_to_history_payload(&app, row, false)))
        .map_err(|error| error.to_string())?;

    let mut records = Vec::new();
    for row in rows {
        records.push(row.map_err(|error| error.to_string())??);
    }
    Ok(records)
}

#[tauri::command]
fn list_history_records_page(
    app: AppHandle,
    search: Option<String>,
    model_id: Option<String>,
    favorite_only: bool,
    mode_filter: Option<String>,
    offset: i64,
    limit: i64,
) -> Result<HistoryPagePayload, String> {
    let connection = open_history_db(&app)?;
    let safe_offset = offset.max(0);
    let safe_limit = limit.clamp(1, 100);
    let (where_clause, query_values) =
        history_query_parts(search, model_id, favorite_only, mode_filter);
    let total_sql = format!("SELECT COUNT(*) FROM history_records{}", where_clause);
    let total_count = connection
        .query_row(&total_sql, params_from_iter(query_values.iter()), |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|error| error.to_string())?;

    let mut page_values = query_values.clone();
    page_values.push(Value::Integer(safe_limit));
    page_values.push(Value::Integer(safe_offset));
    let page_sql = format!(
        "SELECT * FROM history_records{} ORDER BY timestamp DESC LIMIT ? OFFSET ?",
        where_clause
    );
    let mut statement = connection
        .prepare(&page_sql)
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params_from_iter(page_values.iter()), |row| {
            Ok(row_to_history_payload(&app, row, false))
        })
        .map_err(|error| error.to_string())?;

    let mut records = Vec::new();
    for row in rows {
        records.push(row.map_err(|error| error.to_string())??);
    }

    Ok(HistoryPagePayload {
        records,
        total_count,
    })
}

#[tauri::command]
fn get_history_overview(app: AppHandle) -> Result<HistoryOverviewPayload, String> {
    let connection = open_history_db(&app)?;
    let (total_count, total_images, favorite_count): (i64, i64, i64) = connection
        .query_row(
            "
            SELECT
              COUNT(*),
              COALESCE(SUM(image_count), 0),
              COALESCE(SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END), 0)
            FROM history_records
            ",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| error.to_string())?;

    let mut model_statement = connection
        .prepare("SELECT DISTINCT model_id FROM history_records ORDER BY model_id ASC")
        .map_err(|error| error.to_string())?;
    let model_rows = model_statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    let mut model_ids = Vec::new();
    for row in model_rows {
        model_ids.push(row.map_err(|error| error.to_string())?);
    }

    let mut latest_statement = connection
        .prepare("SELECT * FROM history_records ORDER BY timestamp DESC LIMIT 1")
        .map_err(|error| error.to_string())?;
    let mut latest_rows = latest_statement
        .query([])
        .map_err(|error| error.to_string())?;
    let latest_record = if let Some(row) = latest_rows.next().map_err(|error| error.to_string())? {
        Some(row_to_history_payload(&app, row, false)?)
    } else {
        None
    };

    Ok(HistoryOverviewPayload {
        total_count,
        total_images,
        favorite_count,
        model_ids,
        latest_record,
    })
}

#[tauri::command]
fn get_history_record(app: AppHandle, id: i64) -> Result<Option<HistoryRecordPayload>, String> {
    let connection = open_history_db(&app)?;
    let mut statement = connection
        .prepare("SELECT * FROM history_records WHERE id = ? LIMIT 1")
        .map_err(|error| error.to_string())?;

    let mut rows = statement
        .query(params![id])
        .map_err(|error| error.to_string())?;
    if let Some(row) = rows.next().map_err(|error| error.to_string())? {
        return Ok(Some(row_to_history_payload(&app, row, true)?));
    }

    Ok(None)
}

#[tauri::command]
fn delete_history_record(app: AppHandle, id: i64) -> Result<(), String> {
    let connection = open_history_db(&app)?;
    let mut statement = connection
        .prepare(
            "SELECT images_json, upscale_images_json, thumbnails_json, reference_images_json FROM history_records WHERE id = ? LIMIT 1",
        )
        .map_err(|error| error.to_string())?;
    let paths_json = statement
        .query_row(params![id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .optional()
        .map_err(|error| error.to_string())?;

    connection
        .execute("DELETE FROM history_records WHERE id = ?", params![id])
        .map_err(|error| error.to_string())?;

    if let Some((images_json, upscale_images_json, thumbnails_json, reference_images_json)) =
        paths_json
    {
        delete_history_images(&app, &images_json)?;
        delete_relative_paths(&app, upscale_paths_from_json(&upscale_images_json))?;
        delete_relative_paths(
            &app,
            serde_json::from_str(&thumbnails_json).unwrap_or_default(),
        )?;
        delete_unreferenced_history_reference_images(&app, &connection, &reference_images_json)?;
    }

    Ok(())
}

#[tauri::command]
fn clear_history_records(app: AppHandle) -> Result<(), String> {
    let connection = open_history_db(&app)?;
    let images_dir = history_root_dir(&app)?.join("images");
    if images_dir.exists() {
        fs::remove_dir_all(&images_dir).map_err(|error| error.to_string())?;
    }
    let thumbnails_dir = history_root_dir(&app)?.join("thumbnails");
    if thumbnails_dir.exists() {
        fs::remove_dir_all(&thumbnails_dir).map_err(|error| error.to_string())?;
    }
    let references_dir = history_root_dir(&app)?.join("references");
    if references_dir.exists() {
        fs::remove_dir_all(&references_dir).map_err(|error| error.to_string())?;
    }

    connection
        .execute("DELETE FROM history_records", [])
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
fn clear_unfavorite_history_records(app: AppHandle) -> Result<i64, String> {
    let connection = open_history_db(&app)?;
    let mut statement = connection
        .prepare("SELECT id FROM history_records WHERE is_favorite = 0")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, i64>(0))
        .map_err(|error| error.to_string())?;
    let mut ids = Vec::new();
    for row in rows {
        ids.push(row.map_err(|error| error.to_string())?);
    }
    drop(statement);
    drop(connection);

    let deleted_count = ids.len() as i64;
    for id in ids {
        delete_history_record(app.clone(), id)?;
    }

    Ok(deleted_count)
}

#[tauri::command]
fn get_history_storage_usage(app: AppHandle) -> Result<i64, String> {
    directory_size(&history_root_dir(&app)?)
}

#[tauri::command]
fn enforce_history_storage_limit(
    app: AppHandle,
    max_storage: i64,
) -> Result<StorageCleanupResult, String> {
    let mut total = get_history_storage_usage(app.clone())?;
    if total <= max_storage {
        return Ok(StorageCleanupResult {
            deleted_count: 0,
            freed_bytes: 0,
            remaining_bytes: total,
            limit_reached: false,
        });
    }

    let original_total = total;
    let mut deleted_count = 0;
    let connection = open_history_db(&app)?;
    let mut statement = connection
        .prepare(
            "SELECT id, total_size FROM history_records WHERE is_favorite = 0 ORDER BY timestamp ASC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))
        .map_err(|error| error.to_string())?;

    for row in rows {
        let (id, _) = row.map_err(|error| error.to_string())?;
        if total <= max_storage {
            break;
        }
        delete_history_record(app.clone(), id)?;
        deleted_count += 1;
        total = get_history_storage_usage(app.clone())?;
    }

    Ok(StorageCleanupResult {
        deleted_count,
        freed_bytes: (original_total - total).max(0),
        remaining_bytes: total,
        limit_reached: total > max_storage,
    })
}

// ===================== 阿里云超分 =====================

const IMAGEENHAN_ENDPOINT: &str = "imageenhan.cn-shanghai.aliyuncs.com";
const IMAGEENHAN_API_VERSION: &str = "2019-09-30";
const OPENPLATFORM_ENDPOINT: &str = "openplatform.aliyuncs.com";
const OPENPLATFORM_API_VERSION: &str = "2019-12-19";
const ALIYUN_REGION_ID: &str = "cn-shanghai";
const ALIYUN_UPSCALE_MAX_BYTES: usize = 20 * 1024 * 1024;
const ALIYUN_UPSCALE_MIN_SIDE: u32 = 64;
const ALIYUN_UPSCALE_MAX_LONG_SIDE: u32 = 5000;
const ALIYUN_UPSCALE_MAX_ASPECT_RATIO: f64 = 2.0;
const ALIYUN_RESULT_DOWNLOAD_RETRY_DELAYS_MS: [u64; 3] = [500, 1_000, 2_000];

// RFC 3986 percent-encode，仅保留 unreserved chars
fn percent_encode(s: &str) -> String {
    s.bytes().fold(String::new(), |mut acc, b| {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                acc.push(b as char)
            }
            _ => acc.push_str(&format!("%{:02X}", b)),
        }
        acc
    })
}

fn png_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    if data.len() < 24 {
        return None;
    }
    if data[0] != 0x89 || data[1] != 0x50 || data[2] != 0x4E || data[3] != 0x47 {
        return None;
    }
    Some((
        u32::from_be_bytes([data[16], data[17], data[18], data[19]]),
        u32::from_be_bytes([data[20], data[21], data[22], data[23]]),
    ))
}

fn jpeg_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    if data.len() < 4 || data[0] != 0xFF || data[1] != 0xD8 {
        return None;
    }

    let mut offset = 2usize;
    while offset + 9 < data.len() {
        if data[offset] != 0xFF {
            offset += 1;
            continue;
        }
        while offset < data.len() && data[offset] == 0xFF {
            offset += 1;
        }
        if offset >= data.len() {
            return None;
        }
        let marker = data[offset];
        offset += 1;
        if matches!(marker, 0xD8 | 0xD9) {
            continue;
        }
        if offset + 2 > data.len() {
            return None;
        }
        let segment_len = u16::from_be_bytes([data[offset], data[offset + 1]]) as usize;
        if segment_len < 2 || offset + segment_len > data.len() {
            return None;
        }
        if matches!(
            marker,
            0xC0 | 0xC1
                | 0xC2
                | 0xC3
                | 0xC5
                | 0xC6
                | 0xC7
                | 0xC9
                | 0xCA
                | 0xCB
                | 0xCD
                | 0xCE
                | 0xCF
        ) {
            if offset + 7 > data.len() {
                return None;
            }
            let height = u16::from_be_bytes([data[offset + 3], data[offset + 4]]) as u32;
            let width = u16::from_be_bytes([data[offset + 5], data[offset + 6]]) as u32;
            return Some((width, height));
        }
        offset += segment_len;
    }
    None
}

fn bmp_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    if data.len() < 26 || data[0] != 0x42 || data[1] != 0x4D {
        return None;
    }
    let width = i32::from_le_bytes([data[18], data[19], data[20], data[21]]).unsigned_abs();
    let height = i32::from_le_bytes([data[22], data[23], data[24], data[25]]).unsigned_abs();
    Some((width, height))
}

fn image_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    png_dimensions(data)
        .or_else(|| jpeg_dimensions(data))
        .or_else(|| bmp_dimensions(data))
}

fn validate_aliyun_upscale_input(data: &[u8]) -> Result<(u32, u32), String> {
    if data.len() > ALIYUN_UPSCALE_MAX_BYTES {
        return Err("阿里云生成式超分输入图片不能超过 20 MB".into());
    }

    let (width, height) = image_dimensions(data)
        .ok_or_else(|| "阿里云生成式超分仅支持 JPEG、JPG、PNG、BMP 图片".to_string())?;
    let short_side = width.min(height);
    let long_side = width.max(height);
    if short_side < ALIYUN_UPSCALE_MIN_SIDE {
        return Err(format!(
            "阿里云生成式超分输入图片最小边不能低于 {}px",
            ALIYUN_UPSCALE_MIN_SIDE
        ));
    }
    if long_side > ALIYUN_UPSCALE_MAX_LONG_SIDE {
        return Err(format!(
            "阿里云生成式超分输入图片长边不能超过 {}px",
            ALIYUN_UPSCALE_MAX_LONG_SIDE
        ));
    }
    if long_side as f64 / short_side as f64 > ALIYUN_UPSCALE_MAX_ASPECT_RATIO {
        return Err(format!(
            "阿里云生成式超分输入图片长宽比不能超过 {}:1",
            ALIYUN_UPSCALE_MAX_ASPECT_RATIO as u32
        ));
    }

    Ok((width, height))
}

// HMAC-SHA1 + base64
fn hmac_sha1_b64(key: &str, data: &str) -> String {
    let mut mac = HmacSha1::new_from_slice(key.as_bytes()).expect("HMAC init");
    mac.update(data.as_bytes());
    STANDARD.encode(mac.finalize().into_bytes())
}

// 构建 Aliyun RPC V1 签名参数
fn aliyun_signed_params(
    method: &str,
    access_key_id: &str,
    access_key_secret: &str,
    action: &str,
    version: &str,
    mut params: BTreeMap<String, String>,
) -> String {
    params.insert("Action".into(), action.into());
    params.insert("Format".into(), "JSON".into());
    params.insert("Version".into(), version.into());
    params.insert("AccessKeyId".into(), access_key_id.into());
    params.insert("SignatureMethod".into(), "HMAC-SHA1".into());
    params.insert(
        "Timestamp".into(),
        Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
    );
    params.insert("SignatureVersion".into(), "1.0".into());
    params.insert("SignatureNonce".into(), Uuid::new_v4().to_string());

    // BTreeMap 自动按 key 升序，直接遍历
    let canonical: String = params
        .iter()
        .map(|(k, v)| format!("{}={}", percent_encode(k), percent_encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    let string_to_sign = format!("{}&%2F&{}", method, percent_encode(&canonical));
    let sig = hmac_sha1_b64(&format!("{}&", access_key_secret), &string_to_sign);
    format!("{}&Signature={}", canonical, percent_encode(&sig))
}

// 通用 RPC POST 调用
async fn aliyun_rpc_post(
    client: &reqwest::Client,
    endpoint: &str,
    version: &str,
    access_key_id: &str,
    access_key_secret: &str,
    action: &str,
    extra: BTreeMap<String, String>,
) -> Result<serde_json::Value, String> {
    let body = aliyun_signed_params(
        "POST",
        access_key_id,
        access_key_secret,
        action,
        version,
        extra,
    );
    let resp = client
        .post(format!("https://{}/", endpoint))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("HTTP 请求失败: {}", e))?;

    let status = resp.status();
    let body_text = resp.text().await.unwrap_or_default();
    let json: serde_json::Value = serde_json::from_str(&body_text)
        .unwrap_or_else(|_| serde_json::json!({ "_raw": body_text }));

    if !status.is_success() {
        let code = json["Code"].as_str().unwrap_or("");
        let msg = json["Message"].as_str().unwrap_or(body_text.as_str());
        return Err(format!("[{}] {} {}", status.as_u16(), code, msg));
    }

    Ok(json)
}

// 通用 RPC GET 调用
async fn aliyun_rpc_get(
    client: &reqwest::Client,
    endpoint: &str,
    version: &str,
    access_key_id: &str,
    access_key_secret: &str,
    action: &str,
    extra: BTreeMap<String, String>,
) -> Result<serde_json::Value, String> {
    let query = aliyun_signed_params(
        "GET",
        access_key_id,
        access_key_secret,
        action,
        version,
        extra,
    );
    let resp = client
        .get(format!("https://{}/?{}", endpoint, query))
        .send()
        .await
        .map_err(|e| format!("HTTP 请求失败: {}", e))?;

    let status = resp.status();
    let body_text = resp.text().await.unwrap_or_default();
    let json: serde_json::Value = serde_json::from_str(&body_text)
        .unwrap_or_else(|_| serde_json::json!({ "_raw": body_text }));

    if !status.is_success() {
        let code = json["Code"].as_str().unwrap_or("");
        let msg = json["Message"].as_str().unwrap_or(body_text.as_str());
        return Err(format!("[{}] {} {}", status.as_u16(), code, msg));
    }

    Ok(json)
}

// OSS 表单上传授权
struct OssUploadAuth {
    access_key_id: String,
    encoded_policy: String,
    signature: String,
    bucket: String,
    endpoint: String,
    object_key: String,
    use_accelerate: bool,
}

enum SubmitResult {
    DirectUrl(String),
    AsyncJob(String),
}

fn clean_result_url(url: &str) -> String {
    url.trim()
        .trim_matches('"')
        .replace("&amp;", "&")
        .replace("\\/", "/")
}

fn find_url_in_json(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => {
            let cleaned = clean_result_url(text);
            if cleaned.starts_with("http://") || cleaned.starts_with("https://") {
                return Some(cleaned);
            }
            if cleaned.starts_with('{') || cleaned.starts_with('[') {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&cleaned) {
                    return find_url_in_json(&parsed);
                }
            }
            None
        }
        serde_json::Value::Object(map) => {
            for key in [
                "ResultUrl",
                "resultUrl",
                "result_url",
                "Result",
                "result",
                "Url",
                "url",
                "ImageUrl",
                "imageUrl",
            ] {
                if let Some(found) = map.get(key).and_then(find_url_in_json) {
                    return Some(found);
                }
            }
            map.values().find_map(find_url_in_json)
        }
        serde_json::Value::Array(items) => items.iter().find_map(find_url_in_json),
        _ => None,
    }
}

// Step 1：获取阿里云内部 OSS 表单上传授权
async fn authorize_file_upload(
    client: &reqwest::Client,
    access_key_id: &str,
    access_key_secret: &str,
) -> Result<(OssUploadAuth, serde_json::Value), String> {
    let mut extra = BTreeMap::new();
    extra.insert("Product".into(), "imageenhan".into());
    extra.insert("RegionId".into(), ALIYUN_REGION_ID.into());
    let json = aliyun_rpc_get(
        client,
        OPENPLATFORM_ENDPOINT,
        OPENPLATFORM_API_VERSION,
        access_key_id,
        access_key_secret,
        "AuthorizeFileUpload",
        extra,
    )
    .await?;

    // 兼容顶层字段或嵌套在 Data 里
    let get = |key: &str| -> String {
        json[key]
            .as_str()
            .or_else(|| json["Data"][key].as_str())
            .unwrap_or("")
            .to_string()
    };

    let ak_id = get("AccessKeyId");
    if ak_id.is_empty() {
        return Err(format!(
            "AuthorizeFileUpload 响应缺少 AccessKeyId，完整响应: {}",
            json
        ));
    }
    let encoded_policy = get("EncodedPolicy");
    if encoded_policy.is_empty() {
        return Err(format!(
            "AuthorizeFileUpload 响应缺少 EncodedPolicy，完整响应: {}",
            json
        ));
    }
    let signature = get("Signature");
    if signature.is_empty() {
        return Err(format!(
            "AuthorizeFileUpload 响应缺少 Signature，完整响应: {}",
            json
        ));
    }
    let bucket = get("Bucket");
    if bucket.is_empty() {
        return Err(format!(
            "AuthorizeFileUpload 响应缺少 Bucket，完整响应: {}",
            json
        ));
    }
    let object_key = get("ObjectKey");
    if object_key.is_empty() {
        return Err(format!(
            "AuthorizeFileUpload 响应缺少 ObjectKey，完整响应: {}",
            json
        ));
    }
    let endpoint = {
        let e = get("Endpoint");
        if e.is_empty() {
            "oss-cn-shanghai.aliyuncs.com".into()
        } else {
            e
        }
    };
    let use_accelerate = json["UseAccelerate"]
        .as_bool()
        .or_else(|| json["Data"]["UseAccelerate"].as_bool())
        .unwrap_or(false);

    Ok((
        OssUploadAuth {
            access_key_id: ak_id,
            encoded_policy,
            signature,
            bucket,
            endpoint,
            object_key,
            use_accelerate,
        },
        json,
    ))
}

fn oss_form_endpoint(endpoint: &str, use_accelerate: bool) -> String {
    if use_accelerate {
        "oss-accelerate.aliyuncs.com".into()
    } else {
        endpoint
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .trim_end_matches('/')
            .to_string()
    }
}

// Step 2：POST 图片到 OSS，返回可访问 URL
async fn oss_post_object(
    client: &reqwest::Client,
    token: &OssUploadAuth,
    data: Vec<u8>,
) -> Result<(String, serde_json::Value), String> {
    let upload_endpoint = oss_form_endpoint(&token.endpoint, token.use_accelerate);
    let host = format!("{}.{}", token.bucket, upload_endpoint);
    let part = reqwest::multipart::Part::bytes(data)
        .file_name(token.object_key.clone())
        .mime_str("image/png")
        .map_err(|e| format!("构建 OSS 上传文件失败: {}", e))?;
    let form = reqwest::multipart::Form::new()
        .text("OSSAccessKeyId", token.access_key_id.clone())
        .text("policy", token.encoded_policy.clone())
        .text("Signature", token.signature.clone())
        .text("key", token.object_key.clone())
        .text("success_action_status", "201")
        .part("file", part);

    let resp = client
        .post(format!("https://{}/", host))
        .header("host", &host)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("OSS 上传请求失败: {}", e))?;

    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("OSS 上传失败 HTTP {}: {}", status.as_u16(), body));
    }

    let image_url = format!(
        "http://{}.{}/{}",
        token.bucket, token.endpoint, token.object_key
    );
    Ok((
        image_url.clone(),
        serde_json::json!({
          "status": status.as_u16(),
          "imageUrl": image_url,
          "body": body,
        }),
    ))
}

// Step 3：提交超分任务，返回 JobId
async fn submit_super_resolution(
    client: &reqwest::Client,
    access_key_id: &str,
    access_key_secret: &str,
    image_url: &str,
    scale: u32,
) -> Result<(SubmitResult, serde_json::Value), String> {
    let mut extra = BTreeMap::new();
    extra.insert("ImageUrl".into(), image_url.into());
    extra.insert("Scale".into(), scale.to_string());
    extra.insert("OutputFormat".into(), "png".into());
    extra.insert("OutputQuality".into(), "100".into());

    let json = aliyun_rpc_post(
        client,
        IMAGEENHAN_ENDPOINT,
        IMAGEENHAN_API_VERSION,
        access_key_id,
        access_key_secret,
        "GenerateSuperResolutionImage",
        extra,
    )
    .await?;

    if let Some(result_url) = find_url_in_json(&json["Data"]["ResultUrl"]) {
        return Ok((SubmitResult::DirectUrl(result_url), json));
    }

    let job_id = json["Data"]["JobId"]
        .as_str()
        .or_else(|| json["RequestId"].as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| {
            format!(
                "GenerateSuperResolutionImage 响应缺少 ResultUrl、JobId 或 RequestId: {}",
                json
            )
        })?;
    Ok((SubmitResult::AsyncJob(job_id), json))
}

// Step 4：轮询异步任务（每 2 秒一次，最多 180 秒）
async fn poll_super_resolution(
    client: &reqwest::Client,
    access_key_id: &str,
    access_key_secret: &str,
    job_id: &str,
) -> Result<(String, Vec<serde_json::Value>), String> {
    let mut responses = Vec::new();
    for _ in 0..90u32 {
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

        let mut extra = BTreeMap::new();
        extra.insert("JobId".into(), job_id.into());

        let json = aliyun_rpc_post(
            client,
            IMAGEENHAN_ENDPOINT,
            IMAGEENHAN_API_VERSION,
            access_key_id,
            access_key_secret,
            "GetAsyncJobResult",
            extra,
        )
        .await?;

        match json["Data"]["Status"].as_str().unwrap_or("") {
            "PROCESS_SUCCESS" => {
                let result_url = find_url_in_json(&json["Data"]["Result"])
                    .or_else(|| find_url_in_json(&json["Data"]["ResultUrl"]))
                    .ok_or_else(|| format!("结果缺少 Result URL: {}", json))?;
                responses.push(json);
                return Ok((result_url, responses));
            }
            "PROCESS_FAILED" => {
                let msg = json["Data"]["ErrorMessage"].as_str().unwrap_or("未知原因");
                return Err(format!("超分任务失败: {}", msg));
            }
            _ => responses.push(json), // PROCESSING，继续轮询
        }
    }

    Err(format!(
        "超分任务超时（180 秒无结果），轮询响应: {}",
        serde_json::json!(responses)
    ))
}

async fn download_aliyun_result_image(
    client: &reqwest::Client,
    result_url: reqwest::Url,
) -> Result<Vec<u8>, String> {
    let mut last_error = String::new();

    for attempt in 0..=ALIYUN_RESULT_DOWNLOAD_RETRY_DELAYS_MS.len() {
        match client.get(result_url.clone()).send().await {
            Ok(response) => {
                let status = response.status();
                if status.is_success() {
                    match response.bytes().await {
                        Ok(bytes) => return Ok(bytes.to_vec()),
                        Err(error) => last_error = format!("读取结果数据失败: {}", error),
                    }
                } else {
                    let body = response.text().await.unwrap_or_default();
                    let error = format!("下载结果图片失败 HTTP {}: {}", status.as_u16(), body);
                    if !status.is_server_error() {
                        return Err(error);
                    }
                    last_error = error;
                }
            }
            Err(error) => last_error = format!("下载结果图片失败: {}", error),
        }

        if let Some(delay) = ALIYUN_RESULT_DOWNLOAD_RETRY_DELAYS_MS.get(attempt) {
            sleep(Duration::from_millis(*delay)).await;
        }
    }

    Err(format!(
        "{}（已重试 {} 次）",
        last_error,
        ALIYUN_RESULT_DOWNLOAD_RETRY_DELAYS_MS.len()
    ))
}

// 阿里云超分 Tauri 命令
#[tauri::command]
async fn aliyun_upscale(
    app: AppHandle,
    access_key_id: String,
    access_key_secret: String,
    image_base64: String,
    target_width: u32,
    target_height: u32,
) -> Result<serde_json::Value, String> {
    let image_bytes = STANDARD
        .decode(&image_base64)
        .map_err(|e| format!("base64 解码失败: {}", e))?;
    let (orig_w, _) = validate_aliyun_upscale_input(&image_bytes)?;

    let ratio = target_width as f64 / orig_w.max(1) as f64;
    let scale = (ratio.round() as u32).clamp(1, 4);

    let client = reqwest::Client::new();

    // 1. 获取 OSS 表单上传授权
    let (token, authorize_json) =
        authorize_file_upload(&client, &access_key_id, &access_key_secret).await?;

    // 2. 上传原图
    let (oss_url, upload_json) = oss_post_object(&client, &token, image_bytes).await?;

    // 3. 提交超分任务
    let (submit_result, submit_json) =
        submit_super_resolution(&client, &access_key_id, &access_key_secret, &oss_url, scale)
            .await?;

    // 4. 获取结果 URL；如果接口直接返回 ResultUrl，则不再轮询
    let (result_url, poll_json) = match submit_result {
        SubmitResult::DirectUrl(url) => (url, Vec::new()),
        SubmitResult::AsyncJob(job_id) => {
            poll_super_resolution(&client, &access_key_id, &access_key_secret, &job_id).await?
        }
    };

    // 5. 下载超分后图片
    let result_url = clean_result_url(&result_url);
    let parsed_result_url = reqwest::Url::parse(&result_url)
        .map_err(|e| format!("结果图片 URL 无效: {}，原始值: {}", e, result_url))?;
    let result_bytes = download_aliyun_result_image(&client, parsed_result_url).await?;

    // 6. 解析结果尺寸，保存到历史目录
    let (result_w, result_h) =
        image_dimensions(&result_bytes).unwrap_or((target_width, target_height));
    let timestamp = now_millis() as i64;
    let image_dir = history_images_dir(&app, timestamp)?;
    let file_name = format!("{}_upscale_{}x.png", timestamp, scale);
    let dir_name = image_dir
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("default");
    let relative_path = format!("images/{}/{}", dir_name, file_name).replace('\\', "/");

    fs::write(image_dir.join(&file_name), &result_bytes)
        .map_err(|e| format!("写入超分图片失败: {}", e))?;

    Ok(serde_json::json!({
      "image_base64": STANDARD.encode(&result_bytes),
      "width": result_w,
      "height": result_h,
      "local_path": relative_path,
      "scale": scale,
      "response_json": serde_json::json!({
        "authorizeFileUpload": authorize_json,
        "uploadObject": upload_json,
        "generateSuperResolutionImage": submit_json,
        "getAsyncJobResult": poll_json,
        "result": {
          "url": result_url,
          "width": result_w,
          "height": result_h,
          "localPath": relative_path,
          "scale": scale
        }
      })
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if let (Some(window), Some(icon)) = (
                app.get_webview_window("main"),
                app.default_window_icon().cloned(),
            ) {
                let _ = window.set_icon(icon);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_app_config,
            save_app_config,
            select_history_directory,
            open_history_directory,
            get_history_root_dir,
            save_image_file,
            save_image_files_to_directory,
            add_history_record,
            set_history_record_favorite,
            save_history_upscale_variant,
            save_history_thumbnails,
            list_history_records,
            list_history_records_page,
            get_history_overview,
            get_history_record,
            delete_history_record,
            clear_history_records,
            clear_unfavorite_history_records,
            get_history_storage_usage,
            enforce_history_storage_limit,
            aliyun_upscale
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
