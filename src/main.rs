mod tui;
mod core;
mod agents;
mod tools;

use core::{AppConfig, SessionManager};
use agents::SwarmOrchestrator;
use tools::WorkspaceTools;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("Starting ArrowCode premium minimal Rust TUI...");

    // Load configurations and session systems
    let _config = AppConfig::load();
    let session_mgr = SessionManager::new(".");
    let tools = WorkspaceTools::new(".");
    let mut orchestrator = SwarmOrchestrator::new();

    if let Some(prompt) = tui::run_interactive_loop()? {
        if !prompt.is_empty() {
            println!("Initializing session with prompt: {}", prompt);
            let session_path = session_mgr.create_session("my-feature")?;
            println!("Created active session workspace under: {:?}", session_path);

            // Step 1: Run Orchestrator
            if let Some(orch) = orchestrator.agents.get_mut("orchestrator") {
                let plan = orch.chat(&prompt).await?;
                println!("\n[ORCHESTRATOR] {}", plan);
            }

            // Step 2: Trigger Backend/Frontend changes
            if let Some(be) = orchestrator.agents.get_mut("backend") {
                let be_reply = be.chat("Implement backend modules").await?;
                println!("\n[BACKEND] {}", be_reply);
                // Simulate a file write
                tools.write_file("ARROW.md", "## ArrowCode Project Status\n- Subsystems loaded successfully.\n")?;
                println!("[SYSTEM] Wrote ARROW.md dynamically.");
            }

            // Step 3: Run Diagnostics
            let output = tools.execute_bash("cargo check")?;
            println!("\n[DIAGNOSTICS] Run result of 'cargo check':\n{}", output);

            println!("\nGoal completed successfully!");
        } else {
            println!("Starting new worktree session...");
        }
    } else {
        println!("Exiting ArrowCode gracefully. Goodbye!");
    }
    Ok(())
}
