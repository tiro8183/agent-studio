import { useQuery, useQueryClient } from '@tanstack/react-query';
import { canAtLeast } from '../services/authz';
import { api } from '../services/api';
import { AgentBuilder } from './admin/AgentBuilder';

export default function AgentsPage() {
  const queryClient = useQueryClient();
  const llms = useQuery({ queryKey: ['llms'], queryFn: api.listLlms });
  const agents = useQuery({ queryKey: ['agents'], queryFn: api.listAgents });
  const tools = useQuery({ queryKey: ['tools'], queryFn: api.listTools });
  const skills = useQuery({ queryKey: ['skills'], queryFn: api.listSkills });
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const canEditAgents = canAtLeast(me.data?.membership.role, 'editor');

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['llms'] });
    queryClient.invalidateQueries({ queryKey: ['agents'] });
    queryClient.invalidateQueries({ queryKey: ['tools'] });
    queryClient.invalidateQueries({ queryKey: ['skills'] });
    queryClient.invalidateQueries({ queryKey: ['skill-health'] });
    queryClient.invalidateQueries({ queryKey: ['knowledge-counts'] });
    queryClient.invalidateQueries({ queryKey: ['agent-completeness'] });
    queryClient.invalidateQueries({ queryKey: ['agent-preflight'] });
  };

  return (
    <div className="-m-6 h-[calc(100%+3rem)] min-h-0 overflow-hidden rounded-none border-0 bg-background">
      <AgentBuilder
        agents={agents.data || []}
        llms={llms.data || []}
        tools={tools.data || []}
        skills={skills.data || []}
        canEdit={canEditAgents}
        onRefresh={refresh}
      />
    </div>
  );
}
