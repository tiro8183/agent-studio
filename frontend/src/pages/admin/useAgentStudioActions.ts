import { useState, type Dispatch, type SetStateAction } from 'react';
import { useMutation, type QueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { api, responseStreamErrorMessage, streamAgentPreviewResponses } from '../../services/api';
import type {
  Agent,
  AgentPreflight,
  AgentRuntimeManifestEnvelope,
  AgentTestAssertion,
  KnowledgeDocumentDetail,
  UploadQuota,
} from '../../types/domain';
import { agentContractPayloadFromForm, emptyAssertion, formatBytes, mergeAssertion } from './agentStudioModel';
import type { StudioInspectorState } from './AgentStudioChrome';
import type { StudioStepKey } from './agentStudioModel';
import type { StudioFormShim } from './studioForm';

interface UseAgentStudioActionsParams {
  editingAgent: Agent | null;
  canEdit: boolean;
  agentForm: StudioFormShim;
  agentOutputSchemaText: string;
  harnessToolDescriptionText: string;
  caseSchemaTexts: Record<string, string>;
  hasUnsavedChanges: boolean;
  studioInspector: StudioInspectorState;
  uploadQuota?: UploadQuota;
  queryClient: QueryClient;
  setEditingAgent: Dispatch<SetStateAction<Agent | null>>;
  setActiveStudioStep: Dispatch<SetStateAction<StudioStepKey>>;
  applyAgentToForm: (values: Agent) => void;
  invalidateAgentGovernance: (agentId?: string | null) => void;
  invalidateAgentTestData: (agentId?: string | null) => void;
  onRefresh: () => void;
}

export function useAgentStudioActions({
  editingAgent,
  canEdit,
  agentForm,
  agentOutputSchemaText,
  harnessToolDescriptionText,
  caseSchemaTexts,
  hasUnsavedChanges,
  studioInspector,
  uploadQuota,
  queryClient,
  setEditingAgent,
  setActiveStudioStep,
  applyAgentToForm,
  invalidateAgentGovernance,
  invalidateAgentTestData,
  onRefresh,
}: UseAgentStudioActionsParams) {
  const message = toast;
  const [testInput, setTestInput] = useState('');
  const [testOutput, setTestOutput] = useState('');
  const [testRunning, setTestRunning] = useState(false);
  const [knowledgePreview, setKnowledgePreview] = useState<KnowledgeDocumentDetail | null>(null);
  const [runtimeManifestOpen, setRuntimeManifestOpen] = useState(false);
  const [runtimeManifest, setRuntimeManifest] = useState<AgentRuntimeManifestEnvelope | null>(null);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [agentPreflight, setAgentPreflight] = useState<AgentPreflight | null>(null);

  const warnReadOnly = () => {
    message.warning('当前为只读视图，修改配置需要编辑权限。');
  };

  const resetRuntimeState = () => {
    setTestInput('');
    setTestOutput('');
    setRuntimeManifestOpen(false);
    setRuntimeManifest(null);
    setPreflightOpen(false);
    setAgentPreflight(null);
    setKnowledgePreview(null);
  };

  const saveAgent = useMutation({
    mutationFn: (values: any) => {
      if (!canEdit) throw new Error('当前角色没有编辑配置权限');
      try {
        return editingAgent
          ? api.updateAgent(editingAgent.id, agentContractPayloadFromForm(values, agentOutputSchemaText, harnessToolDescriptionText))
          : api.createAgent(agentContractPayloadFromForm(values, agentOutputSchemaText, harnessToolDescriptionText));
      } catch {
        throw new Error('结构化输出或工具说明覆盖必须是合法 JSON 对象');
      }
    },
    onSuccess: (saved) => {
      const wasCreating = !editingAgent;
      if (wasCreating) {
        message.success('Agent 服务已创建，当前未上线');
      } else if (editingAgent?.status === 'published') {
        message.success(saved.config_pending_publish ? '配置已保存；线上仍使用上一版，重新上线后生效' : '配置已保存；上线版本保持一致');
      } else if (saved.status === 'published') {
        message.success(saved.config_pending_publish ? '配置已保存；线上仍使用上一版，重新上线后生效' : '配置已保存；上线版本保持一致');
      } else if (saved.status === 'inactive') {
        message.success('配置已保存；服务仍为停用');
      } else {
        message.success('配置已保存；完成检查和验收后可上线');
      }
      setEditingAgent(saved);
      applyAgentToForm(saved);
      if (wasCreating) {
        setActiveStudioStep('knowledge');
      } else if (saved.status === 'unpublished' && studioInspector.knowledgeCount > 0) {
        setActiveStudioStep('evaluation');
      } else if (studioInspector.regressionUntested || studioInspector.regressionStale || studioInspector.regressionFailed) {
        setActiveStudioStep('evaluation');
      }
      invalidateAgentGovernance(saved.id);
      onRefresh();
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '配置保存失败');
    },
  });

  const publishAgent = useMutation({
    mutationFn: (id: string) => api.publishAgent(id),
    onSuccess: (saved) => {
      message.success(`已生成上线版本 v${saved.version || 1}`);
      setEditingAgent(saved);
      applyAgentToForm(saved);
      invalidateAgentGovernance(saved.id);
      onRefresh();
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '上线检查未通过');
    },
  });

  const enableAgentRelease = useMutation({
    mutationFn: (id: string) => api.enableAgentRelease(id),
    onSuccess: (saved) => {
      message.success('已启用上线版本');
      setEditingAgent(saved);
      applyAgentToForm(saved);
      invalidateAgentGovernance(saved.id);
      onRefresh();
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '启用上线版本失败');
    },
  });

  const deactivateAgent = useMutation({
    mutationFn: (id: string) => api.deactivateAgent(id),
    onSuccess: (saved) => {
      message.success('服务已停用');
      setEditingAgent(saved);
      applyAgentToForm(saved);
      invalidateAgentGovernance(saved.id);
      onRefresh();
    },
  });

  const publishCurrentAgent = () => {
    if (!canEdit) {
      warnReadOnly();
      return;
    }
    if (!editingAgent) {
      message.warning('请先保存配置');
      return;
    }
    if (hasUnsavedChanges) {
      message.warning('请先保存配置，再生成上线版本。');
      return;
    }
    if (studioInspector.canEnableRelease) {
      enableAgentRelease.mutate(editingAgent.id);
      return;
    }
    publishAgent.mutate(editingAgent.id);
  };

  const createTestCase = useMutation({
    mutationFn: () => api.createTestCase(editingAgent!.id, {
      name: '业务边界检查',
      input_text: '请说明你能处理的业务范围、需要用户提供的资料，以及无法处理时会如何反馈。',
      expected_keywords: ['业务范围', '资料', '无法处理'],
      assertion: { ...emptyAssertion, required_keywords: ['业务范围', '资料', '无法处理'] },
      status: 'active',
    }),
    onSuccess: () => {
      message.success('验收用例已添加');
      invalidateAgentTestData(editingAgent?.id);
    },
  });

  const runTestCase = useMutation({
    mutationFn: (id: string) => api.runPreviewTestCase(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-cases', editingAgent?.id] });
      queryClient.invalidateQueries({ queryKey: ['test-runs', editingAgent?.id] });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      invalidateAgentGovernance(editingAgent?.id);
    },
  });

  const runTestSuite = useMutation({
    mutationFn: () => api.runPreviewTestSuite(editingAgent!.id),
    onSuccess: (result) => {
      if (result.failed) {
        message.error(`验收用例未通过：${result.passed}/${result.total}`);
      } else {
        message.success(`验收用例通过：${result.passed}/${result.total}`);
      }
      queryClient.invalidateQueries({ queryKey: ['test-cases', editingAgent?.id] });
      queryClient.invalidateQueries({ queryKey: ['test-runs', editingAgent?.id] });
      queryClient.invalidateQueries({ queryKey: ['test-suite-runs', editingAgent?.id] });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      invalidateAgentGovernance(editingAgent?.id);
    },
  });

  const updateTestCase = useMutation({
    mutationFn: (params: { id: string; values: { assertion?: Partial<AgentTestAssertion>; expected_keywords?: string[] } & Record<string, unknown> }) => {
      let requiredJsonSchema = {};
      try {
        requiredJsonSchema = JSON.parse(caseSchemaTexts[params.id] || '{}');
      } catch {
        throw new Error('验收用例结构化格式约束必须是合法 JSON 对象');
      }
      return api.updateTestCase(params.id, {
        ...params.values,
        assertion: {
          ...mergeAssertion(params.values.assertion, params.values.expected_keywords),
          required_json_schema: requiredJsonSchema,
        },
      });
    },
    onSuccess: () => {
      message.success('验收用例已保存');
      invalidateAgentTestData(editingAgent?.id);
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '验收用例保存失败');
    },
  });

  const setLocalTestCase = (caseId: string, patch: Record<string, unknown>) => {
    if (!editingAgent || !canEdit) return;
    queryClient.setQueryData(['test-cases', editingAgent.id], (old: any) => (
      (old || []).map((row: any) => (row.id === caseId ? { ...row, ...patch } : row))
    ));
  };

  const openRuntimeManifest = async () => {
    if (!editingAgent) return;
    try {
      const envelope = hasUnsavedChanges
        ? await api.previewAgentRuntimeManifest(
          editingAgent.id,
          agentContractPayloadFromForm(
            agentForm.getFieldsValue(true),
            agentOutputSchemaText,
            harnessToolDescriptionText,
          ),
        )
        : await api.getAgentRuntimeManifest(editingAgent.id, 'draft');
      setRuntimeManifest(envelope);
      setRuntimeManifestOpen(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '版本信息加载失败');
    }
  };

  const openAgentPreflight = async () => {
    if (!editingAgent) return;
    try {
      const result = await api.getAgentPreflight(editingAgent.id);
      setAgentPreflight(result);
      queryClient.setQueryData(['agent-preflight', editingAgent.id], result);
      setPreflightOpen(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '检查结果加载失败');
    }
  };

  const runBuilderTest = async () => {
    if (!editingAgent) {
      message.warning('保存配置后再运行业务验证');
      return;
    }
    if (!canEdit) {
      warnReadOnly();
      return;
    }
    if (!testInput.trim()) {
      message.warning('请输入业务任务');
      return;
    }
    if (hasUnsavedChanges) {
      message.warning('保存配置后再运行业务验证');
      return;
    }
    setTestOutput('');
    setTestRunning(true);
    try {
      await streamAgentPreviewResponses(
        editingAgent.id,
        {
          model: `agent:${editingAgent.slug || editingAgent.id}`,
          input: testInput.trim(),
        },
        (event) => {
          if (event.type === 'response.output_text.delta') {
            setTestOutput((prev) => `${prev}${event.data.delta || ''}`);
          }
          if (event.type === 'response.failed') {
            setTestOutput(responseStreamErrorMessage(event));
          }
        },
      );
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['test-cases', editingAgent.id] });
      invalidateAgentGovernance(editingAgent.id);
    } finally {
      setTestRunning(false);
    }
  };

  const knowledgeAccept = (uploadQuota?.allowed_extensions || []).join(',');

  const uploadKnowledgeFile = async (file: File) => {
    if (!canEdit) {
      warnReadOnly();
      return;
    }
    if (!editingAgent) {
      message.warning('保存配置后再上传业务资料');
      return;
    }
    const maxBytes = uploadQuota?.knowledge_upload_max_bytes || 0;
    if (maxBytes > 0 && file.size > maxBytes) {
      message.error(`单个业务资料不能超过 ${formatBytes(maxBytes)}`);
      return;
    }
    const remainingBytes = uploadQuota?.remaining_bytes ?? 0;
    if (uploadQuota && file.size > remainingBytes) {
      message.error(`组织上传配额不足，当前剩余 ${formatBytes(remainingBytes)}`);
      return;
    }
    try {
      await api.uploadKnowledge(editingAgent.id, file);
      message.success('业务资料已上传');
      queryClient.invalidateQueries({ queryKey: ['knowledge', editingAgent.id] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-counts'] });
      queryClient.invalidateQueries({ queryKey: ['upload-quota'] });
      invalidateAgentGovernance(editingAgent.id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '业务资料上传失败');
    }
  };

  const previewKnowledge = async (documentId: string) => {
    const detail = await api.getKnowledge(documentId);
    setKnowledgePreview(detail);
  };

  const deleteKnowledge = async (documentId: string) => {
    if (!editingAgent) return;
    if (!canEdit) {
      warnReadOnly();
      return;
    }
    await api.deleteKnowledge(documentId);
    queryClient.invalidateQueries({ queryKey: ['knowledge', editingAgent.id] });
    queryClient.invalidateQueries({ queryKey: ['knowledge-counts'] });
    invalidateAgentGovernance(editingAgent.id);
  };

  const deleteTestCase = async (caseId: string) => {
    if (!editingAgent) return;
    if (!canEdit) {
      warnReadOnly();
      return;
    }
    await api.deleteTestCase(caseId);
    invalidateAgentTestData(editingAgent.id);
  };

  const deleteCurrentAgent = async () => {
    if (!editingAgent) return;
    if (!canEdit) {
      warnReadOnly();
      return;
    }
    await api.deleteAgent(editingAgent.id);
    setEditingAgent(null);
    resetRuntimeState();
    queryClient.invalidateQueries({ queryKey: ['runs'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
    queryClient.invalidateQueries({ queryKey: ['run-incidents'] });
    queryClient.invalidateQueries({ queryKey: ['quality-regression-overview'] });
    queryClient.invalidateQueries({ queryKey: ['knowledge-counts'] });
    onRefresh();
  };

  return {
    testInput,
    testOutput,
    testRunning,
    knowledgePreview,
    runtimeManifestOpen,
    runtimeManifest,
    preflightOpen,
    agentPreflight,
    knowledgeAccept,
    uploadKnowledgeFile,
    saveAgent,
    deactivateAgent,
    releaseActionPending: publishAgent.isPending || enableAgentRelease.isPending,
    createTestCase,
    runTestCase,
    runTestSuite,
    updateTestCase,
    setTestInput,
    setLocalTestCase,
    setRuntimeManifestOpen,
    setPreflightOpen,
    setKnowledgePreview,
    resetRuntimeState,
    warnReadOnly,
    publishCurrentAgent,
    openRuntimeManifest,
    openAgentPreflight,
    runBuilderTest,
    previewKnowledge,
    deleteKnowledge,
    deleteTestCase,
    deleteCurrentAgent,
  };
}
