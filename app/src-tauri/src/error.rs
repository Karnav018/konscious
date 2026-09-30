use serde::{Serialize, Serializer};

/// Errors crossing the IPC boundary serialize as `{ kind, message }` so the
/// frontend can branch on `kind` and show `message` in a toast.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    Spawn(String),
    #[error("{0}")]
    Unavailable(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl AppError {
    fn kind(&self) -> &'static str {
        match self {
            AppError::NotFound(_) => "not_found",
            AppError::Invalid(_) => "invalid",
            AppError::Spawn(_) => "spawn",
            AppError::Unavailable(_) => "unavailable",
            AppError::Io(_) => "io",
            AppError::Json(_) => "json",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("AppError", 2)?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
