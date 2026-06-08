import { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Input, Switch } from 'antd';
import {
  CheckCircle2,
  ClipboardCheck,
  Braces,
  FileText,
  History,
  PlayCircle,
  RotateCcw,
  Send,
  ShieldCheck,
  Copy,
} from 'lucide-react';
import { WorkspacePage } from '../components/ui';
import { canAtLeast } from '../services/authz';
import { ServiceIndexItem } from './ServiceIndexItem';
import {
  goRuns,
  goStudio,
  serviceAgentFromRelease,
  serviceProfile,
} from './agentServiceModel';
import type { WorkspacePageContext } from './pageContext';
import { useAgentExperienceSession } from './useAgentExperienceSession';
import { useServiceDirectory } from './useServiceDirectory';

export default function AgentExperiencePage({ currentUser }: WorkspacePageContext) {
  const [selectedId, setSelectedId] = useState<string>();
  const [keyword, setKeyword] = useState('');
  const preserveNextInputReset = useRef(false);
  const { message } = App.useApp();

  const { agents, publishedAgents, entries: directoryEntries } = useServiceDirectory();
  const visibleAgents = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) return directoryEntries;
    return directoryEntries.filter((entry) => {
      const displayAgent = serviceAgentFromRelease(entry.agent, entry.release);
      const profile = serviceProfile(entry);
      return (
        displayAgent.name.toLowerCase().includes(normalized)
        || displayAgent.description.toLowerCase().includes(normalized)
        || displayAgent.model.toLowerCase().includes(normalized)
        || profile.domain.toLowerCase().includes(normalized)
        || profile.department.toLowerCase().includes(normalized)
      );
    });
  }, [directoryEntries, keyword]);
  const selectedEntry = useMemo(
    () => directoryEntries.find((entry) => entry.agent.id === selectedId) || directoryEntries[0] || null,
    [directoryEntries, selectedId],
  );
  const selectedAgent = selectedEntry ? serviceAgentFromRelease(selectedEntry.agent, selectedEntry.release) : null;
  const selectedProfile = selectedEntry ? serviceProfile(selectedEntry) : null;
  const experienceSession = useAgentExperienceSession({ selectedAgent, messageApi: message });
  const canCreateAgent = canAtLeast(currentUser?.membership.role, 'editor');
  const canViewIntegration = canAtLeast(currentUser?.membership.role, 'viewer');
  const experienceFacts = selectedProfile
    ? [
      { label: '上线版本', value: selectedProfile.versionLabel },
      { label: '业务域', value: selectedProfile.domain },
      { label: '处理边界', value: selectedProfile.actionScope },
      { label: '体验记录', value: experienceSession.hasRunEvidence ? '已生成' : '待生成' },
    ]
    : [];

  useEffect(() => {
    const focusedAgentId = sessionStorage.getItem('agent_forge_experience_agent');
    const focusedPrompt = sessionStorage.getItem('agent_forge_experience_prompt');
    if (focusedAgentId) sessionStorage.removeItem('agent_forge_experience_agent');
    if (focusedPrompt) {
      sessionStorage.removeItem('agent_forge_experience_prompt');
      preserveNextInputReset.current = true;
      experienceSession.setTaskBrief(focusedPrompt);
    }
    if (!selectedId && publishedAgents.length) {
      setSelectedId(publishedAgents.find((agent) => agent.id === focusedAgentId)?.id || publishedAgents[0].id);
    }
  }, [publishedAgents, selectedId]);

  useEffect(() => {
    if (preserveNextInputReset.current) {
      preserveNextInputReset.current = false;
      return;
    }
    experienceSession.resetSession();
  }, [selectedAgent?.id]);

  const copyText = async (value: string, label = '内容') => {
    try {
      await navigator.clipboard.writeText(value);
      message.success(`${label}已复制`);
    } catch {
      message.warning('复制失败，请手动复制');
    }
  };

  return (
    <WorkspacePage
      className="agent-experience-page service-workspace-page experience-workbench-page"
      icon={<PlayCircle size={14} />}
      eyebrow="运营"
      title="体验验证"
      description="选择已上线 Agent，用真实业务材料提交一次可留痕运行；页面验证和外部系统调用走同一套 `POST /v1/responses` 协议。"
    >
      <section className="experience-console">
        <aside className="experience-service-rail">
          <div className="service-index-head">
            <div>
              <span>选择服务</span>
              <small>仅展示已上线 Agent</small>
            </div>
            <span className="service-count-pill">{publishedAgents.length} 个</span>
          </div>
          <Input.Search
            allowClear
            size="middle"
            value={keyword}
            className="service-index-search"
            placeholder="搜索 Agent、适用任务或业务域"
            onChange={(event) => setKeyword(event.target.value)}
          />
          <div className="service-index-list">
            {visibleAgents.map(({ agent, release }) => (
              <ServiceIndexItem
                key={agent.id}
                agent={agent}
                release={release}
                active={selectedAgent?.id === agent.id}
                onSelect={() => setSelectedId(agent.id)}
              />
            ))}
            {!agents.isLoading && !publishedAgents.length && (
              <div className="service-workspace-empty">
                <CheckCircle2 size={18} />
                <strong>暂无可验证 Agent</strong>
                <span>{canCreateAgent ? 'Agent 上线后会进入体验台。' : '请联系维护人完成 Agent 上线。'}</span>
                {canCreateAgent && <Button size="small" type="primary" onClick={goStudio}>进入 Agent Studio</Button>}
              </div>
            )}
          </div>
        </aside>

        {selectedAgent && selectedProfile ? (
          <>
            <main className="experience-stage">
              <section className="experience-run-panel experience-task-board">
                <div className="experience-task-head">
                  <div>
                    <span><ClipboardCheck size={15} /> 当前服务</span>
                    <strong>{selectedAgent.name}</strong>
                    <small>{selectedProfile.scenario}</small>
                  </div>
                  <div className="experience-task-tags">
                    <span>{selectedProfile.domain}</span>
                    <span>{selectedProfile.department}</span>
                    <span>{selectedProfile.versionLabel}</span>
                    <button type="button" onClick={goRuns}>
                      <History size={14} />
                      运行记录
                    </button>
                  </div>
                </div>
                <div className="experience-validation-ledger" aria-label="体验任务摘要">
                  {experienceFacts.map((item) => (
                    <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>
                  ))}
                </div>
                <div className="experience-protocol-ribbon" aria-label="执行协议">
                  <div>
                    <Braces size={14} />
                    <span>执行协议</span>
                    <strong>POST /v1/responses</strong>
                  </div>
                  <div>
                    <Copy size={14} />
                    <span>model 字段</span>
                    <strong>{experienceSession.currentRunModel}</strong>
                  </div>
                  <div>
                    <History size={14} />
                    <span>运行记录</span>
                    <strong title={experienceSession.lastRunId || undefined}>{experienceSession.shortEvidence(experienceSession.lastRunId)}</strong>
                  </div>
                </div>
                <div className="experience-task-bank">
                  <div className="experience-task-bank-head">
                    <FileText size={15} />
                    <span>推荐验证任务</span>
                    <strong>{selectedProfile.trialCases.length ? '点击后写入任务目标' : '待维护'}</strong>
                  </div>
                  <div className="experience-task-bank-list">
                    {selectedProfile.trialCases.length > 0 ? selectedProfile.trialCases.slice(0, 4).map((item) => (
                      <button type="button" key={item} disabled={experienceSession.running} onClick={() => experienceSession.setTaskBrief(item)}>
                        {item}
                      </button>
                    )) : (
                      <span>当前服务还没有推荐验证任务，可直接粘贴真实业务材料运行。</span>
                    )}
                  </div>
                </div>

                <div className="experience-result-board">
                  {experienceSession.turns.length === 0 ? (
                    <div className="experience-empty-state">
                      <div className="experience-empty-title">
                        <PlayCircle size={16} />
                        <div>
                          <span>选择任务提交运行</span>
                          <strong>{selectedProfile.output} · 上线版本 {selectedProfile.versionLabel}</strong>
                        </div>
                      </div>
                      <p>建议粘贴真实材料、明确期望结果和业务边界；每次提交都会生成运行记录，便于复核。</p>
                      <div className="experience-empty-prompts">
                        <button type="button" disabled={experienceSession.running} onClick={() => experienceSession.setTaskBrief(`请基于业务材料输出${selectedProfile.output}`)}>
                          复核清单
                        </button>
                        <button type="button" disabled={experienceSession.running} onClick={() => experienceSession.setTaskBrief('请判断业务材料是否存在风险，并按严重程度排序')}>
                          风险排序
                        </button>
                        <button type="button" disabled={experienceSession.running} onClick={() => experienceSession.setTaskBrief('请整理成可交付摘要，并保留关键事实依据')}>
                          业务摘要
                        </button>
                      </div>
                    </div>
                  ) : experienceSession.turns.map((item, index) => (
                    <div className={`experience-result-item ${item.role}`} key={`${item.role}-${index}`}>
                      <div>
                        <span>{item.role === 'user' ? '任务输入' : '输出结果'}</span>
                        <strong>{item.role === 'user' ? '业务材料' : experienceSession.running && index === experienceSession.turns.length - 1 ? '生成中' : '运行输出'}</strong>
                      </div>
                      <p>{item.content || (experienceSession.running && index === experienceSession.turns.length - 1 ? '运行中...' : '')}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="experience-composer docked experience-submit-panel">
                <div className="experience-composer-title">
                  <span>提交任务</span>
                  <strong>{experienceSession.running ? '服务处理中' : '等待业务材料'}</strong>
                </div>
                <div className="experience-input-line">
                  <div className="experience-form-grid">
                    <Input
                      value={experienceSession.taskBrief}
                      disabled={experienceSession.running}
                      onChange={(event) => experienceSession.setTaskBrief(event.target.value)}
                      placeholder="任务目标，例如：整理风险点、依据和待确认事项"
                    />
                    <Input.TextArea
                      rows={4}
                      value={experienceSession.input}
                      disabled={experienceSession.running}
                      onChange={(event) => experienceSession.setInput(event.target.value)}
                      onPressEnter={(event) => {
                        if ((event.metaKey || event.ctrlKey) && experienceSession.input.trim()) experienceSession.runExperience();
                      }}
                      placeholder="业务材料：粘贴合同、审批意见、客户诉求或其他真实材料"
                    />
                    <Input
                      value={experienceSession.acceptanceCriteria}
                      disabled={experienceSession.running}
                      onChange={(event) => experienceSession.setAcceptanceCriteria(event.target.value)}
                      placeholder="验收口径，例如：必须给出结论、依据、风险点和待确认事项"
                    />
                  </div>
                  <div className="composer-actions">
                    <Button
                      type="primary"
                      icon={<Send size={15} />}
                      loading={experienceSession.running}
                      disabled={!experienceSession.input.trim() && !experienceSession.taskBrief.trim()}
                      onClick={experienceSession.runExperience}
                    >
                      提交运行
                    </Button>
                    <Button
                      icon={<RotateCcw size={15} />}
                      disabled={experienceSession.running || (!experienceSession.turns.length && !experienceSession.conversationId)}
                      onClick={() => {
                        experienceSession.resetSession({ keepInput: true });
                      }}
                    >
                      重置
                    </Button>
                  </div>
                </div>
              </section>
            </main>

          <aside className="experience-service-inspector" aria-label="Agent 说明">
            <div className="experience-inspector-head">
              <span>服务说明</span>
              <strong>{selectedProfile.versionLabel}</strong>
            </div>
            <div className="experience-service-facts">
              <div><span>业务域</span><strong>{selectedProfile.domain}</strong></div>
              <div><span>归属</span><strong>{selectedProfile.department}</strong></div>
              <div><span>维护人</span><strong>{selectedProfile.serviceOwner}</strong></div>
              <div><span>调用范围</span><strong>{selectedProfile.callerScope}</strong></div>
              <div><span>数据范围</span><strong>{selectedProfile.dataScope}</strong></div>
              <div><span>输出</span><strong>{selectedProfile.output}</strong></div>
            </div>
            <section className="experience-side-section">
              <div>
                <ShieldCheck size={15} />
                <span>业务边界</span>
              </div>
              <div className="experience-boundary-list">
                <div><span>处理方式</span><strong>{selectedProfile.actionScope}</strong></div>
                <div><span>支持方式</span><strong>{selectedProfile.sla}</strong></div>
                <div><span>执行入口</span><strong>POST /v1/responses</strong></div>
              </div>
            </section>
            <section className="experience-side-section">
              <div>
                <History size={15} />
                <span>证据状态</span>
              </div>
              <div className={experienceSession.hasRunEvidence ? 'experience-evidence-status ready' : 'experience-evidence-status'}>
                {experienceSession.hasRunEvidence ? <CheckCircle2 size={15} /> : <History size={15} />}
                <div>
                  <strong>{experienceSession.hasRunEvidence ? '已生成运行记录' : '等待业务任务'}</strong>
                  <span>{experienceSession.hasRunEvidence ? '可查看轨迹、输出和异常' : '提交后生成可复核证据'}</span>
                </div>
              </div>
              <div className="experience-evidence-strip business">
                <div><span>运行记录</span><strong title={experienceSession.lastRunId || undefined}>{experienceSession.shortEvidence(experienceSession.lastRunId)}</strong></div>
                <div><span>任务记录</span><strong title={experienceSession.conversationId || undefined}>{experienceSession.conversationId ? '已留痕' : '单次运行'}</strong></div>
                <div><span>响应</span><strong title={experienceSession.lastResponseId || undefined}>{experienceSession.shortEvidence(experienceSession.lastResponseId)}</strong></div>
              </div>
              <button type="button" className="experience-open-runs" disabled={!experienceSession.lastRunId} onClick={goRuns}>
                <History size={13} />
                查看运行证据
              </button>
            </section>
            {canViewIntegration && (
              <details className="experience-technical-details">
                <summary>API 接入信息</summary>
                <div className="experience-evidence-strip">
                  <div><span>标准入口</span><strong>POST /v1/responses</strong></div>
                  <div><span>model 字段</span><strong>{experienceSession.currentRunModel}</strong></div>
                  <div><span>上线版本</span><strong>{selectedProfile.versionLabel}</strong></div>
                </div>
                <div className="experience-request-card">
                  <div className="experience-request-head">
                    <span>协议请求</span>
                    <button type="button" onClick={() => copyText(JSON.stringify(experienceSession.requestPreview, null, 2), '协议请求')}>
                      <Copy size={13} />
                      复制
                    </button>
                  </div>
                  <pre>{JSON.stringify(experienceSession.requestPreview, null, 2)}</pre>
                  <div className="experience-stream-row">
                    <span>流式响应</span>
                    <Switch size="small" checked disabled />
                  </div>
                </div>
                <button type="button" className="experience-copy-curl" onClick={() => copyText(experienceSession.curlPreview, '调用示例')}>
                  <Copy size={13} />
                  复制调用示例
                </button>
              </details>
            )}
          </aside>
          </>
        ) : (
          <section className="service-empty-pane">
            <div className="service-workspace-empty large">
              <CheckCircle2 size={20} />
              <strong>暂无可验证 Agent</strong>
              <span>{canCreateAgent ? 'Agent 上线后会进入体验台。' : '请联系维护人完成 Agent 上线。'}</span>
              {canCreateAgent && <Button type="primary" onClick={goStudio}>进入 Agent Studio</Button>}
            </div>
          </section>
        )}
      </section>
    </WorkspacePage>
  );
}
