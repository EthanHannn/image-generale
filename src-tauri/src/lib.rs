use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::Utc;
use hmac::{Hmac, Mac};
use rfd::FileDialog;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
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
            upscale_providers: Vec::new(),
            current_upscale_provider_id: String::new(),
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

fn row_to_history_payload(
    app: &AppHandle,
    row: &rusqlite::Row<'_>,
) -> Result<HistoryRecordPayload, String> {
    let params_json: String = row.get("params_json").map_err(|error| error.to_string())?;
    let images_json: String = row.get("images_json").map_err(|error| error.to_string())?;
    let params =
        serde_json::from_str::<RequestParams>(&params_json).map_err(|error| error.to_string())?;
    let images_base64 = read_history_images(app, &images_json)?;

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

    let mut rows = statement
        .query(params![id])
        .map_err(|error| error.to_string())?;
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
    let images_dir = history_root_dir(&app)?.join("images");
    if images_dir.exists() {
        fs::remove_dir_all(&images_dir).map_err(|error| error.to_string())?;
    }

    connection
        .execute("DELETE FROM history_records", [])
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
fn get_history_storage_usage(app: AppHandle) -> Result<i64, String> {
    directory_size(&history_root_dir(&app)?)
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
        let (id, _) = row.map_err(|error| error.to_string())?;
        if total <= max_storage {
            break;
        }
        delete_history_record(app.clone(), id)?;
        total = get_history_storage_usage(app.clone())?;
    }

    Ok(())
}

// ===================== 阿里云超分 =====================

const IMAGEENHAN_ENDPOINT: &str = "imageenhan.cn-shanghai.aliyuncs.com";
const IMAGEENHAN_API_VERSION: &str = "2019-09-30";
const OPENPLATFORM_ENDPOINT: &str = "openplatform.aliyuncs.com";
const OPENPLATFORM_API_VERSION: &str = "2019-12-19";
const ALIYUN_REGION_ID: &str = "cn-shanghai";

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

// 解析 PNG IHDR 头部获取原始尺寸
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
            for key in ["ResultUrl", "resultUrl", "result_url", "Result", "result", "Url", "url", "ImageUrl", "imageUrl"] {
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
        .ok_or_else(|| format!("GenerateSuperResolutionImage 响应缺少 ResultUrl、JobId 或 RequestId: {}", json))?;
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

    Err(format!("超分任务超时（180 秒无结果），轮询响应: {}", serde_json::json!(responses)))
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

    // 从 PNG 头部推算放大倍数
    let scale = if let Some((orig_w, _)) = png_dimensions(&image_bytes) {
        let ratio = target_width as f64 / orig_w.max(1) as f64;
        (ratio.round() as u32).min(4).max(2)
    } else {
        2
    };

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
    let result_resp = client
        .get(parsed_result_url)
        .send()
        .await
        .map_err(|e| format!("下载结果图片失败: {}", e))?;
    let result_status = result_resp.status();
    if !result_status.is_success() {
        let body = result_resp.text().await.unwrap_or_default();
        return Err(format!(
            "下载结果图片失败 HTTP {}: {}",
            result_status.as_u16(),
            body
        ));
    }
    let result_bytes = result_resp
        .bytes()
        .await
        .map_err(|e| format!("读取结果数据失败: {}", e))?
        .to_vec();

    // 6. 解析结果尺寸，保存到历史目录
    let (result_w, result_h) =
        png_dimensions(&result_bytes).unwrap_or((target_width, target_height));
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
            enforce_history_storage_limit,
            aliyun_upscale
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
