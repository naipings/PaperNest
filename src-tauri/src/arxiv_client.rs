use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

/// arXiv 官方建议约 1 次/3s；雷达与调研共用此闸门，避免并发 429。
struct ArxivGate {
  last_done: Instant,
  min_gap: Duration,
}

impl ArxivGate {
  fn new() -> Self {
    Self {
      last_done: Instant::now() - Duration::from_secs(10),
      min_gap: Duration::from_millis(3500),
    }
  }

  async fn wait_turn(&mut self) {
    let elapsed = Instant::now().duration_since(self.last_done);
    if elapsed < self.min_gap {
      tokio::time::sleep(self.min_gap - elapsed).await;
    }
  }

  fn mark_done(&mut self) {
    self.last_done = Instant::now();
  }
}

static ARXIV_GATE: OnceLock<Mutex<ArxivGate>> = OnceLock::new();

pub async fn with_arxiv_throttle<F, Fut, T>(work: F) -> T
where
  F: FnOnce() -> Fut,
  Fut: std::future::Future<Output = T>,
{
  let gate = ARXIV_GATE.get_or_init(|| Mutex::new(ArxivGate::new()));
  let mut guard = gate.lock().await;
  guard.wait_turn().await;
  let result = work().await;
  guard.mark_done();
  result
}

pub fn arxiv_user_agent(mailto: Option<&str>) -> String {
  match mailto {
    Some(mail) if !mail.trim().is_empty() => format!("PaperNest/0.2.24 (mailto:{})", mail.trim()),
    _ => "PaperNest/0.2.24".into(),
  }
}
