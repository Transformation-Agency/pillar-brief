fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new()
                .commands(&["save_text_file", "save_binary_file"]),
        ),
    )
    .expect("failed to build Tauri app");
}
