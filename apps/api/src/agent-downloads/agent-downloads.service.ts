import { Injectable, Logger } from '@nestjs/common';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { AppConfigService } from '../config/config.service';
import { AppError } from '../common/app-error';

export const AGENT_BINARIES = [
  'tronmonitor-agent-windows-amd64.exe',
  'tronmonitor-agent-windows-arm64.exe',
  'tronmonitor-agent-linux-amd64',
  'tronmonitor-agent-linux-arm64',
] as const;

export const AGENT_SCRIPTS = ['install-agent.sh', 'uninstall-agent.sh', 'install-agent.ps1', 'uninstall-agent.ps1'] as const;
const CHECKSUMS_FILE = 'SHA256SUMS';

const CONTENT_TYPES: Record<string, string> = {
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.sh': 'text/x-shellscript; charset=utf-8',
  '.ps1': 'text/plain; charset=utf-8',
};

export interface DownloadableFile {
  name: string;
  size: number;
  sha256: string | null;
  kind: 'binary' | 'script' | 'checksums';
  available: boolean;
}

export interface ResolvedFile {
  name: string;
  path: string;
  size: number;
  contentType: string;
}

@Injectable()
export class AgentDownloadsService {
  private readonly logger = new Logger(AgentDownloadsService.name);
  private readonly releasesDir: string;
  private readonly scriptsDir: string;

  constructor(config: AppConfigService) {
    const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
    this.releasesDir = config.get('AGENT_RELEASES_DIR') || path.join(repoRoot, 'agent', 'dist');
    this.scriptsDir = config.get('AGENT_SCRIPTS_DIR') || path.join(repoRoot, 'deploy', 'agent');
  }

  private locate(name: string): { dir: string; kind: DownloadableFile['kind'] } | null {
    if ((AGENT_BINARIES as readonly string[]).includes(name)) return { dir: this.releasesDir, kind: 'binary' };
    if (name === CHECKSUMS_FILE) return { dir: this.releasesDir, kind: 'checksums' };
    if ((AGENT_SCRIPTS as readonly string[]).includes(name)) return { dir: this.scriptsDir, kind: 'script' };
    return null;
  }

  async readChecksums(): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    try {
      const text = await readFile(path.join(this.releasesDir, CHECKSUMS_FILE), 'utf8');
      for (const line of text.split('\n')) {
        const match = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
        if (match) result.set(match[2].trim(), match[1].toLowerCase());
      }
    } catch {
      // Özet dosyası yoksa ikili dosyalar "kullanılamaz" olarak listelenir.
    }
    return result;
  }

  async list(): Promise<{ releasesDir: string; files: DownloadableFile[] }> {
    const checksums = await this.readChecksums();
    const names: string[] = [...AGENT_BINARIES, CHECKSUMS_FILE, ...AGENT_SCRIPTS];
    const files = await Promise.all(
      names.map(async (name): Promise<DownloadableFile> => {
        const location = this.locate(name)!;
        try {
          const info = await stat(path.join(location.dir, name));
          const sha256 = checksums.get(name) ?? null;
          return { name, size: info.size, sha256, kind: location.kind, available: location.kind !== 'binary' || sha256 !== null };
        } catch {
          return { name, size: 0, sha256: null, kind: location.kind, available: false };
        }
      }),
    );
    return { releasesDir: this.releasesDir, files };
  }

  async resolve(name: string): Promise<ResolvedFile> {
    const location = this.locate(name);
    if (!location) throw AppError.notFound('AGENT_FILE_NOT_FOUND');
    const fullPath = path.join(location.dir, name);
    let info;
    try {
      info = await stat(fullPath);
    } catch {
      this.logger.warn(`Ajan dosyası bulunamadı: ${fullPath}`);
      throw AppError.notFound('AGENT_FILE_NOT_FOUND');
    }
    if (location.kind === 'binary') {
      const checksums = await this.readChecksums();
      if (!checksums.has(name)) throw AppError.notFound('AGENT_FILE_NOT_FOUND');
    }
    return {
      name,
      path: fullPath,
      size: info.size,
      contentType: CONTENT_TYPES[path.extname(name)] ?? (location.kind === 'checksums' ? 'text/plain; charset=utf-8' : 'application/octet-stream'),
    };
  }
}
