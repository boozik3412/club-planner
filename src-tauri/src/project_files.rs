use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

const PROJECT_MIME: &str = "application/vnd.clubplanner.project+zip";
const MAX_PROJECT_JSON_BYTES: u64 = 16 * 1024 * 1024;
const MAX_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 256;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePayload {
    pub path: String,
    pub contents: String,
    pub assets: Vec<ProjectAssetPayload>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryFilePayload {
    pub path: String,
    pub name: String,
    pub mime_type: String,
    pub data_base64: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAssetPayload {
    pub path: String,
    pub mime_type: String,
    pub data_base64: String,
}

fn check_extension(path: &Path, allowed: &[&str]) -> Result<(), String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "У файла отсутствует расширение".to_string())?;
    if allowed.iter().any(|allowed| extension == *allowed) {
        Ok(())
    } else {
        Err(format!(
            "Неподдерживаемое расширение .{extension}; ожидается {}",
            allowed
                .iter()
                .map(|value| format!(".{value}"))
                .collect::<Vec<_>>()
                .join(" или ")
        ))
    }
}

fn atomic_write(path: &Path, contents: &str) -> Result<(), String> {
    atomic_write_bytes(path, contents.as_bytes())
}

fn atomic_write_bytes(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Не удалось определить папку файла".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("Не удалось создать папку: {error}"))?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Некорректное имя файла".to_string())?;
    let temporary = parent.join(format!(".{file_name}.tmp"));
    let backup = parent.join(format!(".{file_name}.bak"));

    fs::write(&temporary, contents)
        .map_err(|error| format!("Не удалось записать временный файл: {error}"))?;

    if path.exists() {
        let _ = fs::remove_file(&backup);
        fs::rename(path, &backup)
            .map_err(|error| format!("Не удалось подготовить замену файла: {error}"))?;
    }

    if let Err(error) = fs::rename(&temporary, path) {
        if backup.exists() {
            let _ = fs::rename(&backup, path);
        }
        let _ = fs::remove_file(&temporary);
        return Err(format!("Не удалось завершить сохранение: {error}"));
    }

    if backup.exists() {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

pub fn svg_to_pdf_bytes(contents: &str) -> Result<Vec<u8>, String> {
    let mut options = svg2pdf::usvg::Options::default();
    options.fontdb_mut().load_system_fonts();
    let tree = svg2pdf::usvg::Tree::from_str(contents, &options)
        .map_err(|error| format!("Не удалось разобрать SVG для PDF: {error}"))?;
    svg2pdf::to_pdf(
        &tree,
        svg2pdf::ConversionOptions {
            embed_text: false,
            ..Default::default()
        },
        svg2pdf::PageOptions { dpi: 96.0 },
    )
    .map_err(|error| format!("Не удалось сформировать PDF: {error}"))
}

fn validate_archive_path(value: &str) -> Result<(), String> {
    let normalized = value.replace('\\', "/");
    if normalized.starts_with('/')
        || normalized.is_empty()
        || normalized
            .split('/')
            .any(|part| part.is_empty() || part == ".." || part == ".")
        || !(normalized.starts_with("sources/") || normalized.starts_with("previews/"))
    {
        return Err(format!("Небезопасный путь ресурса проекта: {value}"));
    }
    Ok(())
}

fn mime_from_path(path: &str) -> &'static str {
    match Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

fn declared_source_checksums(contents: &str) -> Result<Vec<(String, String)>, String> {
    let parsed: serde_json::Value = serde_json::from_str(contents)
        .map_err(|error| format!("Проект содержит некорректный JSON: {error}"))?;
    let Some(sources) = parsed.get("planSources").and_then(|value| value.as_array()) else {
        return Ok(Vec::new());
    };
    sources
        .iter()
        .filter(|source| source.get("kind").and_then(|value| value.as_str()) != Some("bundled-svg"))
        .map(|source| {
            let path = source
                .get("embeddedPath")
                .and_then(|value| value.as_str())
                .ok_or_else(|| "Источник проекта не содержит embeddedPath".to_string())?;
            validate_archive_path(path)?;
            let checksum = source
                .get("sha256")
                .and_then(|value| value.as_str())
                .ok_or_else(|| format!("Источник {path} не содержит SHA-256"))?
                .to_ascii_lowercase();
            if checksum.len() != 64
                || !checksum
                    .chars()
                    .all(|character| character.is_ascii_hexdigit())
            {
                return Err(format!("Источник {path} содержит некорректный SHA-256"));
            }
            Ok((path.replace('\\', "/"), checksum))
        })
        .collect()
}

fn verify_source_checksums(contents: &str, assets: &[(String, Vec<u8>)]) -> Result<(), String> {
    for (path, expected) in declared_source_checksums(contents)? {
        let data = assets
            .iter()
            .find_map(|(asset_path, data)| (asset_path == &path).then_some(data))
            .ok_or_else(|| format!("В контейнере отсутствует исходник {path}"))?;
        let actual = format!("{:x}", Sha256::digest(data));
        if actual != expected {
            return Err(format!("Контрольная сумма исходника {path} не совпадает"));
        }
    }
    Ok(())
}

fn build_project_archive(
    contents: &str,
    assets: &[ProjectAssetPayload],
) -> Result<Vec<u8>, String> {
    let parsed: serde_json::Value = serde_json::from_str(contents)
        .map_err(|error| format!("Проект содержит некорректный JSON: {error}"))?;
    if parsed.get("format").and_then(|value| value.as_str()) != Some("clubplan")
        || parsed.get("formatVersion").and_then(|value| value.as_u64()) != Some(4)
    {
        return Err("В ZIP-контейнер можно сохранить только проект Club Planner v4".to_string());
    }
    if contents.len() as u64 > MAX_PROJECT_JSON_BYTES {
        return Err("project.json превышает безопасный размер 16 МБ".to_string());
    }
    if assets.len().saturating_add(2) > MAX_ARCHIVE_ENTRIES {
        return Err("В проекте слишком много вложенных файлов".to_string());
    }
    let mut seen = HashSet::new();
    let mut decoded_assets = Vec::with_capacity(assets.len());
    let mut total_size = contents.len() as u64;
    for asset in assets {
        validate_archive_path(&asset.path)?;
        if !seen.insert(asset.path.replace('\\', "/")) {
            return Err(format!("Ресурс {} добавлен в проект дважды", asset.path));
        }
        let decoded = BASE64
            .decode(&asset.data_base64)
            .map_err(|_| format!("Ресурс {} содержит некорректный Base64", asset.path))?;
        total_size = total_size.saturating_add(decoded.len() as u64);
        if total_size > MAX_ARCHIVE_BYTES {
            return Err("Ресурсы проекта превышают безопасный размер 512 МБ".to_string());
        }
        decoded_assets.push((asset.path.replace('\\', "/"), decoded));
    }
    verify_source_checksums(contents, &decoded_assets)?;

    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    writer
        .start_file(
            "mimetype",
            SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
        )
        .map_err(|error| format!("Не удалось создать контейнер проекта: {error}"))?;
    writer
        .write_all(PROJECT_MIME.as_bytes())
        .map_err(|error| format!("Не удалось записать тип контейнера: {error}"))?;
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    writer
        .start_file("project.json", options)
        .map_err(|error| format!("Не удалось создать project.json: {error}"))?;
    writer
        .write_all(contents.as_bytes())
        .map_err(|error| format!("Не удалось записать project.json: {error}"))?;
    for (path, data) in decoded_assets {
        writer
            .start_file(path, options)
            .map_err(|error| format!("Не удалось добавить ресурс: {error}"))?;
        writer
            .write_all(&data)
            .map_err(|error| format!("Не удалось записать ресурс: {error}"))?;
    }
    writer
        .finish()
        .map(|cursor| cursor.into_inner())
        .map_err(|error| format!("Не удалось завершить контейнер проекта: {error}"))
}

fn read_project_archive(bytes: Vec<u8>) -> Result<(String, Vec<ProjectAssetPayload>), String> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| format!("Повреждённый контейнер .clubplan: {error}"))?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err("В проекте слишком много вложенных файлов".to_string());
    }
    let mut total_size = 0_u64;
    let mut contents = None;
    let mut assets = Vec::new();
    let mut decoded_assets = Vec::new();
    let mut seen_names = HashSet::new();
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Не удалось прочитать запись ZIP: {error}"))?;
        if entry.is_dir() {
            continue;
        }
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| "ZIP содержит небезопасный путь".to_string())?;
        let name = enclosed.to_string_lossy().replace('\\', "/");
        if !seen_names.insert(name.clone()) {
            return Err(format!("ZIP содержит повторяющуюся запись {name}"));
        }
        total_size = total_size.saturating_add(entry.size());
        if total_size > MAX_ARCHIVE_BYTES {
            return Err("Распакованный проект превышает безопасный размер 512 МБ".to_string());
        }
        if name == "mimetype" {
            let mut mime = String::new();
            entry
                .read_to_string(&mut mime)
                .map_err(|error| format!("Не удалось прочитать mimetype: {error}"))?;
            if mime != PROJECT_MIME {
                return Err("Файл не является контейнером Club Planner".to_string());
            }
        } else if name == "project.json" {
            if entry.size() > MAX_PROJECT_JSON_BYTES {
                return Err("project.json превышает безопасный размер 16 МБ".to_string());
            }
            let mut json = String::new();
            entry
                .read_to_string(&mut json)
                .map_err(|error| format!("project.json не является UTF-8 JSON: {error}"))?;
            contents = Some(json);
        } else {
            validate_archive_path(&name)?;
            let mut data = Vec::with_capacity(entry.size() as usize);
            entry
                .read_to_end(&mut data)
                .map_err(|error| format!("Не удалось прочитать ресурс {name}: {error}"))?;
            assets.push(ProjectAssetPayload {
                path: name.clone(),
                mime_type: mime_from_path(&name).to_string(),
                data_base64: BASE64.encode(&data),
            });
            decoded_assets.push((name, data));
        }
    }
    let contents = contents.ok_or_else(|| "В контейнере отсутствует project.json".to_string())?;
    verify_source_checksums(&contents, &decoded_assets)?;
    Ok((contents, assets))
}

fn read_payload(path: PathBuf, allowed: &[&str]) -> Result<FilePayload, String> {
    check_extension(&path, allowed)?;
    let bytes = fs::read(&path).map_err(|error| format!("Не удалось прочитать файл: {error}"))?;
    let (contents, assets) = if bytes.starts_with(b"PK") {
        read_project_archive(bytes)?
    } else {
        (
            String::from_utf8(bytes).map_err(|_| {
                "Файл проекта не является UTF-8 JSON или ZIP-контейнером".to_string()
            })?,
            Vec::new(),
        )
    };
    Ok(FilePayload {
        path: path.to_string_lossy().into_owned(),
        contents,
        assets,
    })
}

#[tauri::command]
pub fn read_project_file(path: String) -> Result<FilePayload, String> {
    read_payload(PathBuf::from(path), &["clubplan", "json"])
}

#[tauri::command]
pub fn read_plan_source(path: String) -> Result<BinaryFilePayload, String> {
    const MAX_SOURCE_BYTES: u64 = 128 * 1024 * 1024;
    let path = PathBuf::from(path);
    check_extension(&path, &["pdf", "png", "jpg", "jpeg"])?;
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Не удалось проверить исходный план: {error}"))?;
    if metadata.len() > MAX_SOURCE_BYTES {
        return Err("Исходный план превышает безопасный размер 128 МБ".to_string());
    }
    let data =
        fs::read(&path).map_err(|error| format!("Не удалось прочитать исходный план: {error}"))?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Некорректное имя исходного плана".to_string())?
        .to_string();
    Ok(BinaryFilePayload {
        path: path.to_string_lossy().into_owned(),
        name,
        mime_type: mime_from_path(path.to_string_lossy().as_ref()).to_string(),
        data_base64: BASE64.encode(data),
    })
}

#[tauri::command]
pub fn write_project_file(
    path: String,
    contents: String,
    assets: Option<Vec<ProjectAssetPayload>>,
) -> Result<String, String> {
    let path = PathBuf::from(path);
    check_extension(&path, &["clubplan"])?;
    let archive = build_project_archive(&contents, assets.as_deref().unwrap_or_default())?;
    atomic_write_bytes(&path, &archive)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn write_svg_file(path: String, contents: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    check_extension(&path, &["svg"])?;
    atomic_write(&path, &contents)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn write_pdf_file(path: String, contents: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    check_extension(&path, &["pdf"])?;
    let pdf = svg_to_pdf_bytes(&contents)?;
    atomic_write_bytes(&path, &pdf)?;
    Ok(path.to_string_lossy().into_owned())
}

fn recovery_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("recovery.clubplan.autosave"))
        .map_err(|error| format!("Не удалось определить папку восстановления: {error}"))
}

#[tauri::command]
pub fn write_recovery(app: AppHandle, contents: String) -> Result<(), String> {
    atomic_write(&recovery_path(&app)?, &contents)
}

#[tauri::command]
pub fn read_recovery(app: AppHandle) -> Result<Option<String>, String> {
    let path = recovery_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path)
        .map(Some)
        .map_err(|error| format!("Не удалось прочитать автосохранение: {error}"))
}

#[tauri::command]
pub fn clear_recovery(app: AppHandle) -> Result<(), String> {
    let path = recovery_path(&app)?;
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("Не удалось удалить автосохранение: {error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        atomic_write, build_project_archive, check_extension, read_project_archive,
        svg_to_pdf_bytes, ProjectAssetPayload,
    };
    use std::fs;
    use std::path::Path;

    #[test]
    fn restricts_project_extensions() {
        assert!(check_extension(Path::new("layout.clubplan"), &["clubplan"]).is_ok());
        assert!(check_extension(Path::new("layout.exe"), &["clubplan"]).is_err());
    }

    #[test]
    fn atomically_replaces_text_file() {
        let path =
            std::env::temp_dir().join(format!("club-planner-test-{}.clubplan", std::process::id()));
        atomic_write(&path, "first").expect("first write");
        atomic_write(&path, "second").expect("second write");
        assert_eq!(fs::read_to_string(&path).expect("read"), "second");
        fs::remove_file(path).expect("cleanup");
    }

    #[test]
    fn converts_a_landscape_svg_with_cyrillic_text_to_pdf() {
        let pdf = svg_to_pdf_bytes(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><rect width="400" height="200" fill="white"/><text x="20" y="100" font-family="Arial" font-size="28">План клуба</text></svg>"#,
        )
        .expect("pdf conversion");
        assert!(pdf.starts_with(b"%PDF-"));
        assert!(pdf.len() > 500);
    }

    #[test]
    fn round_trips_safe_v4_project_archive() {
        let json = r#"{"format":"clubplan","formatVersion":4}"#;
        let archive = build_project_archive(
            json,
            &[ProjectAssetPayload {
                path: "sources/plan.png".to_string(),
                mime_type: "image/png".to_string(),
                data_base64: "iVBORw0KGgo=".to_string(),
            }],
        )
        .expect("archive");
        assert!(archive.starts_with(b"PK"));
        let (decoded, assets) = read_project_archive(archive).expect("read archive");
        assert_eq!(decoded, json);
        assert_eq!(assets.len(), 1);
        assert_eq!(assets[0].path, "sources/plan.png");
    }

    #[test]
    fn rejects_archive_path_traversal() {
        let result = build_project_archive(
            r#"{"format":"clubplan","formatVersion":4}"#,
            &[ProjectAssetPayload {
                path: "sources/../escape.png".to_string(),
                mime_type: "image/png".to_string(),
                data_base64: String::new(),
            }],
        );
        assert!(result.is_err());
    }

    #[test]
    fn rejects_a_missing_or_modified_embedded_source() {
        let json = format!(
            r#"{{"format":"clubplan","formatVersion":4,"planSources":[{{"kind":"image","embeddedPath":"sources/plan.png","sha256":"{}"}}]}}"#,
            "0".repeat(64)
        );
        let result = build_project_archive(
            &json,
            &[ProjectAssetPayload {
                path: "sources/plan.png".to_string(),
                mime_type: "image/png".to_string(),
                data_base64: "aW52YWxpZA==".to_string(),
            }],
        );
        assert!(result
            .expect_err("checksum mismatch")
            .contains("Контрольная сумма"));
    }

    #[test]
    fn rejects_corrupted_and_duplicate_zip_entries() {
        assert!(read_project_archive(b"PK-not-a-zip".to_vec()).is_err());
        let duplicate = ProjectAssetPayload {
            path: "sources/plan.png".to_string(),
            mime_type: "image/png".to_string(),
            data_base64: "b25l".to_string(),
        };
        assert!(build_project_archive(
            r#"{"format":"clubplan","formatVersion":4}"#,
            &[duplicate.clone(), duplicate]
        )
        .expect_err("duplicate")
        .contains("дважды"));
    }
}
