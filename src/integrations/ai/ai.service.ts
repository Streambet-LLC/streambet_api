import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ClaudeUsageService, AiUsageMeta } from './claude-usage.service';

export type { AiUsageMeta } from './claude-usage.service';

/** A read-only tool Claude can call during a conversation. */
export interface AiToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** A base64-encoded image attached to a user turn (for vision). */
export interface AiImage {
  /** Raw base64 (no `data:` prefix). */
  data: string;
  /** e.g. 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'. */
  mediaType: string;
}

/** One chat turn as exchanged with the conversational endpoint. */
export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Optional images (base64) for a vision-capable user turn. */
  images?: AiImage[];
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
  /** Cheaper model for the high-volume, interactive chat path. */
  readonly chatModel = 'claude-sonnet-5';

  constructor(
    private readonly config: ConfigService,
    private readonly usage: ClaudeUsageService,
  ) {
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

  /** Anthropic image block from our base64 image shape. */
  private imageBlock(img: AiImage): Anthropic.ImageBlockParam {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mediaType as Anthropic.Base64ImageSource['media_type'],
        data: img.data,
      },
    };
  }

  /**
   * Map our lightweight chat messages to Anthropic message params. A turn with
   * images becomes a content-block array (images first, then any text); a
   * text-only turn stays a plain string so the prefix-cache path is unchanged.
   */
  private toMessageParams(
    messages: AiChatMessage[],
  ): Anthropic.MessageParam[] {
    return messages.map((m) => {
      if (m.images && m.images.length > 0) {
        const blocks: Anthropic.ContentBlockParam[] = [
          ...m.images.map((img) => this.imageBlock(img)),
          ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
        ];
        return { role: m.role, content: blocks };
      }
      return { role: m.role, content: m.content };
    });
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
    meta?: AiUsageMeta;
  }): Promise<string> {
    const client = this.ensure();
    const model = opts.model ?? this.defaultModel;
    const res = await client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 16000,
      ...(opts.system ? { system: opts.system } : {}),
      ...(opts.thinking === false
        ? {}
        : { thinking: { type: 'adaptive' as const } }),
      ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
      messages: [{ role: 'user', content: opts.prompt }],
    });
    const totals = ClaudeUsageService.newTotals();
    ClaudeUsageService.add(totals, res.usage);
    void this.usage.record(opts.meta, model, totals);
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
    /** Optional images (base64) for vision-grounded extraction. */
    images?: AiImage[];
    meta?: AiUsageMeta;
  }): Promise<T> {
    const client = this.ensure();
    const content: Anthropic.MessageParam['content'] = opts.images?.length
      ? [
          ...opts.images.map((img) => this.imageBlock(img)),
          { type: 'text' as const, text: opts.prompt },
        ]
      : opts.prompt;
    const model = opts.model ?? this.defaultModel;
    const res = await client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 4096,
      ...(opts.system ? { system: opts.system } : {}),
      output_config: {
        format: { type: 'json_schema' as const, schema: opts.schema },
      },
      messages: [{ role: 'user', content }],
    });
    const totals = ClaudeUsageService.newTotals();
    ClaudeUsageService.add(totals, res.usage);
    void this.usage.record(opts.meta, model, totals);
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
    /** Cap live web searches. Lower = cheaper (fewer result tokens). */
    maxSearches?: number;
    /** Thinking depth. 'low'/'medium' trade some rigor for big token savings. */
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    meta?: AiUsageMeta;
  }): Promise<T> {
    const client = this.ensure();
    const model = opts.model ?? this.defaultModel;
    // web_search server tool (GA on Opus 4.8). Cast avoids SDK-version type drift.
    const tools = [
      {
        type: 'web_search_20260209',
        name: 'web_search',
        max_uses: opts.maxSearches ?? 8,
      },
    ] as unknown as Anthropic.Messages.ToolUnion[];
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: opts.prompt },
    ];

    let text = '';
    const totals = ClaudeUsageService.newTotals();
    // web_search runs in a code-execution container; reuse it across pause_turn
    // rounds via `container`, or the API rejects the continuation request.
    let containerId: string | undefined;
    // Server-tool loops may pause_turn; continue a few rounds.
    for (let round = 0; round < 5; round++) {
      const res = await client.messages.create({
        model,
        max_tokens: opts.maxTokens ?? 8000,
        thinking: { type: 'adaptive' as const },
        ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
        ...(opts.system ? { system: opts.system } : {}),
        tools,
        messages,
        ...(containerId ? { container: containerId } : {}),
      });
      containerId = res.container?.id ?? containerId;
      ClaudeUsageService.add(totals, res.usage);
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
    void this.usage.record(opts.meta, model, totals);

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
    meta?: AiUsageMeta;
  }): Promise<{ text: string; toolCalls: AiToolInvocation[] }> {
    const client = this.ensure();
    const model = opts.model ?? this.defaultModel;
    const totals = ClaudeUsageService.newTotals();
    const maxTurns = opts.maxTurns ?? 8;
    const anthropicTools = [
      ...(opts.tools as unknown as Anthropic.Messages.ToolUnion[]),
      ...(opts.webSearch
        ? ([
            { type: 'web_search_20260209', name: 'web_search', max_uses: 4 },
          ] as unknown as Anthropic.Messages.ToolUnion[])
        : []),
    ];
    const messages: Anthropic.MessageParam[] = this.toMessageParams(
      opts.messages,
    );
    const toolCalls: AiToolInvocation[] = [];
    let finalText = '';
    // Server tools (web_search) run inside a code-execution container. Once one
    // exists, every follow-up request in this loop MUST reuse it via `container`
    // — otherwise the API rejects the continuation with "container_id is
    // required when there are pending tool uses generated by code execution".
    let containerId: string | undefined;

    for (let turn = 0; turn < maxTurns; turn++) {
      const res = await client.messages.create({
        model,
        max_tokens: opts.maxTokens ?? 4096,
        system: this.cacheableSystem(opts.system),
        tools: anthropicTools,
        messages: this.withPrefixCache(messages),
        ...(containerId ? { container: containerId } : {}),
      });
      containerId = res.container?.id ?? containerId;
      ClaudeUsageService.add(totals, res.usage);

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

    void this.usage.record(opts.meta, model, totals);
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
    meta?: AiUsageMeta;
  }): Promise<{ toolCalls: AiToolInvocation[] }> {
    const client = this.ensure();
    const model = opts.model ?? this.defaultModel;
    const totals = ClaudeUsageService.newTotals();
    const maxTurns = opts.maxTurns ?? 8;
    const anthropicTools = [
      ...(opts.tools as unknown as Anthropic.Messages.ToolUnion[]),
      ...(opts.webSearch
        ? ([
            { type: 'web_search_20260209', name: 'web_search', max_uses: 4 },
          ] as unknown as Anthropic.Messages.ToolUnion[])
        : []),
    ];
    const messages: Anthropic.MessageParam[] = this.toMessageParams(
      opts.messages,
    );
    const toolCalls: AiToolInvocation[] = [];
    // Reuse the code-execution container that web_search spins up across every
    // continuation of this loop (see runToolConversation for the full reason).
    let containerId: string | undefined;

    for (let turn = 0; turn < maxTurns; turn++) {
      let turnHadText = false;
      const stream = client.messages.stream({
        model,
        max_tokens: opts.maxTokens ?? 4096,
        system: this.cacheableSystem(opts.system),
        tools: anthropicTools,
        messages: this.withPrefixCache(messages),
        ...(containerId ? { container: containerId } : {}),
      });
      stream.on('text', (delta: string) => {
        turnHadText = true;
        opts.onText(delta);
      });
      const res = await stream.finalMessage();
      containerId = res.container?.id ?? containerId;
      ClaudeUsageService.add(totals, res.usage);

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

    void this.usage.record(opts.meta, model, totals);
    return { toolCalls };
  }

  /**
   * Wrap the (large, stable) system prompt as a cacheable block so the
   * tools+system prefix is written once and read at ~0.1x on every subsequent
   * turn of the tool loop and every follow-up message. Big win on the chat
   * path, which re-sends the same ~2.4k-token prefix on every API call.
   */
  private cacheableSystem(system: string): Anthropic.TextBlockParam[] {
    return [
      {
        type: 'text',
        text: system,
        // 1h TTL so the stable tools+system prefix survives think-time gaps
        // across a whole chat session, not just the seconds within one answer.
        cache_control: { type: 'ephemeral', ttl: '1h' },
      },
    ];
  }

  /**
   * Return a copy of `messages` with a cache breakpoint on the last block, so
   * the growing conversation prefix (including bulky web-search results) is
   * read from cache on the next turn instead of re-billed at full price. Does
   * NOT mutate the persistent array, so markers don't accumulate across turns.
   */
  private withPrefixCache(
    messages: Anthropic.MessageParam[],
  ): Anthropic.MessageParam[] {
    if (messages.length === 0) return messages;
    const i = messages.length - 1;
    const out = messages.slice();
    const last = out[i];
    const cc = { cache_control: { type: 'ephemeral' as const } };
    if (typeof last.content === 'string') {
      out[i] = {
        ...last,
        content: [{ type: 'text', text: last.content, ...cc }],
      } as Anthropic.MessageParam;
    } else if (Array.isArray(last.content) && last.content.length > 0) {
      const blocks = last.content.slice() as unknown as Record<
        string,
        unknown
      >[];
      blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], ...cc };
      out[i] = { ...last, content: blocks } as unknown as Anthropic.MessageParam;
    }
    return out;
  }

  /**
   * Bulk structured extraction via the Message Batches API — 50% cheaper than
   * live requests, for background work where latency doesn't matter (e.g. lead
   * qualification). Submits all `requests`, polls to completion, and returns a
   * map of customId → parsed JSON (failed/invalid entries are omitted). Same
   * model and prompts as `generateJson`, so no quality change — just async and
   * half price. Poll it from a fire-and-forget context; it can take minutes.
   */
  async runJsonBatch<T = unknown>(opts: {
    requests: {
      customId: string;
      system?: string;
      prompt: string;
      schema: Record<string, unknown>;
      maxTokens?: number;
    }[];
    model?: string;
    pollMs?: number;
    timeoutMs?: number;
    meta?: AiUsageMeta;
  }): Promise<Map<string, T>> {
    const client = this.ensure();
    const model = opts.model ?? this.defaultModel;
    const totals = ClaudeUsageService.newTotals();
    const out = new Map<string, T>();
    if (opts.requests.length === 0) return out;

    const batch = await client.messages.batches.create({
      requests: opts.requests.map((r) => ({
        custom_id: r.customId,
        params: {
          model,
          max_tokens: r.maxTokens ?? 4096,
          ...(r.system ? { system: r.system } : {}),
          output_config: {
            format: { type: 'json_schema' as const, schema: r.schema },
          },
          messages: [{ role: 'user' as const, content: r.prompt }],
        },
      })) as never,
    });

    const pollMs = opts.pollMs ?? 15000;
    const deadline = Date.now() + (opts.timeoutMs ?? 60 * 60 * 1000);
    let status = batch.processing_status;
    while (status !== 'ended') {
      if (Date.now() > deadline) {
        throw new Error('Batch did not finish within the time limit.');
      }
      await new Promise((res) => setTimeout(res, pollMs));
      const b = await client.messages.batches.retrieve(batch.id);
      status = b.processing_status;
    }

    for await (const result of await client.messages.batches.results(batch.id)) {
      if (result.result.type !== 'succeeded') continue;
      ClaudeUsageService.add(totals, result.result.message.usage);
      const text = result.result.message.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      const parsed = this.extractJson(text);
      if (parsed !== null) out.set(result.custom_id, parsed as T);
    }
    void this.usage.record(opts.meta, model, totals);
    return out;
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
