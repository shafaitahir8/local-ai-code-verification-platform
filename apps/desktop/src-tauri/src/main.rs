#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    local_code_verifier_lib::run();
}
