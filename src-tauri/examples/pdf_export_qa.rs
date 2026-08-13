use club_planner_lib::project_files::svg_to_pdf_bytes;
use std::env;
use std::fs;
use std::path::PathBuf;

fn fit_svg_to_a4(source: &str) -> Result<String, String> {
    let root_start = source
        .find("<svg")
        .ok_or_else(|| "В SVG нет корневого элемента".to_string())?;
    let root_end = source[root_start..]
        .find('>')
        .map(|offset| root_start + offset)
        .ok_or_else(|| "Не удалось разобрать корневой SVG".to_string())?;
    let closing = source
        .rfind("</svg>")
        .ok_or_else(|| "SVG не закрыт".to_string())?;
    let root = &source[root_start..=root_end];
    let attribute = |name: &str| -> Result<f32, String> {
        let marker = format!("{name}=\"");
        let start = root
            .find(&marker)
            .ok_or_else(|| format!("Нет атрибута {name}"))?
            + marker.len();
        let end = root[start..]
            .find('"')
            .ok_or_else(|| format!("Некорректный {name}"))?
            + start;
        root[start..end]
            .parse::<f32>()
            .map_err(|error| format!("Некорректный {name}: {error}"))
    };
    let width = attribute("width")?;
    let height = attribute("height")?;
    let page_width = 1122.0_f32;
    let page_height = 793.0_f32;
    let margin = 28.0_f32;
    let scale = ((page_width - 2.0 * margin) / width).min((page_height - 2.0 * margin) / height);
    let content_width = width * scale;
    let content_height = height * scale;
    let x = (page_width - content_width) / 2.0;
    let y = (page_height - content_height) / 2.0;
    Ok(format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{page_width}" height="{page_height}" viewBox="0 0 {page_width} {page_height}"><rect width="{page_width}" height="{page_height}" fill="white"/><svg x="{x}" y="{y}" width="{content_width}" height="{content_height}" viewBox="0 0 {width} {height}" preserveAspectRatio="xMidYMid meet">{}</svg></svg>"#,
        &source[root_end + 1..closing]
    ))
}

fn main() -> Result<(), String> {
    let mut arguments = env::args_os().skip(1);
    let input = arguments
        .next()
        .map(PathBuf::from)
        .ok_or_else(|| "Укажите исходный SVG".to_string())?;
    let output = arguments
        .next()
        .map(PathBuf::from)
        .ok_or_else(|| "Укажите итоговый PDF".to_string())?;
    let svg = fs::read_to_string(&input)
        .map_err(|error| format!("Не удалось прочитать {}: {error}", input.display()))?;
    let pdf = svg_to_pdf_bytes(&fit_svg_to_a4(&svg)?)?;
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Не удалось создать {}: {error}", parent.display()))?;
    }
    fs::write(&output, pdf)
        .map_err(|error| format!("Не удалось записать {}: {error}", output.display()))?;
    println!("{}", output.display());
    Ok(())
}
