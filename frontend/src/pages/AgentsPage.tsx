import { useQuery, useQueryClient } from '@tanstack/react-query';
import { canAtLeast } from '../services/authz';
import { api } from '../services/api';
import { PageContainer, PageHeader } from '../components/layout';
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
    <PageContainer>
      <PageHeader
        title="Agent Studio"
        description="围绕当前 Agent 完成配置、业务验证和上线发布，运行真相与阻断项收敛在审阅区。"
      />
      <AgentBuilder
        agents={agents.data || []}
        llms={llms.data || []}
        tools={tools.data || []}
        skills={skills.data || []}
        canEdit={canEditAgents}
        onRefresh={refresh}
      />
    </PageContainer>
  );
}
