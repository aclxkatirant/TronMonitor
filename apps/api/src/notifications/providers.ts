import nodemailer from 'nodemailer';
import { NotificationChannelType } from '../generated/prisma/client';

const REQUEST_TIMEOUT_MS = 15_000;

/** Bildirim içeriği; sağlayıcılar bunu kendi biçimine çevirir. */
export interface NotificationMessage {
  title: string;
  body: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  fields: { label: string; value: string }[];
  link?: string;
  at: Date;
}

export interface DiscordConfig {
  webhookUrl: string;
  username?: string;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  username?: string;
  password?: string;
  from: string;
  to: string[];
}

export type ChannelConfig = DiscordConfig | TelegramConfig | EmailConfig;

const SEVERITY_COLOR: Record<NotificationMessage['severity'], number> = { INFO: 0x3987e5, WARNING: 0xc98500, CRITICAL: 0xd03b3b };
const SEVERITY_LABEL: Record<NotificationMessage['severity'], string> = { INFO: 'Bilgi', WARNING: 'Uyarı', CRITICAL: 'Kritik' };
const SEVERITY_EMOJI: Record<NotificationMessage['severity'], string> = { INFO: 'ℹ️', WARNING: '⚠️', CRITICAL: '🔴' };

async function postJson(url: string, body: unknown): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = (await response.text()).slice(0, 300);
      throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function sendDiscord(config: DiscordConfig, message: NotificationMessage): Promise<void> {
  await postJson(config.webhookUrl, {
    username: config.username || 'TronMonitor',
    embeds: [
      {
        title: `${SEVERITY_EMOJI[message.severity]} ${message.title}`.slice(0, 256),
        description: message.body.slice(0, 4000),
        color: SEVERITY_COLOR[message.severity],
        url: message.link,
        fields: message.fields.slice(0, 20).map((f) => ({ name: f.label.slice(0, 256), value: f.value.slice(0, 1024), inline: true })),
        footer: { text: `TronMonitor · ${SEVERITY_LABEL[message.severity]}` },
        timestamp: message.at.toISOString(),
      },
    ],
  });
}

export async function sendTelegram(config: TelegramConfig, message: NotificationMessage): Promise<void> {
  const lines = [
    `<b>${SEVERITY_EMOJI[message.severity]} ${escapeHtml(message.title)}</b>`,
    escapeHtml(message.body),
    ...message.fields.map((f) => `<b>${escapeHtml(f.label)}:</b> ${escapeHtml(f.value)}`),
    message.link ? `<a href="${escapeHtml(message.link)}">Panoda aç</a>` : '',
  ].filter(Boolean);
  await postJson(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    chat_id: config.chatId,
    text: lines.join('\n').slice(0, 4000),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
}

export async function sendEmail(config: EmailConfig, message: NotificationMessage): Promise<void> {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.username ? { user: config.username, pass: config.password ?? '' } : undefined,
    connectionTimeout: REQUEST_TIMEOUT_MS,
    greetingTimeout: REQUEST_TIMEOUT_MS,
    socketTimeout: REQUEST_TIMEOUT_MS,
  });
  const fieldsHtml = message.fields.map((f) => `<tr><td style="padding:4px 12px 4px 0;color:#555">${escapeHtml(f.label)}</td><td style="padding:4px 0">${escapeHtml(f.value)}</td></tr>`).join('');
  await transport.sendMail({
    from: config.from,
    to: config.to.join(', '),
    subject: `[TronMonitor] [${SEVERITY_LABEL[message.severity]}] ${message.title}`,
    text: [message.title, '', message.body, '', ...message.fields.map((f) => `${f.label}: ${f.value}`), message.link ? `\n${message.link}` : ''].join('\n'),
    html: `<div style="font-family:system-ui,sans-serif;font-size:14px"><h2 style="margin:0 0 8px">${SEVERITY_EMOJI[message.severity]} ${escapeHtml(message.title)}</h2><p>${escapeHtml(message.body)}</p><table>${fieldsHtml}</table>${message.link ? `<p><a href="${escapeHtml(message.link)}">Panoda aç</a></p>` : ''}<p style="color:#888;font-size:12px">TronMonitor · ${SEVERITY_LABEL[message.severity]} · ${message.at.toISOString()}</p></div>`,
  });
}

export async function sendViaProvider(type: NotificationChannelType, config: ChannelConfig, message: NotificationMessage): Promise<void> {
  switch (type) {
    case NotificationChannelType.DISCORD:
      return sendDiscord(config as DiscordConfig, message);
    case NotificationChannelType.TELEGRAM:
      return sendTelegram(config as TelegramConfig, message);
    case NotificationChannelType.EMAIL:
      return sendEmail(config as EmailConfig, message);
    default:
      throw new Error(`Desteklenmeyen kanal türü: ${String(type)}`);
  }
}

/** Yapılandırmayı istemciye göstermek için sırları maskeler. */
export function maskConfig(type: NotificationChannelType, config: ChannelConfig): Record<string, unknown> {
  const mask = (value: string | undefined, keep = 4) => (value ? `${'•'.repeat(8)}${value.slice(-keep)}` : '');
  switch (type) {
    case NotificationChannelType.DISCORD: {
      const c = config as DiscordConfig;
      return { webhookUrl: mask(c.webhookUrl, 6), username: c.username ?? '' };
    }
    case NotificationChannelType.TELEGRAM: {
      const c = config as TelegramConfig;
      return { botToken: mask(c.botToken), chatId: c.chatId };
    }
    case NotificationChannelType.EMAIL: {
      const c = config as EmailConfig;
      return { host: c.host, port: c.port, secure: c.secure, username: c.username ?? '', password: c.password ? mask(c.password, 0) : '', from: c.from, to: c.to };
    }
    default:
      return {};
  }
}
