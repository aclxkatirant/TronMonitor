/**
 * Terminale yazılan tuş vuruşlarından komut satırlarını çıkarır. Kabuk yankısını değil kullanıcının
 * girdisini izler: Enter satırı bitirir, Backspace son karakteri siler, Ctrl+C/Ctrl+U satırı temizler,
 * ANSI kaçış dizileri (ok tuşları vb.) yok sayılır. Satır düzenleme kabuk tarafında yapıldığı için
 * sonuç sezgiseldir; işlem kaydı "yazılan satır" olarak saklanır.
 */
export class CommandLineParser {
  private line = '';
  private escape = '';
  static readonly MAX_LINE = 4096;

  feed(data: string): string[] {
    const lines: string[] = [];
    for (const ch of data) {
      if (this.escape) {
        this.escape += ch;
        // CSI: ESC [ ... final (0x40-0x7E); diğer kısa diziler: ESC + tek karakter
        if (this.escape.length === 2 && ch !== '[' && ch !== 'O') this.escape = '';
        else if (this.escape.length > 2 && ch >= '@' && ch <= '~') this.escape = '';
        else if (this.escape.length > 32) this.escape = '';
        continue;
      }
      switch (ch) {
        case '\x1b':
          this.escape = ch;
          break;
        case '\r':
        case '\n': {
          const trimmed = this.line.trim();
          if (trimmed) lines.push(trimmed);
          this.line = '';
          break;
        }
        case '\x7f':
        case '\b':
          this.line = this.line.slice(0, -1);
          break;
        case '\x03': // Ctrl+C
        case '\x15': // Ctrl+U
          this.line = '';
          break;
        case '\x17': {
          // Ctrl+W: son sözcüğü sil
          this.line = this.line.replace(/\S+\s*$/, '');
          break;
        }
        default:
          if (ch >= ' ' && this.line.length < CommandLineParser.MAX_LINE) this.line += ch;
      }
    }
    return lines;
  }

  /** Oturum kapanırken Enter'a basılmamış kalan girdi. */
  flush(): string | null {
    const trimmed = this.line.trim();
    this.line = '';
    return trimmed || null;
  }
}
