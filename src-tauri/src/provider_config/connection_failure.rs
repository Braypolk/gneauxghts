//! Fixed, nonsecret explanations shared by inference and explicit model discovery.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ConnectionFailure {
    Timeout,
    Dns,
    Connect,
    Other,
}

impl ConnectionFailure {
    pub(crate) fn from_reqwest(error: &reqwest::Error) -> Self {
        if error.is_timeout() {
            Self::Timeout
        } else if error.is_dns() {
            Self::Dns
        } else if error.is_connect() {
            Self::Connect
        } else {
            Self::Other
        }
    }

    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::Timeout => "connection_timeout",
            Self::Dns => "connection_dns",
            Self::Connect | Self::Other => "connection",
        }
    }

    pub(crate) fn message(self) -> &'static str {
        match self {
            Self::Timeout => "The model request timed out. Check the server and try again.",
            Self::Dns => "The model server hostname could not be resolved. Check the server address and network connection.",
            Self::Connect => "The model server could not be reached. Check its address and connection.",
            Self::Other => "The model connection failed. Check the server connection and try again.",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::dns::{Name, Resolve, Resolving};
    use std::{sync::Arc, time::Duration};

    struct FailingDns;
    impl Resolve for FailingDns {
        fn resolve(&self, _: Name) -> Resolving {
            Box::pin(async { Err(std::io::Error::other("SECRET_DNS_DETAIL").into()) })
        }
    }

    struct SlowDns;
    impl Resolve for SlowDns {
        fn resolve(&self, _: Name) -> Resolving {
            Box::pin(async {
                tokio::time::sleep(Duration::from_secs(5)).await;
                Err(std::io::Error::other("SECRET_DNS_DETAIL").into())
            })
        }
    }

    #[tokio::test]
    async fn dns_precedes_its_broad_connect_category_and_never_exposes_the_source() {
        let error = reqwest::Client::builder()
            .no_proxy()
            .dns_resolver(Arc::new(FailingDns))
            .build()
            .unwrap()
            .get("http://private-secret.invalid/secret-path")
            .send()
            .await
            .unwrap_err();
        assert!(error.is_dns());
        assert!(error.is_connect());
        let failure = ConnectionFailure::from_reqwest(&error);
        assert_eq!(failure, ConnectionFailure::Dns);
        assert_eq!(failure.code(), "connection_dns");
        assert_eq!(failure.message(), "The model server hostname could not be resolved. Check the server address and network connection.");
        assert!(!failure.message().contains("SECRET"));
        assert!(!failure.message().contains("private-secret"));
    }

    #[tokio::test]
    async fn timeout_precedes_a_connect_timeout() {
        let error = reqwest::Client::builder()
            .no_proxy()
            .dns_resolver(Arc::new(SlowDns))
            .connect_timeout(Duration::from_millis(30))
            .build()
            .unwrap()
            .get("http://private-secret.invalid/secret-path")
            .send()
            .await
            .unwrap_err();
        assert!(error.is_timeout());
        assert!(error.is_connect());
        assert_eq!(
            ConnectionFailure::from_reqwest(&error),
            ConnectionFailure::Timeout
        );
    }

    #[tokio::test]
    async fn closed_loopback_port_is_a_connection_failure() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let error = reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .get(format!("http://{address}/secret-path"))
            .send()
            .await
            .unwrap_err();
        let failure = ConnectionFailure::from_reqwest(&error);
        assert_eq!(failure, ConnectionFailure::Connect);
        assert_eq!(failure.code(), "connection");
        assert_eq!(
            failure.message(),
            "The model server could not be reached. Check its address and connection."
        );
    }

    #[tokio::test]
    async fn delayed_headers_are_a_timeout_without_changing_production_deadlines() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (_stream, _) = listener.accept().await.unwrap();
            tokio::time::sleep(Duration::from_secs(5)).await;
        });
        let error = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_millis(50))
            .build()
            .unwrap()
            .get(format!("http://{address}/secret-path"))
            .send()
            .await
            .unwrap_err();
        server.abort();
        let failure = ConnectionFailure::from_reqwest(&error);
        assert_eq!(failure, ConnectionFailure::Timeout);
        assert_eq!(failure.code(), "connection_timeout");
        assert_eq!(
            failure.message(),
            "The model request timed out. Check the server and try again."
        );
    }

    #[tokio::test]
    async fn other_send_errors_retain_a_fixed_fallback() {
        let error = reqwest::Client::new()
            .get("file:///secret-path")
            .send()
            .await
            .unwrap_err();
        let failure = ConnectionFailure::from_reqwest(&error);
        assert_eq!(failure, ConnectionFailure::Other);
        assert_eq!(failure.code(), "connection");
        assert_eq!(
            failure.message(),
            "The model connection failed. Check the server connection and try again."
        );
    }
}
