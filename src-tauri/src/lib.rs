mod project_files;

use tauri_plugin_window_state::{AppHandleExt, StateFlags};

#[tauri::command]
fn exit_application(app: tauri::AppHandle) -> Result<(), String> {
    app.save_window_state(StateFlags::all())
        .map_err(|error| format!("не удалось сохранить состояние окна: {error}"))?;
    app.cleanup_before_exit();
    std::process::exit(0)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            project_files::read_project_file,
            project_files::write_project_file,
            project_files::write_svg_file,
            project_files::write_recovery,
            project_files::read_recovery,
            project_files::clear_recovery,
            exit_application,
        ])
        .run(tauri::generate_context!())
        .expect("не удалось запустить Club Planner");
}

#[cfg(test)]
mod tests {
    #[test]
    fn application_name_is_stable() {
        assert_eq!(env!("CARGO_PKG_NAME"), "club-planner");
    }
}
