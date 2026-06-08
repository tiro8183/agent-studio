from app.core.schemas import AgentRuntimeManifestRead
from app.services.runtime_adapter.compiled_plan import CompiledRuntimePlan
from app.services.runtime_manifest_hash import hash_runtime_manifest


class RuntimeManifestMismatch(ValueError):
    def __init__(self, expected_hash: str, actual_hash: str):
        self.expected_hash = expected_hash
        self.actual_hash = actual_hash
        super().__init__(
            f"运行清单一致性校验失败: expected={expected_hash}, actual={actual_hash}"
        )


def assert_manifest_alignment(
    manifest: AgentRuntimeManifestRead,
    manifest_hash: str,
    plan: CompiledRuntimePlan,
) -> None:
    actual_hash = hash_runtime_manifest(plan.to_manifest_projection())
    if actual_hash != manifest_hash:
        raise RuntimeManifestMismatch(manifest_hash, actual_hash)
