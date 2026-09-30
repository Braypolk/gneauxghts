//! Preserve actionable app feedback at Rig's error-normalization boundary.
//! Unknown dependency/OS/provider errors keep Rig's redacted presentation.
use super::*;
use rig_core::tool::ToolExecutionError;

pub(super) struct ModelTool<T>(pub(super) T);

impl<T: Tool<Error = AgentToolError>> Tool for ModelTool<T> {
    const NAME: &'static str = T::NAME;
    type Error = AgentToolError;
    type Args = T::Args;
    type Output = T::Output;

    fn description(&self) -> String {
        self.0.description()
    }
    fn parameters(&self) -> Value {
        self.0.parameters()
    }
    async fn call(
        &self,
        context: &mut ToolContext,
        args: Self::Args,
    ) -> Result<Self::Output, Self::Error> {
        self.0.call(context, args).await
    }
    fn map_error(&self, error: Self::Error) -> ToolExecutionError {
        model_error(error)
    }
}

fn model_error(error: AgentToolError) -> ToolExecutionError {
    let payload = error.payload();
    let code = payload["code"].as_str().unwrap().to_owned();
    let retryable = payload["retryable"].as_bool().unwrap();
    ToolExecutionError::from_error(error)
        .with_code(code)
        .with_retryable(retryable)
        .with_model_output(rig_core::tool::ToolOutput::json(payload))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rig_agent::tool::ToolSet;

    struct FailingTool;
    impl Tool for FailingTool {
        const NAME: &'static str = "failure_fixture";
        type Error = AgentToolError;
        type Args = Value;
        type Output = Value;
        fn description(&self) -> String {
            "Fixture".into()
        }
        fn parameters(&self) -> Value {
            json!({"type":"object"})
        }
        async fn call(&self, _: &mut ToolContext, args: Value) -> Result<Value, AgentToolError> {
            match args["failure"].as_str().unwrap() {
                "budget" => Err(AgentToolError::evidence_budget()),
                "invalid_range" => {
                    crate::services::evidence::query::ActivityRange {
                        start: "2026-09-28".into(),
                        end: "2026-09-21".into(),
                        timezone: Some("America/Denver".into()),
                    }
                    .resolve(&Default::default())?;
                    unreachable!()
                }
                _ => Err(AgentToolError::internal(
                    "network request failed: token=PRIVATE_DIAGNOSTIC",
                )),
            }
        }
    }

    #[tokio::test]
    async fn registered_tools_deliver_structured_recovery_without_internal_diagnostics() {
        let mut tool = ToolSet::default();
        tool.add_tool(ModelTool(FailingTool));
        let result = tool
            .execute(
                FailingTool::NAME,
                &json!({"failure":"budget"}).to_string(),
                &mut ToolContext::default(),
            )
            .await;
        let output = result.output().as_json().unwrap();
        assert!(result.is_error());
        assert_eq!(output["code"], "evidence_budget");
        assert_eq!(output["retryable"], false);
        assert_eq!(
            output["recovery"]["action"],
            "finish_with_available_evidence"
        );
        let result = tool
            .execute(
                FailingTool::NAME,
                &json!({"failure":"invalid_range"}).to_string(),
                &mut ToolContext::default(),
            )
            .await;
        assert_eq!(
            result.output().as_json().unwrap()["code"],
            "invalid_request"
        );
        assert_eq!(
            result.output().as_json().unwrap()["recovery"]["action"],
            "correct_request"
        );
        let result = tool
            .execute(
                FailingTool::NAME,
                &json!({"failure":"internal"}).to_string(),
                &mut ToolContext::default(),
            )
            .await;
        assert!(!result
            .output()
            .as_json()
            .unwrap()
            .to_string()
            .contains("PRIVATE_DIAGNOSTIC"));
        assert!(result
            .error()
            .unwrap()
            .message()
            .contains("PRIVATE_DIAGNOSTIC"));
    }
}
