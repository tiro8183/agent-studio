import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { App } from 'antd';
import { responseStreamErrorMessage, streamResponses } from '../services/api';
import type { Agent } from '../types/domain';
import { formatRuntimeError } from './agentServiceModel';

export interface ExperienceTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ExperienceRunEvidence {
  runId: string | null;
  responseId: string | null;
  conversationId: string | null;
}

interface UseAgentExperienceSessionParams {
  selectedAgent: Agent | null;
  messageApi: ReturnType<typeof App.useApp>['message'];
}

export function useAgentExperienceSession({
  selectedAgent,
  messageApi,
}: UseAgentExperienceSessionParams) {
  const [input, setInput] = useState('');
  const [taskBrief, setTaskBrief] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('请输出结论、依据、风险点和待确认事项。');
  const [turns, setTurns] = useState<ExperienceTurn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [lastResponseId, setLastResponseId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const queryClient = useQueryClient();
  const currentRunModel = selectedAgent ? `agent:${selectedAgent.slug || selectedAgent.id}` : '';
  const hasRunEvidence = Boolean(lastRunId || conversationId || lastResponseId);

  const requestPreview = useMemo(() => ({
    model: currentRunModel || 'agent:<agent>',
    input: buildTrialInput(taskBrief, input, acceptanceCriteria) || '...',
    stream: true,
    metadata: {
      source: 'agent-studio-experience',
      trial_mode: 'single_run',
    },
  }), [acceptanceCriteria, currentRunModel, input, taskBrief]);

  const curlPreview = useMemo(() => `curl -N /v1/responses \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(requestPreview)}'`, [requestPreview]);

  const resetSession = (options?: { keepInput?: boolean }) => {
    setTurns([]);
    setConversationId(null);
    setLastRunId(null);
    setLastResponseId(null);
    if (!options?.keepInput) {
      setInput('');
      setTaskBrief('');
      setAcceptanceCriteria('请输出结论、依据、风险点和待确认事项。');
    }
  };

  const shortEvidence = (value?: string | null) => {
    if (!value) return '未生成';
    return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-5)}` : value;
  };

  const runExperience = async () => {
    const trialInput = buildTrialInput(taskBrief, input, acceptanceCriteria);
    if (!selectedAgent || !trialInput.trim()) return;
    const userText = trialInput.trim();
    setRunning(true);
    setTurns((current) => [...current, { role: 'user', content: userText }, { role: 'assistant', content: '' }]);
    try {
      await streamResponses(
        {
          model: `agent:${selectedAgent.slug || selectedAgent.id}`,
          input: userText,
          metadata: {
            source: 'agent-studio-experience',
            trial_mode: 'single_run',
          },
        },
        (event) => {
          const metadata = event.data?.response?.metadata || event.data?.metadata || {};
          if (event.data?.response?.id) {
            setLastResponseId(event.data.response.id);
          }
          if ((event.type === 'response.in_progress' || event.type === 'response.created') && metadata.conversation_id) {
            setConversationId(metadata.conversation_id);
          }
          if (metadata.run_id) setLastRunId(metadata.run_id);
          if (metadata.conversation_id) setConversationId(metadata.conversation_id);
          if (event.type === 'response.output_text.delta') {
            setTurns((current) => {
              const next = [...current];
              const last = next[next.length - 1];
              if (last?.role === 'assistant') {
                next[next.length - 1] = { ...last, content: `${last.content}${event.data.delta || ''}` };
              }
              return next;
            });
          }
          if (event.type === 'response.failed') {
            setTurns((current) => {
              const next = [...current];
              const last = next[next.length - 1];
              if (last?.role === 'assistant') {
                next[next.length - 1] = { ...last, content: formatRuntimeError(responseStreamErrorMessage(event)) };
              }
              return next;
            });
          }
        },
      );
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['run-incidents'] });
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '运行失败');
      setTurns((current) => {
        const next = [...current];
        const last = next[next.length - 1];
        if (last?.role === 'assistant' && !last.content) {
          next[next.length - 1] = { ...last, content: formatRuntimeError(error instanceof Error ? error.message : '') };
        }
        return next;
      });
    } finally {
      setRunning(false);
    }
  };

  return {
    input,
    taskBrief,
    acceptanceCriteria,
    turns,
    conversationId,
    lastRunId,
    lastResponseId,
    running,
    currentRunModel,
    requestPreview,
    curlPreview,
    hasRunEvidence,
    setInput,
    setTaskBrief,
    setAcceptanceCriteria,
    resetSession,
    shortEvidence,
    runExperience,
  };
}

function buildTrialInput(taskBrief: string, materials: string, acceptanceCriteria: string) {
  const sections = [
    ['任务目标', taskBrief],
    ['业务材料', materials],
    ['验收口径', acceptanceCriteria],
  ]
    .map(([label, value]) => [label, String(value || '').trim()] as const)
    .filter(([, value]) => value);
  return sections.map(([label, value]) => `【${label}】\n${value}`).join('\n\n');
}
