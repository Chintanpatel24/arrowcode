use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub provider: String,
    pub model: String,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub default_provider: String,
    pub default_model: String,
    pub agents: std::collections::HashMap<String, AgentConfig>,
}

impl AppConfig {
    pub fn load() -> Self {
        // Simple loading of default configurations
        let mut agents = std::collections::HashMap::new();
        agents.insert(
            "orchestrator".to_string(),
            AgentConfig {
                provider: "openai".to_string(),
                model: "gpt-4".to_string(),
                api_key: None,
            },
        );
        agents.insert(
            "frontend".to_string(),
            AgentConfig {
                provider: "openai".to_string(),
                model: "gpt-4".to_string(),
                api_key: None,
            },
        );
        agents.insert(
            "backend".to_string(),
            AgentConfig {
                provider: "openai".to_string(),
                model: "gpt-4".to_string(),
                api_key: None,
            },
        );
        agents.insert(
            "qa".to_string(),
            AgentConfig {
                provider: "openai".to_string(),
                model: "gpt-4".to_string(),
                api_key: None,
            },
        );

        Self {
            default_provider: "openai".to_string(),
            default_model: "gpt-4".to_string(),
            agents,
        }
    }
}

pub struct SessionManager {
    pub workspace_root: PathBuf,
    pub sessions_dir: PathBuf,
}

impl SessionManager {
    pub fn new<P: AsRef<Path>>(workspace: P) -> Self {
        let root = workspace.as_ref().to_path_buf();
        let sessions = root.join(".arrowcode-sessions");
        let _ = fs::create_dir_all(&sessions);
        Self {
            workspace_root: root,
            sessions_dir: sessions,
        }
    }

    pub fn create_session(&self, name: &str) -> io::Result<PathBuf> {
        let session_path = self.sessions_dir.join(name);
        fs::create_dir_all(&session_path)?;
        Ok(session_path)
    }
}

use std::io;
