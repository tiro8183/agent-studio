from dataclasses import dataclass
from typing import Optional

from app.services.agent_execution_service import AgentExecutionService
from app.services.openai_compatible_service import AgentExecutionRequest, run_agent_once
from app.services.runtime_plan_service import RuntimePlan


@dataclass(frozen=True)
class ExecutionGatewayOptions:
    source: str = "runtime"
    entrypoint: str = "responses"
    trace_label: str = "运行开始"
    done_label: str = "运行完成"
    error_label: str = "运行失败"
    rerun_of_run_id: Optional[str] = None
    runtime_plan_override: Optional[RuntimePlan] = None


@dataclass(frozen=True)
class ExecutionGatewayResult:
    output_text: str
    conversation_id: str
    run_id: str


class ExecutionGateway:
    def __init__(self, service: AgentExecutionService):
        self.service = service

    async def execute_once(
        self,
        request: AgentExecutionRequest,
        options: ExecutionGatewayOptions | None = None,
    ) -> ExecutionGatewayResult:
        execution_options = options or ExecutionGatewayOptions()
        execution_context_id = request.conversation_id or f"{execution_options.source}:execution"
        normalized_request = request.model_copy(update={
            "conversation_id": None,
            "execution_context_id": execution_context_id,
            "entrypoint": execution_options.entrypoint,
            "run_source": execution_options.source,
            "trace_label": execution_options.trace_label,
            "done_label": execution_options.done_label,
            "error_label": execution_options.error_label,
            "rerun_of_run_id": execution_options.rerun_of_run_id,
            "persist_messages": False,
            "runtime_plan_override": execution_options.runtime_plan_override,
        })
        result = await run_agent_once(self.service, normalized_request)
        return ExecutionGatewayResult(
            output_text=str(result.get("output_text") or ""),
            conversation_id=str(result.get("conversation_id") or ""),
            run_id=str(result.get("run_id") or ""),
        )
