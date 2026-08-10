#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
