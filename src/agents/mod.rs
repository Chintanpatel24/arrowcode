use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Debug)]
pub struct AgentWorker {
    pub name: String,
    pub provider: String,
    pub model: String,
    pub history: Vec<Message>,
}

impl AgentWorker {
    pub fn new(name: &str, provider: &str, model: &str) -> Self {
        Self {
            name: name.to_string(),
            provider: provider.to_string(),
            model: model.to_string(),
            history: Vec::new(),
        }
    }

    pub async fn chat(&mut self, user_message: &str) -> Result<String, Box<dyn std::error::Error>> {
        self.history.push(Message {
            role: "user".to_string(),
            content: user_message.to_string(),
        });

        // Simple simulated assistant responses for offline and fast mock mode
        let simulated_reply = match self.name.as_str() {
            "orchestrator" => format!("ORCHESTRATOR: Drafting execution plan for task: '{}'", user_message),
            "frontend" => "FRONTEND: Implementing UI/TUI components according to plan.".to_string(),
            "backend" => "BACKEND: Constructing application APIs, schemas, and endpoints.".to_string(),
            _ => "QA: Testing changes and running workspace diagnostics.".to_string(),
        };

        self.history.push(Message {
            role: "assistant".to_string(),
            content: simulated_reply.clone(),
        });

        Ok(simulated_reply)
    }
}

pub struct SwarmOrchestrator {
    pub agents: HashMap<String, AgentWorker>,
}

impl SwarmOrchestrator {
    pub fn new() -> Self {
        let mut agents = HashMap::new();
        agents.insert("orchestrator".to_string(), AgentWorker::new("orchestrator", "openai", "gpt-4"));
        agents.insert("frontend".to_string(), AgentWorker::new("frontend", "openai", "gpt-4"));
        agents.insert("backend".to_string(), AgentWorker::new("backend", "openai", "gpt-4"));
        agents.insert("qa".to_string(), AgentWorker::new("qa", "openai", "gpt-4"));

        Self { agents }
    }
}
