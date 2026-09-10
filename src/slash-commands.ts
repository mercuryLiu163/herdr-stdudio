/**
 * Slash-command palette data (V4 F2). herdr's agent manifest carries no
 * command metadata (verified by experiment), so the palette is a static table
 * matched by agent kind substring. Each entry is sent to the agent verbatim as
 * plain text — the agent's own TUI handles the follow-up interaction (model
 * pickers etc.) through the existing raw view / key channel.
 */

export interface SlashCommand {
  cmd: string;
  desc: string;
}

const CLAUDE: SlashCommand[] = [
  { cmd: "/model", desc: "选择或切换模型" },
  { cmd: "/status", desc: "查看版本、账号与配置状态" },
  { cmd: "/clear", desc: "清空对话历史，释放上下文" },
  { cmd: "/compact", desc: "压缩对话历史为摘要" },
  { cmd: "/cost", desc: "统计 token 用量与花费" },
  { cmd: "/review", desc: "请求代码评审" },
  { cmd: "/doctor", desc: "检查安装健康状态" },
  { cmd: "/help", desc: "显示可用命令" },
];

const CODEX: SlashCommand[] = [
  { cmd: "/model", desc: "选择或切换模型" },
  { cmd: "/status", desc: "查看会话与配置状态" },
  { cmd: "/approvals", desc: "调整审批模式" },
  { cmd: "/init", desc: "初始化 AGENTS.md" },
  { cmd: "/diff", desc: "查看当前改动 diff" },
  { cmd: "/compact", desc: "压缩对话历史为摘要" },
  { cmd: "/clear", desc: "清空对话历史" },
  { cmd: "/help", desc: "显示可用命令" },
];

const GEMINI: SlashCommand[] = [
  { cmd: "/model", desc: "选择或切换模型" },
  { cmd: "/stats", desc: "查看会话统计" },
  { cmd: "/tools", desc: "查看可用工具" },
  { cmd: "/clear", desc: "清空对话历史" },
  { cmd: "/help", desc: "显示可用命令" },
];

/** Unknown agent kinds (shell-adjacent tools, fake/test agents) fall back here. */
const GENERIC: SlashCommand[] = [
  { cmd: "/help", desc: "显示可用命令" },
  { cmd: "/status", desc: "查看 agent 状态" },
  { cmd: "/model", desc: "选择或切换模型" },
  { cmd: "/clear", desc: "清空对话历史" },
];

/**
 * Command set for an agent kind. Matching is a case-insensitive substring
 * check on the kind string (`agent.agent`), falling back to the generic set.
 */
export function slashCommandsFor(agentKind: string | null | undefined): SlashCommand[] {
  const k = (agentKind ?? "").toLowerCase();
  if (k.includes("claude")) return CLAUDE;
  if (k.includes("codex")) return CODEX;
  if (k.includes("gemini")) return GEMINI;
  return GENERIC;
}

/** Prefix filter for the palette: the whole query must prefix the command. */
export function filterSlashCommands(cmds: SlashCommand[], query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q.startsWith("/")) return [];
  return cmds.filter((c) => c.cmd.toLowerCase().startsWith(q));
}
