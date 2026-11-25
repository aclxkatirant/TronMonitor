import { CommandLineParser } from './command-parser';

describe('CommandLineParser', () => {
  it('Enter ile satırı çıkarır ve boş satırları atlar', () => {
    const p = new CommandLineParser();
    expect(p.feed('ls -la\r')).toEqual(['ls -la']);
    expect(p.feed('\r\r')).toEqual([]);
    expect(p.feed('  \r')).toEqual([]);
  });

  it('Backspace ve Ctrl+U/Ctrl+C düzenlemelerini uygular', () => {
    const p = new CommandLineParser();
    expect(p.feed('lss\x7f -l\r')).toEqual(['ls -l']);
    expect(p.feed('rm -rf /\x03')).toEqual([]);
    expect(p.feed('echo ok\r')).toEqual(['echo ok']);
    expect(p.feed('abc\x15pwd\r')).toEqual(['pwd']);
    expect(p.feed('git commit\x17status\r')).toEqual(['git status']);
  });

  it('ANSI kaçış dizilerini (ok tuşları) yok sayar', () => {
    const p = new CommandLineParser();
    expect(p.feed('\x1b[A\x1b[B')).toEqual([]);
    expect(p.feed('cat\x1b[D\x1b[C x\r')).toEqual(['cat x']);
    expect(p.feed('\x1bOHhome\r')).toEqual(['home']);
  });

  it('parça parça gelen girdiyi ve yapıştırılan çok satırı işler', () => {
    const p = new CommandLineParser();
    expect(p.feed('up')).toEqual([]);
    expect(p.feed('time\r')).toEqual(['uptime']);
    expect(p.feed('a\nb\n')).toEqual(['a', 'b']);
    expect(p.feed('tail')).toEqual([]);
    expect(p.flush()).toBe('tail');
    expect(p.flush()).toBeNull();
  });

  it('satır uzunluğunu sınırlar', () => {
    const p = new CommandLineParser();
    const [line] = p.feed('x'.repeat(5000) + '\r');
    expect(line).toHaveLength(CommandLineParser.MAX_LINE);
  });
});
