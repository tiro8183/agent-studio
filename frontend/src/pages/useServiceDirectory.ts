import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import type { AgentReleaseSnapshot } from '../types/domain';
import type { ServiceDirectoryEntry } from './agentServiceModel';

export function useServiceDirectory() {
  const agents = useQuery({ queryKey: ['agents'], queryFn: api.listAgents });
  const publishedAgents = useMemo(
    () => (agents.data || []).filter((agent) => agent.status === 'published'),
    [agents.data],
  );
  const releaseMap = useQuery<Record<string, AgentReleaseSnapshot | undefined>>({
    queryKey: ['agent-service-releases', publishedAgents.map((agent) => agent.id).join(',')],
    queryFn: async () => {
      const entries = await Promise.all(
        publishedAgents.map(async (agent) => [agent.id, (await api.listAgentReleases(agent.id))[0]] as const),
      );
      return Object.fromEntries(entries);
    },
    enabled: Boolean(publishedAgents.length),
  });
  const entries = useMemo<ServiceDirectoryEntry[]>(
    () => publishedAgents
      .map((agent) => ({ agent, release: releaseMap.data?.[agent.id] }))
      .filter((entry): entry is ServiceDirectoryEntry & { release: AgentReleaseSnapshot } => Boolean(entry.release)),
    [publishedAgents, releaseMap.data],
  );

  return {
    agents,
    publishedAgents: entries.map((entry) => entry.agent),
    releaseMap,
    entries,
  };
}
