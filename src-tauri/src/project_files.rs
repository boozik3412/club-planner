use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePayload {
    pub path: String,
    pub contents: String,
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

    fs::write(&temporary, contents.as_bytes())
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

fn read_payload(path: PathBuf, allowed: &[&str]) -> Result<FilePayload, String> {
    check_extension(&path, allowed)?;
    let contents =
        fs::read_to_string(&path).map_err(|error| format!("Не удалось прочитать файл: {error}"))?;
    Ok(FilePayload {
        path: path.to_string_lossy().into_owned(),
        contents,
    })
}

#[tauri::command]
pub fn read_project_file(path: String) -> Result<FilePayload, String> {
    read_payload(PathBuf::from(path), &["clubplan", "json"])
}

#[tauri::command]
pub fn write_project_file(path: String, contents: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    check_extension(&path, &["clubplan"])?;
    atomic_write(&path, &contents)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn write_svg_file(path: String, contents: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    check_extension(&path, &["svg"])?;
    atomic_write(&path, &contents)?;
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
    use super::{atomic_write, check_extension};
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
}
