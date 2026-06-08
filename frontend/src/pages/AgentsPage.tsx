import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PenLine } from 'lucide-react';
import { api } from '../services/api';
import { canAtLeast } from '../services/authz';
import { AgentBuilder } from './admin/AgentBuilder';
import './admin/agentStudio.css';

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
    <div className="page workspace-page agent-studio-page">
      <header className="page-header page-header-strong studio-hero-header">
        <div>
          <div className="eyebrow"><PenLine size={14} /> Agent 生产配置</div>
          <h1>Agent Studio</h1>
          <p>定义服务身份、绑定模型与能力、完成上线检查和验收，生成不可变上线版本。</p>
        </div>
      </header>
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
