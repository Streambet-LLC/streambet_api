import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

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
}
