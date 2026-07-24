use std::fs;
use std::path::Path;
use std::process::Command;

pub struct WorkspaceTools {
    pub root: std::path::PathBuf,
}

impl WorkspaceTools {
    pub fn new<P: AsRef<Path>>(root: P) -> Self {
        Self {
            root: root.as_ref().to_path_buf(),
        }
    }

    pub fn read_file(&self, rel_path: &str) -> std::io::Result<String> {
        let full_path = self.root.join(rel_path);
        fs::read_to_string(full_path)
    }

    pub fn write_file(&self, rel_path: &str, content: &str) -> std::io::Result<()> {
        let full_path = self.root.join(rel_path);
        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(full_path, content)
    }

    pub fn execute_bash(&self, command: &str) -> std::io::Result<String> {
        let output = if cfg!(target_os = "windows") {
            Command::new("powershell")
                .arg("-Command")
                .arg(command)
                .current_dir(&self.root)
                .output()?
        } else {
            Command::new("bash")
                .arg("-c")
                .arg(command)
                .current_dir(&self.root)
                .output()?
        };

        let out = String::from_utf8_lossy(&output.stdout).to_string();
        let err = String::from_utf8_lossy(&output.stderr).to_string();

        if output.status.success() {
            Ok(out)
        } else {
            Ok(format!("Execution Error:\n{}\n{}", out, err))
        }
    }
}
