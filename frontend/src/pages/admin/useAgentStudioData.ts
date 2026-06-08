import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import type { Agent, AgentTestRun } from '../../types/domain';

interface UseAgentStudioDataParams {
  editingAgent: Agent | null;
  agents: Agent[];
}

export function useAgentStudioData({ editingAgent, agents }: UseAgentStudioDataParams) {
  const queryClient = useQueryClient();

  const invalidateAgentGovernance = useCallback((agentId?: string | null) => {
    if (!agentId) return;
    queryClient.invalidateQueries({ queryKey: ['agent-completeness', agentId] });
    queryClient.invalidateQueries({ queryKey: ['agent-preflight', agentId] });
    queryClient.invalidateQueries({ queryKey: ['agent-runtime-manifest', agentId] });
    queryClient.invalidateQueries({ queryKey: ['agent-regression-coverage', agentId] });
    queryClient.invalidateQueries({ queryKey: ['agent-releases', agentId] });
    queryClient.invalidateQueries({ queryKey: ['quality-regression-overview'] });
  }, [queryClient]);

  const invalidateAgentTestData = useCallback((agentId?: string | null) => {
    if (!agentId) return;
    queryClient.invalidateQueries({ queryKey: ['test-cases', agentId] });
    queryClient.invalidateQueries({ queryKey: ['test-runs', agentId] });
    queryClient.invalidateQueries({ queryKey: ['test-suite-runs', agentId] });
    invalidateAgentGovernance(agentId);
  }, [invalidateAgentGovernance, queryClient]);

  const knowledge = useQuery({
    queryKey: ['knowledge', editingAgent?.id],
    queryFn: () => api.listKnowledge(editingAgent!.id),
    enabled: Boolean(editingAgent?.id),
  });

  const testCases = useQuery({
    queryKey: ['test-cases', editingAgent?.id],
    queryFn: () => api.listTestCases(editingAgent!.id),
    enabled: Boolean(editingAgent?.id),
  });

  const testRunHistory = useQuery({
    queryKey: ['test-runs', editingAgent?.id, (testCases.data || []).map((item) => item.id).join(',')],
    queryFn: async () => {
      const entries = await Promise.all(
        (testCases.data || []).map(async (item) => [item.id, await api.listTestRuns(item.id)] as const),
      );
      return Object.fromEntries(entries) as Record<string, AgentTestRun[]>;
    },
    enabled: Boolean(editingAgent?.id && (testCases.data || []).length),
  });

  const testSuiteRuns = useQuery({
    queryKey: ['test-suite-runs', editingAgent?.id],
    queryFn: () => api.listTestSuiteRuns(editingAgent!.id),
    enabled: Boolean(editingAgent?.id),
  });

  const regressionCoverage = useQuery({
    queryKey: ['agent-regression-coverage', editingAgent?.id],
    queryFn: () => api.getAgentRegressionCoverage(editingAgent!.id),
    enabled: Boolean(editingAgent?.id),
  });

  const completeness = useQuery({
    queryKey: ['agent-completeness', editingAgent?.id],
    queryFn: () => api.getAgentCompleteness(editingAgent!.id),
    enabled: Boolean(editingAgent?.id),
  });

  const preflight = useQuery({
    queryKey: ['agent-preflight', editingAgent?.id],
    queryFn: () => api.getAgentPreflight(editingAgent!.id),
    enabled: Boolean(editingAgent?.id),
  });

  const runtimeManifestEnvelope = useQuery({
    queryKey: ['agent-runtime-manifest', editingAgent?.id, 'draft'],
    queryFn: () => api.getAgentRuntimeManifest(editingAgent!.id, 'draft'),
    enabled: Boolean(editingAgent?.id),
  });

  const releases = useQuery({
    queryKey: ['agent-releases', editingAgent?.id],
    queryFn: () => api.listAgentReleases(editingAgent!.id),
    enabled: Boolean(editingAgent?.id),
  });

  const uploadQuota = useQuery({
    queryKey: ['upload-quota'],
    queryFn: api.uploadQuota,
    staleTime: 30_000,
  });

  const agentKnowledgeCounts = useQuery({
    queryKey: ['knowledge-counts', agents.map((agent) => agent.id).join(',')],
    queryFn: async () => {
      const entries = await Promise.all(
        agents.map(async (agent) => [agent.id, await api.listKnowledge(agent.id)] as const),
      );
      return Object.fromEntries(entries.map(([id, docs]) => [id, docs.length])) as Record<string, number>;
    },
    enabled: Boolean(agents.length),
  });

  return {
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
    agentKnowledgeCounts,
    invalidateAgentGovernance,
    invalidateAgentTestData,
  };
}
