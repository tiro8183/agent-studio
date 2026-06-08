import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { agentConfigStateLabel } from '../../services/agentLifecycle';
import { api } from '../../services/api';
import type {
  Agent,
  AgentRuntimeManifestEnvelope,
  LLMConfig,
  Skill,
  ToolDefinition,
} from '../../types/domain';
import {
  AgentBlueprintRail,
  AgentStudioHeader,
  StudioInspectorPanel,
  StudioStepNav,
} from './AgentStudioChrome';
import {
  AgentPreflightDrawer,
  KnowledgePreviewDrawer,
  RuntimeManifestDrawer,
} from './AgentStudioDrawers';
import {
  CapabilitiesPanel,
  InstructionsPanel,
  ModelContractPanel,
  ProfilePanel,
  SubagentsPanel,
} from './AgentStudioCorePanels';
import {
  EvaluationPanel,
  KnowledgePanel,
  RuntimePolicyPanel,
} from './AgentStudioPanels';
import {
  agentContractPayloadFromForm,
  defaultAgent,
  isCurrentTestCase,
  shortHash,
  studioSteps,
  type StudioStepKey,
} from './agentStudioModel';
import { useStudioForm, useFormWatch, type Option } from './studioForm';
import { useAgentStudioActions } from './useAgentStudioActions';
import { useAgentStudioData } from './useAgentStudioData';

interface AgentBuilderProps {
  agents: Agent[];
  llms: LLMConfig[];
  tools: ToolDefinition[];
  skills: Skill[];
  canEdit: boolean;
  onRefresh: () => void;
}

export function AgentBuilder({ agents, llms, tools, skills, canEdit, onRefresh }: AgentBuilderProps) {
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [activeStudioStep, setActiveStudioStep] = useState<StudioStepKey>(studioSteps[0].key);
  const [agentOutputSchemaText, setAgentOutputSchemaText] = useState('{}');
  const [harnessToolDescriptionText, setHarnessToolDescriptionText] = useState('{}');
  const [caseSchemaTexts, setCaseSchemaTexts] = useState<Record<string, string>>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [formRevision, setFormRevision] = useState(0);
  const agentForm = useStudioForm(() => {
    setHasUnsavedChanges(true);
    setFormRevision((value) => value + 1);
  });

  useEffect(() => {
    agentForm.registerRules('name', [{ required: true, message: '请填写 Agent 名称' }]);
    agentForm.registerRules('slug', [{ pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, message: '仅支持小写字母、数字和短横线' }]);
    agentForm.registerRules('system_prompt', [{ required: true, message: '请填写执行说明' }]);
    agentForm.registerRules('llm_config_id', [{ required: true, message: '请选择模型通道' }]);
    agentForm.registerRules('model', [{ required: true, message: '请选择默认模型' }]);
  }, [agentForm]);

  const {
    queryClient,
    knowledge,
    testCases,
    testRunHistory,
    testSuiteRuns,
    regressionCoverage,
    completeness,
    preflight,
    runtimeManifestEnvelope,
    releases,
    uploadQuota,
    invalidateAgentGovernance,
    invalidateAgentTestData,
  } = useAgentStudioData({ editingAgent, agents });

  const llmOptions = useMemo(
    () => llms.map((item) => ({ label: item.name, value: item.id, config: item })),
    [llms],
  );
  const selectedLlmId = useFormWatch(agentForm, 'llm_config_id');
  const [previewManifestEnvelope, setPreviewManifestEnvelope] = useState<AgentRuntimeManifestEnvelope | null>(null);
  const [previewManifestLoading, setPreviewManifestLoading] = useState(false);
  const [previewManifestError, setPreviewManifestError] = useState('');
  const [focusedBlockerStep, setFocusedBlockerStep] = useState<StudioStepKey | null>(null);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const selectedLlm = useMemo(
    () => llms.find((item) => item.id === selectedLlmId),
    [llms, selectedLlmId],
  );
  const selectedLlmModels: Option[] = selectedLlm?.available_models?.length
    ? selectedLlm.available_models.map((model) => ({ value: model.name, label: model.name }))
    : selectedLlm?.default_model
      ? [{ value: selectedLlm.default_model, label: selectedLlm.default_model }]
      : [];
  const modelOptionsForLlm = (llmId?: string | null): Option[] => {
    const llm = llms.find((item) => item.id === llmId) || selectedLlm;
    return llm?.available_models?.length
      ? llm.available_models.map((model) => ({ value: model.name, label: model.name }))
      : llm?.default_model
        ? [{ value: llm.default_model, label: llm.default_model }]
        : [];
  };
  const toolOptions: Option[] = useMemo(
    () => tools.map((item) => ({
      value: item.id,
      label: `${item.name} · ${item.description}`,
    })),
    [tools],
  );
  const skillOptions: Option[] = useMemo(
    () => skills.filter((item) => item.status === 'active').map((item) => ({
      value: item.id,
      label: `${item.display_name || item.name} · ${item.description}`,
    })),
    [skills],
  );
  const studioInspector = useMemo(() => {
    const currentPreflight = preflight.data;
    const latestRelease = (releases.data || [])[0];
    const activeManifestEnvelope = hasUnsavedChanges ? previewManifestEnvelope : runtimeManifestEnvelope.data;
    const runtimeManifest = activeManifestEnvelope?.manifest || currentPreflight?.runtime_manifest;
    const coverage = regressionCoverage.data;
    const activeCases = (testCases.data || []).filter((item) => item.status === 'active');
    const currentHash = editingAgent?.current_spec_hash || currentPreflight?.runtime_plan_hash || '';
    const passedCases = activeCases.filter((item) => item.last_status === 'passed' && isCurrentTestCase(item, currentHash));
    const releaseHash = editingAgent?.latest_release_spec_hash || latestRelease?.spec_hash || '';
    const manifestHash = activeManifestEnvelope?.manifest_hash || currentPreflight?.manifest_hash || '';
    const latestReleaseManifestHash = latestRelease?.manifest_hash || '';
    const hasRelease = Boolean(releaseHash || latestRelease);
    const hasPendingPublish = editingAgent?.config_pending_publish ?? Boolean(currentHash && releaseHash && currentHash !== releaseHash);
    const canEnableRelease = Boolean(editingAgent?.status === 'inactive' && hasRelease && currentHash && releaseHash === currentHash);
    const backendCanPublish = currentPreflight?.can_publish || false;
    const firstFailedBlocker = currentPreflight?.checks.find((item) => !item.passed && item.severity === 'blocker');
    const showPublishAction = Boolean(editingAgent && (
      editingAgent.status === 'unpublished'
      || editingAgent.status === 'inactive'
      || hasUnsavedChanges
      || hasPendingPublish
      || (editingAgent.status === 'published' && !hasRelease)
    ));
    const publishActionLabel = canEnableRelease
      ? '启用上线版本'
      : '生成上线版本';
    const configStatusLabel = agentConfigStateLabel(editingAgent, hasUnsavedChanges, hasPendingPublish);
    const publishDisabledReason = !backendCanPublish && firstFailedBlocker
      ? `${firstFailedBlocker.label}未通过：${firstFailedBlocker.detail}`
      : !backendCanPublish
        ? '上线检查未通过'
        : '';
    return {
      canRun: currentPreflight?.can_run || false,
      canPublish: backendCanPublish,
      backendCanPublish,
      score: currentPreflight?.score ?? completeness.data?.score ?? 0,
      blockers: currentPreflight?.blockers || 0,
      warnings: currentPreflight?.warnings || 0,
      runtimeResources: (runtimeManifest?.main_tools.length || 0)
        + (runtimeManifest?.main_skills.length || 0)
        + (runtimeManifest?.subagents.length || 0),
      missingResources: [
        ...(runtimeManifest?.missing_tools || []),
        ...(runtimeManifest?.missing_skills || []),
      ],
      activeCases: coverage?.active_cases ?? activeCases.length,
      passedCases: coverage?.passed ?? passedCases.length,
      regressionFailed: coverage?.failed ?? 0,
      regressionStale: coverage?.stale ?? 0,
      regressionUntested: coverage?.untested ?? 0,
      regressionCoveragePercent: coverage?.coverage_percent ?? 0,
      regressionBlockers: coverage?.blockers || [],
      runtimePlanHash: currentHash || '',
      manifestHash,
      manifestSource: activeManifestEnvelope?.source || (hasUnsavedChanges ? 'preview' : 'draft'),
      manifestLoading: hasUnsavedChanges ? previewManifestLoading : runtimeManifestEnvelope.isFetching,
      manifestError: previewManifestError || (runtimeManifestEnvelope.error instanceof Error ? runtimeManifestEnvelope.error.message : ''),
      latestReleaseHash: releaseHash,
      latestReleaseManifestHash,
      hasRelease,
      canEnableRelease,
      hasUnsavedChanges,
      hasPendingPublish,
      showPublishAction,
      publishActionLabel,
      publishDisabledReason,
      configStatusLabel,
      knowledgeCount: knowledge.data?.length || 0,
      knowledgeChunkCount: (knowledge.data || []).reduce((sum, item) => sum + (item.chunk_count || 0), 0),
      releaseKnowledgeCount: latestRelease?.knowledge_snapshot_count || 0,
      releaseKnowledgeBytes: latestRelease?.knowledge_snapshot_bytes || 0,
    };
  }, [
    completeness.data?.score,
    editingAgent,
    hasUnsavedChanges,
    knowledge.data,
    preflight.data,
    previewManifestEnvelope,
    previewManifestError,
    previewManifestLoading,
    regressionCoverage.data,
    releases.data,
    runtimeManifestEnvelope.data,
    runtimeManifestEnvelope.error,
    runtimeManifestEnvelope.isFetching,
    testCases.data,
  ]);
  const activeManifestEnvelope = hasUnsavedChanges ? previewManifestEnvelope : runtimeManifestEnvelope.data;
  const activeManifestLoading = hasUnsavedChanges ? previewManifestLoading : runtimeManifestEnvelope.isFetching;
  const activeManifestError = previewManifestError || (runtimeManifestEnvelope.error instanceof Error ? runtimeManifestEnvelope.error.message : '');

  const applyAgentToForm = (values: Agent | ReturnType<typeof defaultAgent>) => {
    agentForm.resetFields();
    agentForm.setFieldsValue({
      ...values,
      interrupt_tools: Object.entries(values.runtime?.interrupt_on || {})
        .filter(([, enabled]) => enabled)
        .map(([tool]) => tool),
      subagents: (values.subagents || []).map((subagent: any) => ({
        ...subagent,
        interrupt_tools: Object.entries(subagent.interrupt_on || {})
          .filter(([, enabled]) => enabled)
          .map(([tool]) => tool),
        output: {
          ...(subagent.output || { mode: 'text', json_schema: {} }),
          schema_text: JSON.stringify(subagent.output?.json_schema || {}, null, 2),
        },
      })),
    });
    setAgentOutputSchemaText(JSON.stringify(values.output?.json_schema || {}, null, 2));
    setHarnessToolDescriptionText(JSON.stringify(values.harness?.tool_description_overrides || {}, null, 2));
    setHasUnsavedChanges(false);
  };

  const studioActions = useAgentStudioActions({
    editingAgent,
    canEdit,
    agentForm,
    agentOutputSchemaText,
    harnessToolDescriptionText,
    caseSchemaTexts,
    hasUnsavedChanges,
    studioInspector,
    uploadQuota: uploadQuota.data,
    queryClient,
    setEditingAgent,
    setActiveStudioStep,
    applyAgentToForm,
    invalidateAgentGovernance,
    invalidateAgentTestData,
    onRefresh,
  });

  const submitAgent = async () => {
    if (!canEdit) {
      studioActions.warnReadOnly();
      return;
    }
    try {
      const values = await agentForm.validateFields();
      studioActions.saveAgent.mutate(values);
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : '请检查必填项与格式');
    }
  };

  useEffect(() => {
    setPreviewManifestEnvelope(null);
    setPreviewManifestError('');
    setPreviewManifestLoading(false);
  }, [editingAgent?.id]);

  useEffect(() => {
    if (!editingAgent?.id || !hasUnsavedChanges) {
      setPreviewManifestEnvelope(null);
      setPreviewManifestError('');
      setPreviewManifestLoading(false);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const payload = agentContractPayloadFromForm(
          agentForm.getFieldsValue(true),
          agentOutputSchemaText,
          harnessToolDescriptionText,
        );
        setPreviewManifestLoading(true);
        setPreviewManifestError('');
        const envelope = await api.previewAgentRuntimeManifest(editingAgent.id, payload);
        setPreviewManifestEnvelope(envelope);
      } catch (error) {
        setPreviewManifestEnvelope(null);
        setPreviewManifestError(error instanceof Error ? error.message : '运行清单预览失败');
      } finally {
        setPreviewManifestLoading(false);
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [
    agentForm,
    agentOutputSchemaText,
    editingAgent?.id,
    formRevision,
    harnessToolDescriptionText,
    hasUnsavedChanges,
  ]);

  const selectAgent = (record?: Agent | null) => {
    const firstLlm = llms[0];
    setEditingAgent(record || null);
    studioActions.resetRuntimeState();
    applyAgentToForm(record || defaultAgent(firstLlm));
    if (!record) {
      setHasUnsavedChanges(true);
      setActiveStudioStep('profile');
    }
  };

  useEffect(() => {
    if (!editingAgent && agents[0]) {
      const focusAgentId = sessionStorage.getItem('agent_forge_focus_agent');
      const focusedAgent = agents.find((agent) => agent.id === focusAgentId);
      if (focusAgentId) sessionStorage.removeItem('agent_forge_focus_agent');
      selectAgent(focusedAgent || agents[0]);
    }
  }, [agents]);

  useEffect(() => {
    setCaseSchemaTexts(Object.fromEntries(
      (testCases.data || []).map((item) => [
        item.id,
        JSON.stringify(item.assertion?.required_json_schema || {}, null, 2),
      ]),
    ));
  }, [testCases.data]);

  const showStudioSection = (stepKey: StudioStepKey) => {
    setActiveStudioStep(stepKey);
  };
  const blockerFieldMap = useMemo(() => ({
    identity: 'profile' as StudioStepKey,
    model_binding: 'model' as StudioStepKey,
    api_key_configured: 'model' as StudioStepKey,
    provider_check: 'model' as StudioStepKey,
    deepagents_runtime: 'runtime' as StudioStepKey,
    runtime_configuration: 'runtime' as StudioStepKey,
    runtime_manifest_guard: 'runtime' as StudioStepKey,
    runtime_governance_gate: 'runtime' as StudioStepKey,
    runtime_resources: 'capabilities' as StudioStepKey,
    capabilities: 'capabilities' as StudioStepKey,
    tool_health: 'capabilities' as StudioStepKey,
    skill_health: 'capabilities' as StudioStepKey,
    knowledge: 'knowledge' as StudioStepKey,
    test_run: 'evaluation' as StudioStepKey,
    regression_suite: 'evaluation' as StudioStepKey,
    publication_metadata: 'evaluation' as StudioStepKey,
  }), []);
  const handleBlockerFocus = (checkKey: string) => {
    const targetStep = blockerFieldMap[checkKey as keyof typeof blockerFieldMap] || 'runtime';
    setActiveStudioStep(targetStep);
    setFocusedBlockerStep(targetStep);
    window.requestAnimationFrame(() => {
      document.getElementById(`studio-${targetStep}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    window.setTimeout(() => {
      setFocusedBlockerStep((current) => (current === targetStep ? null : current));
    }, 1800);
  };
  const runSuiteFromStudio = () => {
    if (!canEdit) return studioActions.warnReadOnly();
    return studioActions.runTestSuite.mutate();
  };
  const renderInspectorPanel = (onFocusBlocker = handleBlockerFocus) => (
    <StudioInspectorPanel
      inspector={studioInspector}
      editingAgent={editingAgent}
      canEdit={canEdit}
      testRunning={studioActions.testRunning}
      isSuiteRunning={studioActions.runTestSuite.isPending}
      isPublishing={studioActions.releaseActionPending}
      onOpenPreflight={studioActions.openAgentPreflight}
      onOpenManifest={studioActions.openRuntimeManifest}
      preflightChecks={preflight.data?.checks || []}
      onFocusBlocker={onFocusBlocker}
      onRunBuilderTest={studioActions.runBuilderTest}
      onRunSuite={runSuiteFromStudio}
      onPublish={studioActions.publishCurrentAgent}
    />
  );
  const activeStepMeta = studioSteps.find((item) => item.key === activeStudioStep) || studioSteps[0];
  const panelClass = (stepKey: StudioStepKey) => cn(
    'rounded-xl border bg-card p-5 transition-shadow',
    activeStudioStep === stepKey ? 'border-border' : 'hidden',
    focusedBlockerStep === stepKey && 'ring-2 ring-primary/50',
  );

  return (
    <>
      <section className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <AgentBlueprintRail
          agents={agents}
          editingAgent={editingAgent}
          canEdit={canEdit}
          onCreate={() => (canEdit ? selectAgent(null) : studioActions.warnReadOnly())}
          onSelect={selectAgent}
          onDelete={studioActions.deleteCurrentAgent}
        />
        <section className="min-w-0 space-y-4">
          <AgentStudioHeader
            editingAgent={editingAgent}
            canEdit={canEdit}
            hasUnsavedChanges={hasUnsavedChanges}
            isSaving={studioActions.saveAgent.isPending}
            isDeactivating={studioActions.deactivateAgent.isPending}
            onSave={submitAgent}
            onOpenManifest={studioActions.openRuntimeManifest}
            onOpenPreflight={studioActions.openAgentPreflight}
            onDeactivate={() => {
              if (!canEdit) return studioActions.warnReadOnly();
              return editingAgent && studioActions.deactivateAgent.mutate(editingAgent.id);
            }}
          />
          <div className="lg:hidden">
            <Button
              disabled={!editingAgent}
              onClick={() => setMobileInspectorOpen(true)}
            >
              运行真相 {shortHash(studioInspector.manifestHash)} · {studioInspector.blockers + studioInspector.regressionFailed} 未通过
            </Button>
          </div>
          <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
            <div className="min-w-0 space-y-4">
              <StudioStepNav
                activeStep={activeStudioStep}
                blockers={preflight.data?.checks || []}
                onChange={showStudioSection}
              />
              <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
                <span className="text-xs font-medium text-muted-foreground">当前任务 · {activeStepMeta.group}</span>
                <h3 className="text-base font-semibold text-foreground">{activeStepMeta.title}</h3>
                <p className="text-xs text-muted-foreground">{activeStepMeta.desc}</p>
              </div>

              <section className={panelClass('profile')} id="studio-profile">
                <ProfilePanel form={agentForm} llmOptions={llmOptions} modelOptions={selectedLlmModels} canEdit={canEdit} />
              </section>

              <section className={panelClass('model')} id="studio-model">
                <ModelContractPanel form={agentForm} llmOptions={llmOptions} modelOptions={selectedLlmModels} canEdit={canEdit} />
              </section>

              <section className={panelClass('instructions')} id="studio-instructions">
                <InstructionsPanel form={agentForm} canEdit={canEdit} />
              </section>

              <section className={panelClass('capabilities')} id="studio-capabilities">
                <CapabilitiesPanel
                  form={agentForm}
                  editingAgent={editingAgent}
                  runtimeManifestEnvelope={activeManifestEnvelope}
                  runtimeManifestLoading={activeManifestLoading}
                  runtimeManifestError={activeManifestError}
                  toolOptions={toolOptions}
                  skillOptions={skillOptions}
                  canEdit={canEdit}
                />
              </section>

              <section className={panelClass('subagents')} id="studio-subagents">
                <SubagentsPanel
                  form={agentForm}
                  llmOptions={llmOptions}
                  toolOptions={toolOptions}
                  skillOptions={skillOptions}
                  modelOptionsForLlm={modelOptionsForLlm}
                  canEdit={canEdit}
                />
              </section>

              <section className={panelClass('knowledge')} id="studio-knowledge">
                <KnowledgePanel
                  editingAgent={editingAgent}
                  documents={knowledge.data || []}
                  acceptExtensions={studioActions.knowledgeAccept}
                  onUpload={studioActions.uploadKnowledgeFile}
                  uploadQuota={uploadQuota.data}
                  canEdit={canEdit}
                  onPreview={studioActions.previewKnowledge}
                  onDelete={studioActions.deleteKnowledge}
                />
              </section>

              <section className={panelClass('runtime')} id="studio-runtime">
                <RuntimePolicyPanel
                  form={agentForm}
                  editingAgent={editingAgent}
                  agentOutputSchemaText={agentOutputSchemaText}
                  harnessToolDescriptionText={harnessToolDescriptionText}
                  canEdit={canEdit}
                  onOutputSchemaChange={(value) => {
                    if (!canEdit) return;
                    setAgentOutputSchemaText(value);
                    setHasUnsavedChanges(true);
                  }}
                  onHarnessToolDescriptionChange={(value) => {
                    if (!canEdit) return;
                    setHarnessToolDescriptionText(value);
                    setHasUnsavedChanges(true);
                  }}
                />
              </section>

              <section className={panelClass('evaluation')} id="studio-evaluation">
                <EvaluationPanel
                  editingAgent={editingAgent}
                  testInput={studioActions.testInput}
                  testOutput={studioActions.testOutput}
                  testRunning={studioActions.testRunning}
                  caseSchemaTexts={caseSchemaTexts}
                  cases={testCases.data || []}
                  coverage={regressionCoverage.data}
                  suiteRuns={testSuiteRuns.data || []}
                  runHistory={testRunHistory.data || {}}
                  runtimePlanHash={studioInspector.runtimePlanHash}
                  passedCases={studioInspector.passedCases}
                  activeCases={studioInspector.activeCases}
                  regressionCoveragePercent={studioInspector.regressionCoveragePercent}
                  regressionFailed={studioInspector.regressionFailed}
                  regressionStale={studioInspector.regressionStale}
                  regressionUntested={studioInspector.regressionUntested}
                  canPublish={studioInspector.canPublish && !studioInspector.hasUnsavedChanges}
                  publishDisabledReason={studioInspector.hasUnsavedChanges ? '请先保存配置，再生成上线版本。' : studioInspector.publishDisabledReason}
                  publishActionLabel={studioInspector.publishActionLabel}
                  toolOptions={toolOptions}
                  canEdit={canEdit}
                  isSuiteRunning={studioActions.runTestSuite.isPending}
                  isPublishing={studioActions.releaseActionPending}
                  isCreatingCase={studioActions.createTestCase.isPending}
                  isUpdatingCase={studioActions.updateTestCase.isPending}
                  isRunningCase={studioActions.runTestCase.isPending}
                  onTestInputChange={(value) => canEdit && studioActions.setTestInput(value)}
                  onRunBuilderTest={studioActions.runBuilderTest}
                  onRunSuite={() => {
                    if (!canEdit) return studioActions.warnReadOnly();
                    return studioActions.runTestSuite.mutate();
                  }}
                  onPublish={studioActions.publishCurrentAgent}
                  onCreateCase={() => (canEdit ? studioActions.createTestCase.mutate() : studioActions.warnReadOnly())}
                  onSetLocalCase={studioActions.setLocalTestCase}
                  onCaseSchemaTextChange={(caseId, value) => {
                    if (!canEdit) return;
                    setCaseSchemaTexts((prev) => ({ ...prev, [caseId]: value }));
                  }}
                  onUpdateCase={(id, values) => (canEdit ? studioActions.updateTestCase.mutate({ id, values }) : studioActions.warnReadOnly())}
                  onRunCase={(id) => (canEdit ? studioActions.runTestCase.mutate(id) : studioActions.warnReadOnly())}
                  onDeleteCase={studioActions.deleteTestCase}
                />
              </section>
            </div>
            <div className="hidden xl:block">
              {renderInspectorPanel()}
            </div>
          </div>
        </section>
      </section>

      <AgentPreflightDrawer
        open={studioActions.preflightOpen}
        preflight={studioActions.agentPreflight}
        onClose={() => studioActions.setPreflightOpen(false)}
      />
      <RuntimeManifestDrawer
        open={studioActions.runtimeManifestOpen}
        manifest={studioActions.runtimeManifest}
        savedDraftManifest={runtimeManifestEnvelope.data}
        releases={releases.data || []}
        currentSpecHash={studioInspector.runtimePlanHash}
        currentManifestHash={studioInspector.manifestHash}
        latestReleaseHash={studioInspector.latestReleaseHash}
        latestReleaseManifestHash={studioInspector.latestReleaseManifestHash}
        onClose={() => studioActions.setRuntimeManifestOpen(false)}
      />
      <KnowledgePreviewDrawer
        document={studioActions.knowledgePreview}
        onClose={() => studioActions.setKnowledgePreview(null)}
      />
      <Sheet open={mobileInspectorOpen} onOpenChange={setMobileInspectorOpen}>
        <SheetContent side="bottom" className="h-[82vh]">
          <SheetHeader>
            <SheetTitle>运行真相 · {shortHash(studioInspector.manifestHash)}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {renderInspectorPanel((checkKey) => {
              setMobileInspectorOpen(false);
              handleBlockerFocus(checkKey);
            })}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}
