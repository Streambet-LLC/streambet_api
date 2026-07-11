import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

/** A read-only tool Claude can call during a conversation. */
export interface AiToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** One chat turn as exchanged with the conversational endpoint. */
export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** A tool Claude invoked during a conversation (for UI transparency). */
export interface AiToolInvocation {
  name: string;
  input: unknown;
}

/**
 * Thin wrapper around the Anthropic (Claude) API for the analytics
 * intelligence layer — identity reconciliation scoring, interest
 * classification, and list/segment synthesis.
 *
 * Requires `ANTHROPIC_API_KEY` in the environment. When it's absent the
 * service stays dormant (`isConfigured()` is false) so the app boots fine
 * without it; callers should check `isConfigured()` and degrade gracefully.
 *
 * Defaults follow the current Claude guidance: model `claude-opus-4-8`,
 * adaptive thinking for open-ended reasoning, non-streaming `max_tokens`
 * kept ≤ 16k to stay under SDK HTTP timeouts.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: Anthropic | null;
  private readonly defaultModel = 'claude-opus-4-8';

  constructor(private readonly config: ConfigService) {
    const apiKey =
      this.config.get<string>('ANTHROPIC_API_KEY') ??
      process.env.ANTHROPIC_API_KEY;
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
    if (!this.client) {
      this.logger.warn(
        'ANTHROPIC_API_KEY not set — AiService is dormant (AI features disabled).',
      );
    }
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  private ensure(): Anthropic {
    if (!this.client) {
      throw new Error(
        'AI is not configured (missing ANTHROPIC_API_KEY).',
      );
    }
    return this.client;
  }

  /**
   * Open-ended reasoning → plain text. Adaptive thinking on by default for
   * anything non-trivial (e.g. synthesizing a segment description).
   */
  async generateText(opts: {
    system?: string;
    prompt: string;
    model?: string;
    maxTokens?: number;
    /** 'low' | 'medium' | 'high' | 'xhigh' | 'max' */
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    thinking?: boolean;
  }): Promise<string> {
    const client = this.ensure();
    const res = await client.messages.create({
      model: opts.model ?? this.defaultModel,
      max_tokens: opts.maxTokens ?? 16000,
      ...(opts.system ? { system: opts.system } : {}),
      ...(opts.thinking === false
        ? {}
        : { thinking: { type: 'adaptive' as const } }),
      ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
      messages: [{ role: 'user', content: opts.prompt }],
    });
    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
  }

  /**
   * Structured extraction/classification → validated JSON matching `schema`.
   * Thinking off by default so bulk classification stays cheap and fast;
   * the model output is constrained to the schema via `output_config.format`.
   */
  async generateJson<T = unknown>(opts: {
    system?: string;
    prompt: string;
    schema: Record<string, unknown>;
    model?: string;
    maxTokens?: number;
  }): Promise<T> {
    const client = this.ensure();
    const res = await client.messages.create({
      model: opts.model ?? this.defaultModel,
      max_tokens: opts.maxTokens ?? 4096,
      ...(opts.system ? { system: opts.system } : {}),
      output_config: {
        format: { type: 'json_schema' as const, schema: opts.schema },
      },
      messages: [{ role: 'user', content: opts.prompt }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`AI returned non-JSON output: ${text.slice(0, 200)}`);
    }
  }

  /**
   * Web-research reasoning → validated JSON. Claude searches the live web
   * (news, events, precedents, grading/supply) and fuses it with the signals
   * in the prompt, then returns a single JSON object we parse. Used for the
   * predictive card-intelligence forecasts.
   */
  async research<T = unknown>(opts: {
    system?: string;
    prompt: string;
    model?: string;
    maxTokens?: number;
  }): Promise<T> {
    const client = this.ensure();
    // web_search server tool (GA on Opus 4.8). Cast avoids SDK-version type drift.
    const tools = [
      { type: 'web_search_20260209', name: 'web_search', max_uses: 8 },
    ] as unknown as Anthropic.Messages.ToolUnion[];
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: opts.prompt },
    ];

    let text = '';
    // Server-tool loops may pause_turn; continue a few rounds.
    for (let round = 0; round < 5; round++) {
      const res = await client.messages.create({
        model: opts.model ?? this.defaultModel,
        max_tokens: opts.maxTokens ?? 8000,
        thinking: { type: 'adaptive' as const },
        ...(opts.system ? { system: opts.system } : {}),
        tools,
        messages,
      });
      text += res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      if (res.stop_reason === 'pause_turn') {
        messages.push({
          role: 'assistant',
          content: res.content as unknown as Anthropic.ContentBlockParam[],
        });
        continue;
      }
      break;
    }

    const parsed = this.extractJson(text);
    if (parsed === null) {
      throw new Error(
        `AI research returned non-JSON output: ${text.slice(0, 200)}`,
      );
    }
    return parsed as T;
  }

  /**
   * Grounded, conversational tool use. Claude answers the user's question by
   * calling the read-only `tools` you provide (dispatched via `dispatch`),
   * then replies in plain text. The agentic loop is bounded by `maxTurns` so a
   * misbehaving model can't spin; tool errors are fed back as `is_error`
   * results so Claude can recover rather than crashing the request.
   *
   * Thinking is left off: this is data lookup + synthesis, and low latency
   * matters for an interactive chat. Returns the final text plus the list of
   * tools invoked (for UI transparency).
   */
  async runToolConversation(opts: {
    system: string;
    messages: AiChatMessage[];
    tools: AiToolSpec[];
    dispatch: (
      name: string,
      input: Record<string, unknown>,
    ) => Promise<unknown>;
    maxTurns?: number;
    maxTokens?: number;
    model?: string;
    /** Give Claude the live web_search server tool for this conversation. */
    webSearch?: boolean;
  }): Promise<{ text: string; toolCalls: AiToolInvocation[] }> {
    const client = this.ensure();
    const maxTurns = opts.maxTurns ?? 8;
    const anthropicTools = [
      ...(opts.tools as unknown as Anthropic.Messages.ToolUnion[]),
      ...(opts.webSearch
        ? ([
            { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
          ] as unknown as Anthropic.Messages.ToolUnion[])
        : []),
    ];
    const messages: Anthropic.MessageParam[] = opts.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const toolCalls: AiToolInvocation[] = [];
    let finalText = '';

    for (let turn = 0; turn < maxTurns; turn++) {
      const res = await client.messages.create({
        model: opts.model ?? this.defaultModel,
        max_tokens: opts.maxTokens ?? 4096,
        system: opts.system,
        tools: anthropicTools,
        messages,
      });

      finalText = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();

      // Record server-tool calls (web search) for UI transparency.
      for (const b of res.content) {
        if ((b as { type?: string }).type === 'server_tool_use') {
          toolCalls.push({
            name: (b as { name?: string }).name ?? 'web_search',
            input: (b as { input?: unknown }).input ?? {},
          });
        }
      }

      // A server tool (web search) ran and paused the turn — echo the
      // assistant content back and let it resume.
      if (res.stop_reason === 'pause_turn') {
        messages.push({
          role: 'assistant',
          content: res.content as unknown as Anthropic.ContentBlockParam[],
        });
        continue;
      }

      if (res.stop_reason !== 'tool_use') break;

      // Preserve the assistant turn (incl. tool_use blocks) before answering.
      messages.push({
        role: 'assistant',
        content: res.content as unknown as Anthropic.ContentBlockParam[],
      });

      const toolUses = res.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        toolCalls.push({ name: tu.name, input: tu.input });
        let out: unknown;
        let isError = false;
        try {
          out = await opts.dispatch(
            tu.name,
            (tu.input ?? {}) as Record<string, unknown>,
          );
        } catch (e) {
          isError = true;
          out = { error: (e as Error).message };
          this.logger.warn(`Tool "${tu.name}" failed: ${(e as Error).message}`);
        }
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          // Cap payload so a huge result can't blow the context budget.
          content: JSON.stringify(out ?? null).slice(0, 24000),
          ...(isError ? { is_error: true } : {}),
        });
      }
      messages.push({ role: 'user', content: results });
    }

    return { text: finalText, toolCalls };
  }

  /**
   * Streaming variant of runToolConversation. Forwards text deltas to
   * `onText` as they arrive (so the UI can render the answer building in real
   * time) and announces each tool via `onTool`. Same bounded tool-use +
   * web-search (pause_turn) loop as the non-streaming version.
   */
  async streamToolConversation(opts: {
    system: string;
    messages: AiChatMessage[];
    tools: AiToolSpec[];
    dispatch: (
      name: string,
      input: Record<string, unknown>,
    ) => Promise<unknown>;
    onText: (delta: string) => void;
    onTool?: (name: string) => void;
    maxTurns?: number;
    maxTokens?: number;
    model?: string;
    webSearch?: boolean;
  }): Promise<{ toolCalls: AiToolInvocation[] }> {
    const client = this.ensure();
    const maxTurns = opts.maxTurns ?? 8;
    const anthropicTools = [
      ...(opts.tools as unknown as Anthropic.Messages.ToolUnion[]),
      ...(opts.webSearch
        ? ([
            { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
          ] as unknown as Anthropic.Messages.ToolUnion[])
        : []),
    ];
    const messages: Anthropic.MessageParam[] = opts.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const toolCalls: AiToolInvocation[] = [];

    for (let turn = 0; turn < maxTurns; turn++) {
      let turnHadText = false;
      const stream = client.messages.stream({
        model: opts.model ?? this.defaultModel,
        max_tokens: opts.maxTokens ?? 4096,
        system: opts.system,
        tools: anthropicTools,
        messages,
      });
      stream.on('text', (delta: string) => {
        turnHadText = true;
        opts.onText(delta);
      });
      const res = await stream.finalMessage();

      // Announce any tools this turn used (server + custom).
      for (const b of res.content) {
        const t = (b as { type?: string }).type;
        if (t === 'server_tool_use' || t === 'tool_use') {
          const name = (b as { name?: string }).name ?? 'tool';
          opts.onTool?.(name);
          if (t === 'server_tool_use') {
            toolCalls.push({ name, input: (b as { input?: unknown }).input });
          }
        }
      }

      const continuing =
        res.stop_reason === 'pause_turn' || res.stop_reason === 'tool_use';
      // Keep interim narration readable — break between turns.
      if (continuing && turnHadText) opts.onText('\n\n');

      if (res.stop_reason === 'pause_turn') {
        messages.push({
          role: 'assistant',
          content: res.content as unknown as Anthropic.ContentBlockParam[],
        });
        continue;
      }
      if (res.stop_reason !== 'tool_use') break;

      messages.push({
        role: 'assistant',
        content: res.content as unknown as Anthropic.ContentBlockParam[],
      });
      const toolUses = res.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        toolCalls.push({ name: tu.name, input: tu.input });
        let out: unknown;
        let isError = false;
        try {
          out = await opts.dispatch(
            tu.name,
            (tu.input ?? {}) as Record<string, unknown>,
          );
        } catch (e) {
          isError = true;
          out = { error: (e as Error).message };
          this.logger.warn(`Tool "${tu.name}" failed: ${(e as Error).message}`);
        }
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(out ?? null).slice(0, 24000),
          ...(isError ? { is_error: true } : {}),
        });
      }
      messages.push({ role: 'user', content: results });
    }

    return { toolCalls };
  }

  /** Pull the first balanced JSON object out of a (possibly fenced) string. */
  private extractJson(raw: string): unknown | null {
    let s = raw.trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}
