use std::io::{self, Write};
use std::time::Duration;
use crossterm::{
    cursor,
    event::{self, Event, KeyCode, KeyModifiers},
    execute,
    style::Stylize,
    terminal::{self, ClearType},
};

pub struct TuiState {
    pub selected_index: usize,
    pub input_value: String,
}

impl TuiState {
    pub fn new() -> Self {
        Self {
            selected_index: 0,
            input_value: String::new(),
        }
    }
}

pub fn draw_home(stdout: &mut io::Stdout, state: &TuiState) -> io::Result<()> {
    // Clear terminal screen completely
    execute!(
        stdout,
        terminal::Clear(ClearType::All),
        cursor::MoveTo(0, 0),
        cursor::Hide
    )?;

    let logo = r#"
          ▞▀▖
          ▚▄▘▛▀▖▛▀▖▞▀▖▌  ▌▞▀▖
          ▞  ▖▙▄▘▙▄▘▌ ▌▐▐ ▌▌ ▌
          ▚▄▘▛  ▘▛  ▘▚▄▘ ▘ ▘▚▄▘
"#;

    // Draw stylized logo
    println!("{}", logo.trim_start().white().bold());
    println!("{}", "          swarm coding harness\n".dark_grey());

    let menu_items = [
        ("New worktree", "ctrl+w"),
        ("Resume session", "ctrl+s"),
        ("Changelog", ""),
        ("Quit", "ctrl+q"),
    ];

    // Draw menu
    for (idx, (label, shortcut)) in menu_items.iter().enumerate() {
        if idx == state.selected_index {
            print!("  {} {:<25}", "❯".cyan().bold(), label.cyan().bold());
        } else {
            print!("    {:<25}", label.white());
        }
        println!("{}", shortcut.dark_grey());
    }

    println!("\n");
    println!("{}", "ArrowCode 1.0 is here, try it out for free for a limited time!".dark_grey());
    println!("{}", "[Ready for prompt input below] or use Arrow Keys + Enter".dark_grey());
    println!("\n");
    println!("{}", "Tip: Use standard CLI prompts to start coding immediately.".dark_grey());

    // Custom Border Input Box
    println!("{}", "┌────────────────────────────────────────────────────────────────────────┐".dark_grey());
    if state.input_value.is_empty() {
        print!("{} ", "│ prompt>".cyan().bold());
        print!("{}", "Type prompt to start a new worktree / session...".dark_grey());
        let padding = 72 - "prompt> Type prompt to start a new worktree / session...".len();
        println!("{}{}", " ".repeat(padding), "│".dark_grey());
    } else {
        print!("{} ", "│ prompt>".cyan().bold());
        print!("{}", state.input_value.clone().white());
        let prompt_len = "prompt> ".len() + state.input_value.len();
        let padding = if prompt_len < 72 { 72 - prompt_len } else { 0 };
        println!("{}{}", " ".repeat(padding), "│".dark_grey());
    }
    println!("{}", "└────────────────────────────────────────────────────────────────────────┘".dark_grey());

    // Version label
    println!("{:>74}", "ArrowCode 1.0.0 Beta".dark_grey());

    stdout.flush()?;
    Ok(())
}

pub fn run_interactive_loop() -> io::Result<Option<String>> {
    let mut stdout = io::stdout();
    terminal::enable_raw_mode()?;
    execute!(stdout, terminal::EnterAlternateScreen)?;

    let mut state = TuiState::new();

    let result = loop {
        draw_home(&mut stdout, &state)?;

        if event::poll(Duration::from_millis(100))? {
            if let Event::Key(key) = event::read()? {
                // Exit binds
                if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('q') {
                    break None;
                }
                if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('w') {
                    break Some("".to_string());
                }

                // Handling input text
                match key.code {
                    KeyCode::Up => {
                        state.selected_index = if state.selected_index > 0 {
                            state.selected_index - 1
                        } else {
                            3
                        };
                    }
                    KeyCode::Down => {
                        state.selected_index = if state.selected_index < 3 {
                            state.selected_index + 1
                        } else {
                            0
                        };
                    }
                    KeyCode::Enter => {
                        if !state.input_value.trim().is_empty() {
                            break Some(state.input_value.clone());
                        }
                        match state.selected_index {
                            0 => break Some("".to_string()),
                            1 => {
                                // Resume last session shortcut
                                break Some("/session load".to_string());
                            }
                            2 => {
                                // Replay/Changelog
                                break Some("/replay".to_string());
                            }
                            _ => break None,
                        }
                    }
                    KeyCode::Char(c) => {
                        state.input_value.push(c);
                    }
                    KeyCode::Backspace => {
                        state.input_value.pop();
                    }
                    _ => {}
                }
            }
        }
    };

    execute!(stdout, terminal::LeaveAlternateScreen, cursor::Show)?;
    terminal::disable_raw_mode()?;
    Ok(result)
}
